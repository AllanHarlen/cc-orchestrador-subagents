import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";

import {
  openKnowledgeStore,
  projectKnowledgePaths,
  renderProjectMemory,
} from "./project-knowledge.mjs";
import { archiveRecipe, listRecipes } from "./learning-recipes.mjs";
import { plainRow, plainRows, sha256, stableJson, withTransaction } from "./sqlite-store.mjs";

export class CuratorError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "CuratorError";
    this.code = code;
    this.details = details;
  }
}

function safeTimestamp(now = new Date().toISOString()) {
  return now.replace(/[:.]/g, "-");
}

function assertBackupId(value) {
  const id = String(value ?? "").trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new CuratorError("INVALID_BACKUP_ID", "Backup ID contains unsafe characters");
  }
  return id;
}

function ageDays(timestamp, nowMs) {
  const time = Date.parse(timestamp ?? "");
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, (nowMs - time) / 86_400_000);
}

function recipeActivityTimestamp(recipe) {
  return recipe.lastUsedAt ?? recipe.updatedAt ?? recipe.createdAt;
}

function fileHash(path) {
  return existsSync(path) && statSync(path).isFile() ? sha256(readFileSync(path)) : null;
}

function walkFiles(root, prefix = "") {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(absolute, relative));
    else if (entry.isFile()) files.push({ path: relative, sha256: fileHash(absolute) });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function checkpointKnowledgeDb(projectRoot) {
  const { db } = openKnowledgeStore(projectRoot);
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
}

export function createKnowledgeBackup(projectRoot, options = {}) {
  const paths = projectKnowledgePaths(projectRoot);
  checkpointKnowledgeDb(projectRoot);
  mkdirSync(paths.backupDir, { recursive: true });
  const createdAt = options.now ?? new Date().toISOString();
  const id = assertBackupId(
    options.id ?? `knowledge-${safeTimestamp(createdAt)}-${randomUUID().slice(0, 8)}`,
  );
  const destination = join(paths.backupDir, id);
  if (existsSync(destination)) {
    throw new CuratorError("BACKUP_EXISTS", `Knowledge backup already exists: ${id}`);
  }
  mkdirSync(destination, { recursive: false });
  if (existsSync(paths.knowledgeDb)) copyFileSync(paths.knowledgeDb, join(destination, "knowledge.db"));
  if (existsSync(paths.memoryFile)) copyFileSync(paths.memoryFile, join(destination, "project-memory.md"));
  if (existsSync(paths.learnedDir)) {
    cpSync(paths.learnedDir, join(destination, "learned"), { recursive: true, force: false });
  }
  const manifest = {
    schemaVersion: 1,
    id,
    createdAt,
    reason: options.reason ?? "manual",
    files: [
      { path: "knowledge.db", sha256: fileHash(join(destination, "knowledge.db")) },
      { path: "project-memory.md", sha256: fileHash(join(destination, "project-memory.md")) },
      ...walkFiles(join(destination, "learned"), "learned"),
    ].filter((entry) => entry.sha256),
  };
  writeFileSync(join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { ...manifest, path: destination };
}

export function listKnowledgeBackups(projectRoot) {
  const { backupDir } = projectKnowledgePaths(projectRoot);
  if (!existsSync(backupDir)) return [];
  return readdirSync(backupDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(backupDir, entry.name, "manifest.json")))
    .map((entry) => {
      try {
        return JSON.parse(readFileSync(join(backupDir, entry.name, "manifest.json"), "utf8"));
      } catch (error) {
        return { id: entry.name, corrupt: true, error: error.message };
      }
    })
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}

function contradictionGroups(recipes) {
  const byTrigger = new Map();
  for (const recipe of recipes.filter((item) => item.status !== "ARCHIVED")) {
    const fingerprint = sha256(stableJson(recipe.trigger));
    const items = byTrigger.get(fingerprint) ?? [];
    items.push(recipe);
    byTrigger.set(fingerprint, items);
  }
  return [...byTrigger.entries()]
    .map(([triggerFingerprint, items]) => ({
      triggerFingerprint,
      recipeIds: items.map((item) => item.id),
      actionFingerprints: [...new Set(items.map((item) => sha256(stableJson(item.action))))],
    }))
    .filter((group) => group.recipeIds.length > 1 && group.actionFingerprints.length > 1);
}

export function curatorStatus(projectRoot, options = {}) {
  const now = Date.parse(options.now ?? new Date().toISOString());
  const staleDays = Number(options.staleDays ?? 90);
  const archiveDays = Number(options.archiveDays ?? 180);
  const recipes = listRecipes(projectRoot).map((recipe) => ({
    ...recipe,
    ageDays: Number(ageDays(recipeActivityTimestamp(recipe), now).toFixed(1)),
    successRate: recipe.useCount ? recipe.successCount / recipe.useCount : null,
  }));
  const contradictions = contradictionGroups(recipes);
  return {
    generatedAt: new Date(now).toISOString(),
    thresholds: { staleDays, archiveDays },
    counts: {
      total: recipes.length,
      active: recipes.filter((item) => item.status === "ACTIVE").length,
      stale: recipes.filter((item) => item.status === "STALE").length,
      archived: recipes.filter((item) => item.status === "ARCHIVED").length,
      pinned: recipes.filter((item) => item.pinned).length,
      needsReview: recipes.filter((item) => item.needsReview).length,
      contradictions: contradictions.length,
    },
    contradictions,
    recipes,
  };
}

