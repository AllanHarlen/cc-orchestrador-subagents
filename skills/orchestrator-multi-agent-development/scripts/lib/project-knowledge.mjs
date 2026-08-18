import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  applyMigrations,
  databaseHealth,
  openSqlite,
  plainRow,
  plainRows,
  sha256,
  stableJson,
  withTransaction,
} from "./sqlite-store.mjs";

const KNOWLEDGE_MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE evidence (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        source_hash TEXT,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        run_id TEXT
      ) STRICT;

      CREATE TABLE facts (
        id TEXT PRIMARY KEY,
        section TEXT NOT NULL,
        fact_key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        display_value TEXT NOT NULL,
        status TEXT NOT NULL,
        confidence REAL NOT NULL,
        fingerprint TEXT NOT NULL UNIQUE,
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revoked_at TEXT,
        revocation_reason TEXT
      ) STRICT;

      CREATE TABLE fact_evidence (
        fact_id TEXT NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
        evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
        PRIMARY KEY (fact_id, evidence_id)
      ) STRICT;

      CREATE INDEX idx_facts_status_section ON facts(status, section, pinned DESC, updated_at DESC);
      CREATE INDEX idx_facts_key ON facts(section, fact_key, status);
      CREATE INDEX idx_evidence_source ON evidence(kind, source_ref, observed_at DESC);

      CREATE TABLE lessons (
        id TEXT PRIMARY KEY,
        source_run TEXT NOT NULL,
        status TEXT NOT NULL,
        confidence REAL NOT NULL,
        reuse_potential TEXT NOT NULL,
        trigger_json TEXT NOT NULL,
        problem TEXT NOT NULL,
        rule_text TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE recipes (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        confidence REAL NOT NULL,
        trigger_json TEXT NOT NULL,
        action_json TEXT NOT NULL,
        reason TEXT NOT NULL,
        source_run TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        use_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used_at TEXT,
        archived_at TEXT
      ) STRICT;

      CREATE TABLE recipe_usage (
        id TEXT PRIMARY KEY,
        recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        run_id TEXT,
        task_id TEXT,
        outcome TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        evidence_json TEXT NOT NULL
      ) STRICT;

      CREATE INDEX idx_recipes_status ON recipes(status, pinned DESC, confidence DESC);
      CREATE INDEX idx_recipe_usage_recipe ON recipe_usage(recipe_id, occurred_at DESC);
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE lessons ADD COLUMN validated_at TEXT;
      ALTER TABLE lessons ADD COLUMN validated_by TEXT;
      ALTER TABLE lessons ADD COLUMN validation_evidence_json TEXT;
      ALTER TABLE recipes ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE lessons ADD COLUMN action_json TEXT;
    `,
  },
];

const SOURCE_TYPES = new Set(["FILE", "CONTRACT", "TEST", "RUN_EVENT", "USER"]);
const PASS_VALUES = new Set(["PASS", "PASSED", "SUCCESS", "OK", "TRUE"]);

export class ProjectKnowledgeError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "ProjectKnowledgeError";
    this.code = code;
    this.details = details;
  }
}

export function projectKnowledgePaths(projectRoot = process.cwd()) {
  const root = resolve(projectRoot);
  const orchestratorRoot = join(root, ".orchestrator");
  return {
    projectRoot: root,
    orchestratorRoot,
    memoryFile: join(orchestratorRoot, "project-memory.md"),
    knowledgeDb: join(orchestratorRoot, "knowledge.db"),
    historyDb: join(orchestratorRoot, "history.db"),
    learnedDir: join(orchestratorRoot, "learned"),
    archiveDir: join(orchestratorRoot, "learned", ".archive"),
    backupDir: join(orchestratorRoot, "backups", "knowledge"),
    telemetryFile: join(orchestratorRoot, "telemetry.jsonl"),
  };
}

export function openKnowledgeStore(projectRoot, options = {}) {
  const paths = projectKnowledgePaths(projectRoot);
  mkdirSync(paths.orchestratorRoot, { recursive: true });
  const db = openSqlite(paths.knowledgeDb, options);
  if (!options.readOnly) applyMigrations(db, "project-knowledge", KNOWLEDGE_MIGRATIONS);
  return { db, paths };
}

function insideProject(projectRoot, path) {
  const absolute = isAbsolute(path) ? resolve(path) : resolve(projectRoot, path);
  const rel = relative(projectRoot, absolute);
  return {
    absolute,
    relative: rel === "" ? "." : rel.split(sep).join("/"),
    inside: rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`)),
  };
}

