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

import { runRootCandidates } from "./artifact-layout.mjs";
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

export const SOURCE_TYPES = Object.freeze([
  "FILE",
  "CONTRACT",
  "TEST",
  "RUN_EVENT",
  "USER",
  "GRAPH",
]);

/**
 * Evidence kinds that stand on their own as proof of a fact. `GRAPH` (Codebase Memory MCP)
 * is corroborative only: it never validates a fact by itself.
 */
export const CORROBORATING_SOURCE_TYPES = Object.freeze(["FILE", "CONTRACT", "TEST", "RUN_EVENT"]);

/** Evidence kinds that the audit can rehydrate from disk or from the durable event log. */
export const REHYDRATABLE_SOURCE_TYPES = Object.freeze(["FILE", "CONTRACT", "RUN_EVENT"]);

/** Fields required in the payload of a `GRAPH` evidence; also the basis of its stable hash. */
export const GRAPH_EVIDENCE_FIELDS = Object.freeze([
  "projectId",
  "tool",
  "queriedAt",
  "resultDigest",
]);

const SOURCE_TYPE_SET = new Set(SOURCE_TYPES);
const CORROBORATING_SOURCE_TYPE_SET = new Set(CORROBORATING_SOURCE_TYPES);
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
  if (!SOURCE_TYPE_SET.has(normalized)) {
    throw new ProjectKnowledgeError(
      "INVALID_EVIDENCE_SOURCE",
      `Evidence source must be one of ${SOURCE_TYPES.join(", ")}`,
    );
  }
  return normalized;
}

function graphText(value) {
  if (value == null) return "";
  return typeof value === "string" ? value.trim() : String(value).trim();
}

/**
 * A `GRAPH` sourceRef is `graph:<projectId>:<tool>`. The tool name never contains a colon,
 * so the last segment is the tool and everything between the prefix and it is the projectId.
 */
function parseGraphSourceRef(sourceRef) {
  const match = /^graph:(.+):([^:]+)$/.exec(sourceRef);
  if (!match) return null;
  const projectId = match[1].trim();
  const tool = match[2].trim();
  if (!projectId || !tool) return null;
  return { projectId, tool };
}

function normalizeGraphEvidence(sourceRef, payload) {
  const parsedRef = parseGraphSourceRef(sourceRef);
  const source = payload && typeof payload === "object" ? payload : {};
  const fields = {
    projectId: graphText(source.projectId) || (parsedRef?.projectId ?? ""),
    tool: graphText(source.tool) || (parsedRef?.tool ?? ""),
    queriedAt: graphText(source.queriedAt),
    resultDigest: graphText(source.resultDigest),
  };
  const missing = GRAPH_EVIDENCE_FIELDS.filter((field) => !fields[field]);
  if (missing.length > 0) {
    throw new ProjectKnowledgeError(
      "GRAPH_EVIDENCE_PAYLOAD_INVALID",
      `Graph evidence requires ${GRAPH_EVIDENCE_FIELDS.join(", ")}; missing: ${missing.join(", ")}`,
      { sourceRef, missing },
    );
  }
  if (!Number.isFinite(Date.parse(fields.queriedAt))) {
    throw new ProjectKnowledgeError(
      "GRAPH_EVIDENCE_PAYLOAD_INVALID",
      `Graph evidence queriedAt must be a parseable timestamp, received ${fields.queriedAt}`,
      { sourceRef, field: "queriedAt", received: fields.queriedAt },
    );
  }
  const expectedRef = `graph:${fields.projectId}:${fields.tool}`;
  if (sourceRef !== expectedRef) {
    throw new ProjectKnowledgeError(
      "GRAPH_EVIDENCE_SOURCE_REF_INVALID",
      `Graph evidence sourceRef must be graph:<projectId>:<tool>; expected ${expectedRef}, received ${sourceRef}`,
      { expected: expectedRef, received: sourceRef },
    );
  }
  const stablePayload = Object.fromEntries(
    GRAPH_EVIDENCE_FIELDS.map((field) => [field, fields[field]]),
  );
  return {
    sourceRef: expectedRef,
    stablePayload,
    payload: { ...source, ...stablePayload },
  };
}

function normalizeDisplayValue(value) {
  if (typeof value === "string") return value.trim();
  return stableJson(value);
}

const RUN_EVENT_SCAN_SIZE_LIMIT_BYTES = 64 * 1024 * 1024;