export function curateKnowledge(projectRoot, options = {}) {
  const dryRun = options.dryRun !== false;
  const nowIso = options.now ?? new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const staleDays = Number(options.staleDays ?? 90);
  const archiveDays = Number(options.archiveDays ?? 180);
  if (!Number.isFinite(staleDays) || !Number.isFinite(archiveDays) || archiveDays < staleDays) {
    throw new CuratorError(
      "INVALID_CURATOR_THRESHOLDS",
      "archiveDays must be greater than or equal to staleDays",
    );
  }
  const before = curatorStatus(projectRoot, { now: nowIso, staleDays, archiveDays });
  const transitions = [];
  for (const recipe of before.recipes) {
    if (recipe.pinned || recipe.status === "ARCHIVED") continue;
    if (recipe.status === "ACTIVE" && recipe.ageDays >= staleDays) {
      transitions.push({ id: recipe.id, from: "ACTIVE", to: "STALE", reason: "unused" });
    } else if (recipe.status === "STALE" && recipe.ageDays >= archiveDays) {
      transitions.push({ id: recipe.id, from: "STALE", to: "ARCHIVED", reason: "long-unused" });
    }
  }
  const contradictionIds = [...new Set(before.contradictions.flatMap((item) => item.recipeIds))];
  if (dryRun || (transitions.length === 0 && contradictionIds.length === 0)) {
    return { dryRun, backup: null, transitions, contradictionIds, before, after: before };
  }

  const backup = createKnowledgeBackup(projectRoot, {
    now: nowIso,
    reason: "curator-before-mutation",
  });
  const { db } = openKnowledgeStore(projectRoot);
  try {
    withTransaction(db, () => {
      db.prepare("UPDATE recipes SET needs_review=0 WHERE needs_review<>0").run();
      for (const recipeId of contradictionIds) {
        db.prepare("UPDATE recipes SET needs_review=1, updated_at=? WHERE id=?")
          .run(nowIso, recipeId);
      }
      for (const transition of transitions.filter((entry) => entry.to === "STALE")) {
        db.prepare("UPDATE recipes SET status='STALE', updated_at=? WHERE id=? AND pinned=0 AND status='ACTIVE'")
          .run(nowIso, transition.id);
      }
    });
  } finally {
    db.close();
  }
  for (const transition of transitions.filter((entry) => entry.to === "ARCHIVED")) {
    archiveRecipe(projectRoot, transition.id, { now: nowIso });
  }
  renderProjectMemory(projectRoot);
  return {
    dryRun,
    backup,
    transitions,
    contradictionIds,
    before,
    after: curatorStatus(projectRoot, { now: nowIso, staleDays, archiveDays }),
  };
}

export function activateRecipe(projectRoot, recipeId, options = {}) {
  const id = String(recipeId ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,100}$/.test(id)) {
    throw new CuratorError("INVALID_RECIPE_ID", "Invalid recipe ID");
  }
  const paths = projectKnowledgePaths(projectRoot);
  const { db } = openKnowledgeStore(projectRoot);
  try {
    const row = plainRow(db.prepare("SELECT id, status FROM recipes WHERE id=?").get(id));
    if (!row) throw new CuratorError("RECIPE_NOT_FOUND", `Recipe not found: ${id}`);
    const now = options.now ?? new Date().toISOString();
    db.prepare("UPDATE recipes SET status='ACTIVE', archived_at=NULL, updated_at=? WHERE id=?")
      .run(now, id);
    const archived = join(paths.archiveDir, `${basename(id)}.md`);
    const active = join(paths.learnedDir, `${id}.md`);
    if (existsSync(archived) && !existsSync(active)) {
      mkdirSync(paths.learnedDir, { recursive: true });
      renameSync(archived, active);
    }
    return plainRow(db.prepare("SELECT id, status, pinned, needs_review FROM recipes WHERE id=?").get(id));
  } finally {
    db.close();
  }
}

export function rollbackKnowledge(projectRoot, backupId, options = {}) {
  const paths = projectKnowledgePaths(projectRoot);
  const id = assertBackupId(backupId);
  const source = join(paths.backupDir, id);
  const manifestPath = join(source, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new CuratorError("BACKUP_NOT_FOUND", `Knowledge backup not found: ${id}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const entry of manifest.files ?? []) {
    const path = join(source, entry.path);
    if (!existsSync(path) || fileHash(path) !== entry.sha256) {
      throw new CuratorError(
        "BACKUP_INTEGRITY_FAILED",
        `Backup file failed integrity validation: ${entry.path}`,
      );
    }
  }
  if (options.dryRun !== false) {
    return { dryRun: true, backup: manifest, wouldRestore: manifest.files.map((entry) => entry.path) };
  }
  const safetyBackup = createKnowledgeBackup(projectRoot, {
    reason: `pre-rollback-to-${id}`,
    now: options.now,
  });
  const displaced = join(paths.backupDir, `.displaced-${safeTimestamp(options.now)}-${randomUUID().slice(0, 8)}`);
  if (existsSync(paths.learnedDir)) renameSync(paths.learnedDir, displaced);
  if (existsSync(join(source, "knowledge.db"))) copyFileSync(join(source, "knowledge.db"), paths.knowledgeDb);
  if (existsSync(join(source, "project-memory.md"))) {
    copyFileSync(join(source, "project-memory.md"), paths.memoryFile);
  }
  if (existsSync(join(source, "learned"))) {
    cpSync(join(source, "learned"), paths.learnedDir, { recursive: true, force: false });
  } else {
    mkdirSync(paths.learnedDir, { recursive: true });
  }
  checkpointKnowledgeDb(projectRoot);
  return {
    dryRun: false,
    restored: manifest,
    safetyBackup,
    displacedLearnedDir: existsSync(displaced) ? displaced : null,
  };
}