function normalizeSourceType(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!SOURCE_TYPES.has(normalized)) {
    throw new ProjectKnowledgeError(
      "INVALID_EVIDENCE_SOURCE",
      `Evidence source must be one of ${[...SOURCE_TYPES].join(", ")}`,
    );
  }
  return normalized;
}

function normalizeDisplayValue(value) {
  if (typeof value === "string") return value.trim();
  return stableJson(value);
}

export function findDurableRunEvent(projectRoot, sourceRef, expectedRunId = null) {
  const orchestrationRoot = join(resolve(projectRoot), ".orchestration");
  if (!existsSync(orchestrationRoot)) return null;
  const eventId = String(sourceRef)
    .replace(/^event:/i, "")
    .split(/[#:]/)
    .at(-1)
    .trim();
  if (!eventId) return null;
  const directories = readdirSync(orchestrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(orchestrationRoot, entry.name));
  for (const directory of directories) {
    const path = join(directory, "events.jsonl");
    if (!existsSync(path) || statSync(path).size > 64 * 1024 * 1024) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)) {
      try {
        const event = JSON.parse(line);
        if (
          event.eventId === eventId &&
          (!expectedRunId || event.runId === expectedRunId)
        ) {
          return event;
        }
      } catch {
        // A corrupt run is handled by the State Engine; it cannot validate a fact.
      }
    }
  }
  return null;
}

function validateEvidence(projectRoot, input) {
  const kind = normalizeSourceType(input.sourceType);
  const sourceRef = String(input.sourceRef ?? "").trim();
  if (!sourceRef) {
    throw new ProjectKnowledgeError(
      "EVIDENCE_SOURCE_REQUIRED",
      "Validated facts require a non-empty sourceRef",
    );
  }
  const observedAt = input.observedAt ?? new Date().toISOString();
  const payload = input.evidence && typeof input.evidence === "object"
    ? input.evidence
    : { value: input.evidence ?? null };
  let sourceHash = null;
  let normalizedRef = sourceRef;

  if (["FILE", "CONTRACT"].includes(kind)) {
    const located = insideProject(projectRoot, sourceRef);
    if (!located.inside || !existsSync(located.absolute) || !statSync(located.absolute).isFile()) {
      throw new ProjectKnowledgeError(
        "EVIDENCE_FILE_NOT_FOUND",
        `Evidence file must exist inside the project: ${sourceRef}`,
      );
    }
    const content = readFileSync(located.absolute);
    sourceHash = sha256(content);
    normalizedRef = located.relative;
  } else if (kind === "TEST") {
    const result = String(input.sourceStatus ?? payload.status ?? "").toUpperCase();
    if (!PASS_VALUES.has(result)) {
      throw new ProjectKnowledgeError(
        "TEST_EVIDENCE_NOT_PASSING",
        `Test evidence must be passing, received ${result || "no status"}`,
      );
    }
    sourceHash = sha256(stableJson({ sourceRef, result, payload }));
  } else if (kind === "RUN_EVENT") {
    const event = findDurableRunEvent(projectRoot, sourceRef, input.runId ?? null);
    if (!event) {
      throw new ProjectKnowledgeError(
        "RUN_EVENT_EVIDENCE_NOT_FOUND",
        `Durable run event was not found: ${sourceRef}`,
      );
    }
    normalizedRef = `event:${event.runId}:${event.eventId}`;
    sourceHash = sha256(stableJson(event));
  } else {
    sourceHash = sha256(stableJson({ kind, sourceRef, payload }));
  }

  return {
    id: input.evidenceId ?? `ev-${sha256(`${kind}\0${normalizedRef}\0${sourceHash}`).slice(0, 24)}`,
    kind,
    sourceRef: normalizedRef,
    sourceHash,
    status: "VALIDATED",
    payload,
    observedAt,
    runId: input.runId ?? null,
  };
}

