import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const MIN_NODE_SQLITE_VERSION = Object.freeze({ major: 22, minor: 13, patch: 0 });

export function assertNodeSqliteRuntime() {
  const [major, minor, patch] = process.versions.node.split(".").map(Number);
  const required = MIN_NODE_SQLITE_VERSION;
  const supported =
    major > required.major ||
    (major === required.major && minor > required.minor) ||
    (major === required.major && minor === required.minor && patch >= required.patch);
  if (!supported) {
    const error = new Error(
      `SQLite knowledge commands require Node.js >= ${required.major}.${required.minor}.${required.patch}; current runtime is ${process.versions.node}`,
    );
    error.code = "NODE_SQLITE_UNAVAILABLE";
    throw error;
  }
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${stableJson(value[key])}`
  ).join(",")}}`;
}

export function plainRow(row) {
  return row == null ? row : Object.fromEntries(Object.entries(row));
}

export function plainRows(rows) {
  return rows.map(plainRow);
}

export function openSqlite(path, options = {}) {
  assertNodeSqliteRuntime();
  const absolute = resolve(path);
  if (!options.readOnly) mkdirSync(dirname(absolute), { recursive: true });
  const db = new DatabaseSync(absolute, {
    open: true,
    readOnly: Boolean(options.readOnly),
    enableForeignKeyConstraints: true,
  });
  db.exec("PRAGMA busy_timeout=5000;");
  if (!options.readOnly) {
    const mode = plainRow(db.prepare("PRAGMA journal_mode=WAL").get());
    if (String(Object.values(mode ?? {})[0] ?? "").toLowerCase() !== "wal") {
      db.close();
      const error = new Error(`SQLite refused WAL mode for ${absolute}`);
      error.code = "SQLITE_WAL_UNAVAILABLE";
      throw error;
    }
    db.exec(`
      PRAGMA synchronous=NORMAL;
      PRAGMA foreign_keys=ON;
      PRAGMA journal_size_limit=67108864;
      PRAGMA wal_autocheckpoint=1000;
    `);
  }
  return db;
}

export function withTransaction(db, callback, mode = "IMMEDIATE") {
  db.exec(`BEGIN ${mode}`);
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Preserve the original failure.
    }
    throw error;
  }
}

export function applyMigrations(db, component, migrations) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      component TEXT NOT NULL,
      version INTEGER NOT NULL,
      applied_at TEXT NOT NULL,
      PRIMARY KEY (component, version)
    ) STRICT;
  `);
  const row = plainRow(
    db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations WHERE component = ?")
      .get(component),
  );
  let current = Number(row?.version ?? 0);
  for (const migration of migrations.sort((left, right) => left.version - right.version)) {
    if (migration.version <= current) continue;
    if (migration.version !== current + 1) {
      const error = new Error(
        `Migration gap for ${component}: expected ${current + 1}, received ${migration.version}`,
      );
      error.code = "SQLITE_MIGRATION_GAP";
      throw error;
    }
    withTransaction(db, () => {
      db.exec(migration.sql);
      db.prepare(
        "INSERT INTO schema_migrations(component, version, applied_at) VALUES (?, ?, ?)",
      ).run(component, migration.version, new Date().toISOString());
    });
    current = migration.version;
  }
  return current;
}

export function databaseHealth(db) {
  const integrity = plainRow(db.prepare("PRAGMA integrity_check").get());
  const journal = plainRow(db.prepare("PRAGMA journal_mode").get());
  return {
    integrity: Object.values(integrity ?? {})[0] ?? null,
    journalMode: Object.values(journal ?? {})[0] ?? null,
    sqliteVersion: plainRow(db.prepare("SELECT sqlite_version() AS version").get()).version,
  };
}