// Returns `{ event, skippedOversized }` rather than a bare event so a caller
// that gets `event: null` can tell "genuinely not found" apart from "an
// events.jsonl over the size limit was skipped, so this may be a false
// negative" (N-18) — the two used to be indistinguishable.
export function findDurableRunEvent(projectRoot, sourceRef, expectedRunId = null) {
  // Achado 14: procura o evento em qualquer uma das duas raizes de run —
  // `.orchestrator/runs/<slug>/` (atual) e `.orchestration/<slug>/` (legado).
  const roots = runRootCandidates(projectRoot).filter((candidate) => candidate.exists);
  if (roots.length === 0) return { event: null, skippedOversized: [] };
  const eventId = String(sourceRef)
    .replace(/^event:/i, "")
    .split(/[#:]/)
    .at(-1)
    .trim();
  if (!eventId) return { event: null, skippedOversized: [] };
  const directories = roots.flatMap(({ root }) =>
    readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name)),
  );
  const skippedOversized = [];
  for (const directory of directories) {
    const path = join(directory, "events.jsonl");
    if (!existsSync(path)) continue;
    const size = statSync(path).size;
    if (size > RUN_EVENT_SCAN_SIZE_LIMIT_BYTES) {
      skippedOversized.push({ path, size });
      continue;
    }
    for (const line of readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)) {
      try {
        const event = JSON.parse(line);
        if (
          event.eventId === eventId &&
          (!expectedRunId || event.runId === expectedRunId)
        ) {
          return { event, skippedOversized };
        }
      } catch {
        // A corrupt run is handled by the State Engine; it cannot validate a fact.
      }
    }
  }
  return { event: null, skippedOversized };
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
  let payload = input.evidence && typeof input.evidence === "object"
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
    const { event, skippedOversized } = findDurableRunEvent(projectRoot, sourceRef, input.runId ?? null);
    if (!event) {
      const oversizedNote = skippedOversized.length > 0
        ? ` (${skippedOversized.length} events.jsonl file(s) over the ${RUN_EVENT_SCAN_SIZE_LIMIT_BYTES / (1024 * 1024)}MB scan limit were skipped and not searched — this may be a false negative: ${skippedOversized.map((s) => s.path).join(", ")})`
        : "";
      throw new ProjectKnowledgeError(
        "RUN_EVENT_EVIDENCE_NOT_FOUND",
        `Durable run event was not found: ${sourceRef}${oversizedNote}`,
      );
    }
    normalizedRef = `event:${event.runId}:${event.eventId}`;
    sourceHash = sha256(stableJson(event));
  } else if (kind === "GRAPH") {
    // The code graph has no artifact to rehydrate, so the identity of the observation is the
    // stable payload itself: indexed project, tool, query timestamp and digest of the result.
    const graph = normalizeGraphEvidence(sourceRef, payload);
    normalizedRef = graph.sourceRef;
    payload = graph.payload;
    sourceHash = sha256(stableJson(graph.stablePayload));
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

/**
 * A fact carries its primary evidence plus any corroborating evidence declared in the same
 * call (`corroboration` accepts one entry or a list). Every entry is validated by the rules of
 * its own kind; duplicates collapse by evidence id.
 */
function validateFactEvidence(projectRoot, input) {
  const extra = input.corroboration ?? input.corroborations ?? [];
  const additional = (Array.isArray(extra) ? extra : [extra]).filter((entry) => entry != null);
  const inputs = [
    input,
    ...additional.map((entry) => ({
      runId: input.runId ?? null,
      observedAt: input.observedAt,
      ...entry,
    })),
  ];
  const byId = new Map();
  for (const entry of inputs) {
    const validated = validateEvidence(projectRoot, entry);
    if (!byId.has(validated.id)) byId.set(validated.id, validated);
  }
  return [...byId.values()];
}

/**
 * Requirement 8.11: graph output is corroborative evidence. A fact whose only evidence is
 * `GRAPH` is rejected; the graph is accepted when it arrives with `FILE`, `CONTRACT`, a passing
 * `TEST` or a `RUN_EVENT` — either in the same call or already attached to the same fact.
 */
function assertGraphCorroboration(db, { evidenceList, fingerprint, section, factKey }) {
  const graph = evidenceList.filter((entry) => entry.kind === "GRAPH");
  if (graph.length === 0) return;
  if (evidenceList.some((entry) => CORROBORATING_SOURCE_TYPE_SET.has(entry.kind))) return;
  const placeholders = CORROBORATING_SOURCE_TYPES.map(() => "?").join(", ");
  const existing = plainRow(db.prepare(`
    SELECT e.id FROM facts f
    JOIN fact_evidence fe ON fe.fact_id = f.id
    JOIN evidence e ON e.id = fe.evidence_id
    WHERE f.fingerprint = ? AND f.status = 'VALIDATED' AND e.kind IN (${placeholders})
    LIMIT 1
  `).get(fingerprint, ...CORROBORATING_SOURCE_TYPES));
  if (existing) return;
  throw new ProjectKnowledgeError(
    "GRAPH_EVIDENCE_REQUIRES_CORROBORATION",
    `Graph evidence cannot validate a fact alone; add ${CORROBORATING_SOURCE_TYPES.join(", ")} evidence for ${section}/${factKey}`,
    {
      section,
      key: factKey,
      graphSourceRefs: graph.map((entry) => entry.sourceRef),
      accepted: [...CORROBORATING_SOURCE_TYPES],
    },
  );
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
  const evidenceList = validateFactEvidence(resolve(projectRoot), input);
  const valueJson = stableJson(input.value);
  const fingerprint = sha256(`${section.toLowerCase()}\0${factKey.toLowerCase()}\0${valueJson}`);
  const factId = input.id ?? `fact-${fingerprint.slice(0, 24)}`;
  const now = input.observedAt ?? new Date().toISOString();
  const { db } = openKnowledgeStore(projectRoot);
  try {
    return withTransaction(db, () => {
      assertGraphCorroboration(db, {
        evidenceList,
        fingerprint,
        section,
        factKey,
      });

      for (const entry of evidenceList) {
        db.prepare(`
          INSERT INTO evidence(id, kind, source_ref, source_hash, status, payload_json, observed_at, run_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            status=excluded.status,
            payload_json=excluded.payload_json,
            observed_at=excluded.observed_at,
            run_id=COALESCE(excluded.run_id, evidence.run_id)
        `).run(
          entry.id,
          entry.kind,
          entry.sourceRef,
          entry.sourceHash,
          entry.status,
          stableJson(entry.payload),
          entry.observedAt,
          entry.runId,
        );
      }

      const duplicate = plainRow(db.prepare("SELECT id FROM facts WHERE fingerprint = ?").get(fingerprint));
      if (duplicate) {
        for (const entry of evidenceList) {
          db.prepare("INSERT OR IGNORE INTO fact_evidence(fact_id, evidence_id) VALUES (?, ?)")
            .run(duplicate.id, entry.id);
        }
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
      const superseded = new Map();
      for (const row of active) {
        const match = evidenceList.find((entry) =>
          row.evidence_kind === entry.kind && row.evidence_source_ref === entry.sourceRef,
        );
        if (match && !superseded.has(row.id)) superseded.set(row.id, match);
      }
      for (const [supersededId, match] of superseded) {
        db.prepare(`
          UPDATE facts SET status='REVOKED', revoked_at=?, revocation_reason=?, updated_at=? WHERE id=?
        `).run(now, `Superseded by a newer validated observation from ${match.kind}:${match.sourceRef}`, now, supersededId);
      }
      const conflict = active.length > 0 && superseded.size === 0;
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
      for (const entry of evidenceList) {
        db.prepare("INSERT OR IGNORE INTO fact_evidence(fact_id, evidence_id) VALUES (?, ?)")
          .run(factId, entry.id);
      }
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
    // Only rehydratable kinds are audited. `GRAPH` has no artifact to re-read, so it is never
    // revalidated here; what keeps a graph fact auditable is its mandatory corroboration.
    const placeholders = REHYDRATABLE_SOURCE_TYPES.map(() => "?").join(", ");
    const rows = plainRows(db.prepare(`
      SELECT DISTINCT f.id, e.kind, e.source_ref, e.source_hash
      FROM facts f
      JOIN fact_evidence fe ON fe.fact_id=f.id
      JOIN evidence e ON e.id=fe.evidence_id
      WHERE f.status='VALIDATED' AND e.kind IN (${placeholders})
    `).all(...REHYDRATABLE_SOURCE_TYPES));
    const stale = [];
    withTransaction(db, () => {
      for (const row of rows) {
        let valid;
        let currentHash;
        if (row.kind === "RUN_EVENT") {
          const parts = String(row.source_ref).split(":");
          const { event } = findDurableRunEvent(root, row.source_ref, parts.length >= 3 ? parts[1] : null);
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