function factRowWithEvidence(db, factId) {
  const fact = plainRow(db.prepare("SELECT * FROM facts WHERE id = ?").get(factId));
  if (!fact) return null;
  fact.value = JSON.parse(fact.value_json);
  fact.pinned = Boolean(fact.pinned);
  fact.evidence = plainRows(db.prepare(`
    SELECT e.* FROM evidence e
    JOIN fact_evidence fe ON fe.evidence_id = e.id
    WHERE fe.fact_id = ?
    ORDER BY e.observed_at DESC
  `).all(factId)).map((entry) => ({
    ...entry,
    payload: JSON.parse(entry.payload_json),
  }));
  return fact;
}

export function addValidatedFact(projectRoot, input) {
  const section = String(input.section ?? "").trim();
  const factKey = String(input.key ?? "").trim();
  if (!section || !factKey) {
    throw new ProjectKnowledgeError(
      "FACT_IDENTITY_REQUIRED",
      "A fact requires section and key",
    );
  }
  const displayValue = normalizeDisplayValue(input.value);
  if (!displayValue) {
    throw new ProjectKnowledgeError("FACT_VALUE_REQUIRED", "A fact requires a value");
  }
  const evidence = validateEvidence(resolve(projectRoot), input);
  const valueJson = stableJson(input.value);
  const fingerprint = sha256(`${section.toLowerCase()}\0${factKey.toLowerCase()}\0${valueJson}`);
  const factId = input.id ?? `fact-${fingerprint.slice(0, 24)}`;
  const now = input.observedAt ?? new Date().toISOString();
  const { db } = openKnowledgeStore(projectRoot);
  try {
    return withTransaction(db, () => {
      db.prepare(`
        INSERT INTO evidence(id, kind, source_ref, source_hash, status, payload_json, observed_at, run_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status=excluded.status,
          payload_json=excluded.payload_json,
          observed_at=excluded.observed_at,
          run_id=COALESCE(excluded.run_id, evidence.run_id)
      `).run(
        evidence.id,
        evidence.kind,
        evidence.sourceRef,
        evidence.sourceHash,
        evidence.status,
        stableJson(evidence.payload),
        evidence.observedAt,
        evidence.runId,
      );

      const duplicate = plainRow(db.prepare("SELECT id FROM facts WHERE fingerprint = ?").get(fingerprint));
      if (duplicate) {
        db.prepare("INSERT OR IGNORE INTO fact_evidence(fact_id, evidence_id) VALUES (?, ?)")
          .run(duplicate.id, evidence.id);
        db.prepare("UPDATE facts SET updated_at = ? WHERE id = ?").run(now, duplicate.id);
        return { created: false, conflict: false, fact: factRowWithEvidence(db, duplicate.id) };
      }

      const active = plainRows(db.prepare(`
        SELECT f.*, e.kind AS evidence_kind, e.source_ref AS evidence_source_ref
        FROM facts f
        LEFT JOIN fact_evidence fe ON fe.fact_id = f.id
        LEFT JOIN evidence e ON e.id = fe.evidence_id
        WHERE lower(f.section) = lower(?) AND lower(f.fact_key) = lower(?)
          AND f.status = 'VALIDATED'
        ORDER BY f.updated_at DESC
      `).all(section, factKey));
      const sameSource = active.find((row) =>
        row.evidence_kind === evidence.kind && row.evidence_source_ref === evidence.sourceRef,
      );
      if (sameSource) {
        db.prepare(`
          UPDATE facts SET status='REVOKED', revoked_at=?, revocation_reason=?, updated_at=? WHERE id=?
        `).run(now, `Superseded by a newer validated observation from ${evidence.kind}:${evidence.sourceRef}`, now, sameSource.id);
      }
      const conflict = active.length > 0 && !sameSource;
      const status = conflict ? "CONFLICT" : "VALIDATED";
      db.prepare(`
        INSERT INTO facts(
          id, section, fact_key, value_json, display_value, status, confidence,
          fingerprint, pinned, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        factId,
        section,
        factKey,
        valueJson,
        displayValue,
        status,
        Number(input.confidence ?? 1),
        fingerprint,
        input.pinned ? 1 : 0,
        now,
        now,
      );
      db.prepare("INSERT INTO fact_evidence(fact_id, evidence_id) VALUES (?, ?)")
        .run(factId, evidence.id);
      return {
        created: true,
        conflict,
        fact: factRowWithEvidence(db, factId),
        conflictingFactIds: conflict ? [...new Set(active.map((row) => row.id))] : [],
      };
    });
  } finally {
    db.close();
  }
}

export function revokeFact(projectRoot, factId, reason, options = {}) {
  if (!reason) {
    throw new ProjectKnowledgeError("REVOCATION_REASON_REQUIRED", "Fact revocation requires a reason");
  }
  const { db } = openKnowledgeStore(projectRoot);
  try {
    const now = options.now ?? new Date().toISOString();
    const result = db.prepare(`
      UPDATE facts
      SET status='REVOKED', revoked_at=?, revocation_reason=?, updated_at=?
      WHERE id=? AND status <> 'REVOKED'
    `).run(now, reason, now, factId);
    if (Number(result.changes) === 0) {
      throw new ProjectKnowledgeError("FACT_NOT_FOUND", `Active fact not found: ${factId}`);
    }
    return factRowWithEvidence(db, factId);
  } finally {
    db.close();
  }
}

export function pinFact(projectRoot, factId, pinned = true, options = {}) {
  const { db } = openKnowledgeStore(projectRoot);
  try {
    const result = db.prepare("UPDATE facts SET pinned=?, updated_at=? WHERE id=?")
      .run(pinned ? 1 : 0, options.now ?? new Date().toISOString(), factId);
    if (Number(result.changes) === 0) {
      throw new ProjectKnowledgeError("FACT_NOT_FOUND", `Fact not found: ${factId}`);
    }
    return factRowWithEvidence(db, factId);
  } finally {
    db.close();
  }
}

export function listFacts(projectRoot, options = {}) {
  const { db } = openKnowledgeStore(projectRoot);
  try {
    const status = options.status ? String(options.status).toUpperCase() : null;
    const rows = status
      ? plainRows(db.prepare(`
          SELECT id FROM facts WHERE status=? ORDER BY pinned DESC, section, fact_key, updated_at DESC
        `).all(status))
      : plainRows(db.prepare(`
          SELECT id FROM facts ORDER BY pinned DESC, section, fact_key, updated_at DESC
        `).all());
    return rows.map((row) => factRowWithEvidence(db, row.id));
  } finally {
    db.close();
  }
}

export function auditKnowledgeSources(projectRoot, options = {}) {
  const root = resolve(projectRoot);
  const { db } = openKnowledgeStore(root);
  try {
    const now = options.now ?? new Date().toISOString();
    const rows = plainRows(db.prepare(`
      SELECT DISTINCT f.id, e.kind, e.source_ref, e.source_hash
      FROM facts f
      JOIN fact_evidence fe ON fe.fact_id=f.id
      JOIN evidence e ON e.id=fe.evidence_id
      WHERE f.status='VALIDATED' AND e.kind IN ('FILE', 'CONTRACT', 'RUN_EVENT')
    `).all());
    const stale = [];
    withTransaction(db, () => {
      for (const row of rows) {
        let valid;
        let currentHash;
        if (row.kind === "RUN_EVENT") {
          const parts = String(row.source_ref).split(":");
          const event = findDurableRunEvent(root, row.source_ref, parts.length >= 3 ? parts[1] : null);
          valid = event != null;
          currentHash = event ? sha256(stableJson(event)) : null;
        } else {
          const located = insideProject(root, row.source_ref);
          valid = located.inside && existsSync(located.absolute) && statSync(located.absolute).isFile();
          currentHash = valid ? sha256(readFileSync(located.absolute)) : null;
        }
        if (!valid || currentHash !== row.source_hash) {
          db.prepare(`
            UPDATE facts SET status='STALE', updated_at=?, revocation_reason=? WHERE id=?
          `).run(now, valid ? "Evidence source changed" : "Evidence source disappeared", row.id);
          stale.push({ factId: row.id, sourceRef: row.source_ref, reason: valid ? "CHANGED" : "MISSING" });
        }
      }
    });
    return { checked: rows.length, stale };
  } finally {
    db.close();
  }
}

function sectionTitle(value) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function renderProjectMemory(projectRoot, options = {}) {
  const paths = projectKnowledgePaths(projectRoot);
  const maxFacts = Number(options.maxFacts ?? 100);
  const maxChars = Number(options.maxChars ?? 16_000);
  const facts = listFacts(projectRoot, { status: "VALIDATED" }).slice(0, maxFacts);
  const sections = new Map();
  for (const fact of facts) {
    if (!sections.has(fact.section)) sections.set(fact.section, []);
    sections.get(fact.section).push(fact);
  }
  const lines = [
    "# PROJECT MEMORY",
    "",
    "> Deterministic projection of validated, revocable project facts. Inferences and conflicts are excluded.",
    "",
  ];
  for (const [section, entries] of sections) {
    lines.push(`## ${sectionTitle(section)}`, "");
    for (const fact of entries) {
      const sources = fact.evidence.map((item) => `${item.kind}:${item.source_ref}`).join(", ");
      lines.push(`- ${fact.fact_key}: ${fact.display_value}`);
      lines.push(`  - VALIDATED · SOURCE: ${sources} · FACT: ${fact.id}`);
    }
    lines.push("");
  }
  if (facts.length === 0) lines.push("_No validated facts recorded yet._", "");
  let content = `${lines.join("\n").trimEnd()}\n`;
  let truncated = false;
  if (content.length > maxChars) {
    content = `${content.slice(0, Math.max(0, maxChars - 90)).trimEnd()}\n\n_Projection truncated; query knowledge.db for the complete set._\n`;
    truncated = true;
  }
  mkdirSync(dirname(paths.memoryFile), { recursive: true });
  writeFileSync(paths.memoryFile, content, "utf8");
  return {
    path: paths.memoryFile,
    factsProjected: facts.length,
    sections: [...sections.keys()],
    truncated,
    bytes: Buffer.byteLength(content),
  };
}

export function knowledgeStatus(projectRoot) {
  const { db, paths } = openKnowledgeStore(projectRoot);
  try {
    const counts = plainRows(db.prepare(`
      SELECT status, COUNT(*) AS count FROM facts GROUP BY status ORDER BY status
    `).all());
    const lessonCounts = plainRows(db.prepare(`
      SELECT status, COUNT(*) AS count FROM lessons GROUP BY status ORDER BY status
    `).all());
    const recipeCounts = plainRows(db.prepare(`
      SELECT status, COUNT(*) AS count FROM recipes GROUP BY status ORDER BY status
    `).all());
    return {
      paths,
      health: databaseHealth(db),
      facts: Object.fromEntries(counts.map((row) => [row.status, Number(row.count)])),
      lessons: Object.fromEntries(lessonCounts.map((row) => [row.status, Number(row.count)])),
      recipes: Object.fromEntries(recipeCounts.map((row) => [row.status, Number(row.count)])),
      memoryExists: existsSync(paths.memoryFile),
    };
  } finally {
    db.close();
  }
}

export function newKnowledgeId(prefix) {
  return `${prefix}-${randomUUID()}`;
}
