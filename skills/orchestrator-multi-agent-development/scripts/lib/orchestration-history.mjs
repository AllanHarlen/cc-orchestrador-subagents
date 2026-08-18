import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { resolveArtifact } from "./artifact-layout.mjs";
import { loadRun } from "./orchestration-state.mjs";
import { projectKnowledgePaths } from "./project-knowledge.mjs";
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

const HISTORY_MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE runs (
        run_id TEXT PRIMARY KEY,
        slug TEXT NOT NULL,
        status TEXT NOT NULL,
        phase REAL NOT NULL,
        phase_status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        artifact_dir TEXT NOT NULL,
        revision INTEGER NOT NULL,
        task_count INTEGER NOT NULL,
        event_count INTEGER NOT NULL,
        metadata_json TEXT NOT NULL
      ) STRICT;

      CREATE TABLE tasks (
        run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        task_type TEXT,
        complexity TEXT,
        executor TEXT,
        model TEXT,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        duration_ms INTEGER,
        reason_code TEXT,
        review_result TEXT,
        regressions INTEGER NOT NULL DEFAULT 0,
        files_changed_count INTEGER NOT NULL DEFAULT 0,
        contract_ids_json TEXT NOT NULL,
        evidence_ids_json TEXT NOT NULL,
        workspace_id TEXT,
        metadata_json TEXT NOT NULL,
        PRIMARY KEY (run_id, task_id)
      ) STRICT;

      CREATE TABLE events (
        event_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        task_id TEXT,
        occurred_at TEXT NOT NULL,
        actor TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        UNIQUE (run_id, revision)
      ) STRICT;

      CREATE TABLE evidence (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        task_id TEXT,
        kind TEXT NOT NULL,
        source_ref TEXT,
        summary TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE failures (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        task_id TEXT,
        reason_code TEXT,
        error_fingerprint TEXT NOT NULL,
        problem TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE solutions (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        task_id TEXT,
        failure_fingerprint TEXT,
        solution TEXT NOT NULL,
        outcome TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE reviews (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        task_id TEXT,
        review_type TEXT NOT NULL,
        result TEXT NOT NULL,
        findings_count INTEGER NOT NULL DEFAULT 0,
        source_ref TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE models (
        run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        executor TEXT,
        model TEXT,
        task_type TEXT,
        complexity TEXT,
        outcome TEXT NOT NULL,
        review_result TEXT,
        duration_ms INTEGER,
        PRIMARY KEY (run_id, task_id, attempt)
      ) STRICT;

      CREATE TABLE agents (
        run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        executor TEXT NOT NULL,
        session_id TEXT,
        conversation_id TEXT,
        api_calls INTEGER NOT NULL,
        tool_calls INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        PRIMARY KEY (run_id, task_id)
      ) STRICT;

      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        task_id TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        source_ref TEXT,
        occurred_at TEXT NOT NULL
      ) STRICT;

      CREATE VIRTUAL TABLE documents_fts USING fts5(
        title,
        content,
        content='documents',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER documents_fts_insert AFTER INSERT ON documents BEGIN
        INSERT INTO documents_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
      END;
      CREATE TRIGGER documents_fts_delete AFTER DELETE ON documents BEGIN
        INSERT INTO documents_fts(documents_fts, rowid, title, content)
        VALUES ('delete', old.rowid, old.title, old.content);
      END;
      CREATE TRIGGER documents_fts_update AFTER UPDATE ON documents BEGIN
        INSERT INTO documents_fts(documents_fts, rowid, title, content)
        VALUES ('delete', old.rowid, old.title, old.content);
        INSERT INTO documents_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
      END;

      CREATE INDEX idx_runs_updated ON runs(updated_at DESC);
      CREATE INDEX idx_tasks_outcome ON tasks(task_type, complexity, executor, model, status);
      CREATE INDEX idx_events_run ON events(run_id, revision);
      CREATE INDEX idx_failures_fingerprint ON failures(error_fingerprint, occurred_at DESC);
      CREATE INDEX idx_models_features ON models(task_type, complexity, executor, model, outcome);
      CREATE INDEX idx_documents_run ON documents(run_id, occurred_at DESC);
    `,
  },
];

const SEARCHABLE_ARTIFACTS = [
  ["implementation-report.md", "implementation_report"],
  ["workflow-log.md", "workflow_log"],
  ["subagents-context.md", "subagent_context"],
  ["review-final.md", "backend_review"],
  ["review-frontend.md", "frontend_review"],
  ["browser-e2e-report.md", "browser_e2e"],
  ["e2e-report.md", "browser_e2e"],
  ["e2e-verification.md", "browser_e2e"],
  ["learning-report.md", "learning_report"],
  ["handoff.json", "handoff"],
];

export class OrchestrationHistoryError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "OrchestrationHistoryError";
    this.code = code;
    this.details = details;
  }
}

export function openHistoryStore(projectRoot, options = {}) {
  const paths = projectKnowledgePaths(projectRoot);
  const db = openSqlite(paths.historyDb, options);
  if (!options.readOnly) applyMigrations(db, "orchestration-history", HISTORY_MIGRATIONS);
  return { db, paths };
}

function durationMs(startedAt, completedAt) {
  if (!startedAt || !completedAt) return null;
  const value = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function boundedText(value, max = 100_000) {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.4);
  const tail = max - head;
  return `${text.slice(0, head)}\n\n[... ${text.length - max} characters omitted ...]\n\n${text.slice(-tail)}`;
}

function insertDocument(db, document) {
  db.prepare(`
    INSERT INTO documents(id, run_id, task_id, kind, title, content, source_ref, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    document.id,
    document.runId,
    document.taskId ?? null,
    document.kind,
    document.title,
    boundedText(document.content),
    document.sourceRef ?? null,
    document.occurredAt,
  );
}

function reviewResult(content) {
  const upper = content.toUpperCase();
  if (/\b(?:REPROVADO|FAILED|FAIL)\b/.test(upper)) return "FAIL";
  if (/\b(?:PARTIAL|PARCIAL|BLOCKED|BLOQUEADO)\b/.test(upper)) return "PARTIAL";
  if (/\b(?:APROVADO|PASSED|PASS)\b/.test(upper)) return "PASS";
  return "UNKNOWN";
}

function deleteProjectedRun(db, runId) {
  // Child tables cascade from runs; FTS delete triggers execute for documents.
  db.prepare("DELETE FROM runs WHERE run_id = ?").run(runId);
}

export function projectRunHistory(projectRoot, artifactDir, options = {}) {
  const root = resolve(projectRoot);
  const directory = resolve(artifactDir);
  const loaded = loadRun(directory, { verifyReplay: true });
  const { state, events } = loaded;
  const { db } = openHistoryStore(root);
  try {
    return withTransaction(db, () => {
      deleteProjectedRun(db, state.runId);
      const tasks = Object.values(state.tasks ?? {});
      db.prepare(`
        INSERT INTO runs(
          run_id, slug, status, phase, phase_status, started_at, updated_at,
          completed_at, artifact_dir, revision, task_count, event_count, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        state.runId,
        state.slug,
        state.status,
        Number(state.phase),
        state.phaseStatus,
        state.createdAt,
        state.updatedAt,
        ["DONE", "CANCELLED"].includes(state.status) ? state.updatedAt : null,
        directory,
        Number(state.revision),
        tasks.length,
        events.length,
        stableJson({
          gates: state.completionGates ?? {},
          currentWave: state.currentWave,
          lastSafePhase: state.lastSafePhase,
          repository: state.repository ?? {},
        }),
      );

      for (const event of events) {
        const taskId = event.payload?.taskId ?? null;
        const payloadJson = stableJson(event.payload ?? {});
        db.prepare(`
          INSERT INTO events(event_id, run_id, revision, event_type, task_id, occurred_at, actor, payload_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          event.eventId,
          state.runId,
          event.revision,
          event.type,
          taskId,
          event.occurredAt,
          event.actor,
          payloadJson,
        );
        insertDocument(db, {
          id: `event-${event.eventId}`,
          runId: state.runId,
          taskId,
          kind: "event",
          title: `${event.type}${taskId ? ` ${taskId}` : ""}`,
          content: payloadJson,
          sourceRef: "events.jsonl",
          occurredAt: event.occurredAt,
        });
      }

      for (const task of tasks) {
        const evidenceStrings = (task.evidence ?? []).map(String);
        const evidenceIds = [];
        for (const [index, summary] of evidenceStrings.entries()) {
          const evidenceId = `hev-${sha256(`${state.runId}\0${task.id}\0${index}\0${summary}`).slice(0, 24)}`;
          evidenceIds.push(evidenceId);
          db.prepare(`
            INSERT INTO evidence(id, run_id, task_id, kind, source_ref, summary, payload_json, occurred_at)
            VALUES (?, ?, ?, 'task_evidence', NULL, ?, ?, ?)
          `).run(
            evidenceId,
            state.runId,
            task.id,
            summary,
            stableJson({ summary }),
            task.completedAt ?? task.updatedAt,
          );
        }
        const changedFiles = task.reconciliation?.changedFiles ?? [];
        const taskDuration = durationMs(task.startedAt, task.completedAt);
        db.prepare(`
          INSERT INTO tasks(
            run_id, task_id, task_type, complexity, executor, model, status, attempt,
            started_at, completed_at, duration_ms, reason_code, review_result,
            regressions, files_changed_count, contract_ids_json, evidence_ids_json,
            workspace_id, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          state.runId,
          task.id,
          task.category ?? null,
          task.complexity ?? null,
          task.executor ?? null,
          task.model ?? null,
          task.status,
          Number(task.attempt ?? 0),
          task.startedAt ?? null,
          task.completedAt ?? null,
          taskDuration,
          task.reasonCode ?? null,
          task.reviewResult ?? null,
          Number(task.regressions ?? 0),
          changedFiles.length,
          stableJson(task.contractIds ?? []),
          stableJson(evidenceIds),
          task.workspace?.workspaceId ?? null,
          stableJson(task),
        );
        if (task.executor) {
          db.prepare(`
            INSERT INTO agents(
              run_id, task_id, executor, session_id, conversation_id, api_calls, tool_calls, outcome
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            state.runId,
            task.id,
            task.executor,
            task.sessionId ?? null,
            task.conversationId ?? null,
            Number(task.apiCalls ?? 0),
            Number(task.toolCalls ?? 0),
            task.status,
          );
        }
        const modelAttempts = Array.isArray(task.attemptHistory) && task.attemptHistory.length > 0
          ? task.attemptHistory
          : [{
              attempt: Number(task.attempt ?? 0),
              executor: task.executor ?? null,
              model: task.model ?? null,
              status: task.status,
              reviewResult: task.reviewResult ?? null,
              durationMs: taskDuration,
            }];
        for (const attempt of modelAttempts) {
          db.prepare(`
            INSERT INTO models(
              run_id, task_id, attempt, executor, model, task_type, complexity,
              outcome, review_result, duration_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            state.runId,
            task.id,
            Number(attempt.attempt ?? 0),
            attempt.executor ?? task.executor ?? null,
            attempt.model ?? task.model ?? null,
            task.category ?? null,
            task.complexity ?? null,
            attempt.status ?? task.status,
            attempt.reviewResult ?? null,
            Number.isFinite(attempt.durationMs) ? Number(attempt.durationMs) : null,
          );
        }

        const problem = task.reconciliation?.reason ?? task.reason ?? task.reasonCode ?? null;
        if (["FAILED", "BLOCKED", "STALLED", "UNKNOWN"].includes(task.status) || task.reasonCode) {
          const fingerprint = sha256(
            `${task.reasonCode ?? task.status}\0${String(problem ?? "").toLowerCase().replace(/\d+/g, "#")}`,
          );
          db.prepare(`
            INSERT INTO failures(
              id, run_id, task_id, reason_code, error_fingerprint, problem,
              attempt, outcome, occurred_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            `failure-${sha256(`${state.runId}\0${task.id}\0${fingerprint}`).slice(0, 24)}`,
            state.runId,
            task.id,
            task.reasonCode ?? null,
            fingerprint,
            problem ?? `Task ended as ${task.status}`,
            Number(task.attempt ?? 0),
            task.status,
            task.updatedAt,
          );
        }
        if (task.status === "DONE" && (task.attempt > 1 || task.reconciliation)) {
          const solution = task.reconciliation?.reason ?? (evidenceStrings.join("; ") || "Task completed");
          db.prepare(`
            INSERT INTO solutions(id, run_id, task_id, failure_fingerprint, solution, outcome, occurred_at)
            VALUES (?, ?, ?, NULL, ?, 'SUCCESS', ?)
          `).run(
            `solution-${sha256(`${state.runId}\0${task.id}\0${solution}`).slice(0, 24)}`,
            state.runId,
            task.id,
            solution,
            task.completedAt ?? task.updatedAt,
          );
        }
        insertDocument(db, {
          id: `task-${sha256(`${state.runId}\0${task.id}`).slice(0, 24)}`,
          runId: state.runId,
          taskId: task.id,
          kind: "task",
          title: `${task.id} ${task.title ?? ""} ${task.status}`,
          content: stableJson(task),
          sourceRef: "state.json",
          occurredAt: task.updatedAt,
        });
      }

      for (const [fileName, kind] of SEARCHABLE_ARTIFACTS) {
        const resolvedArtifact = resolveArtifact(directory, fileName);
        const path = resolvedArtifact?.path;
        if (!path || !statSync(path).isFile()) continue;
        const content = readFileSync(path, "utf8");
        const hash = sha256(content);
        insertDocument(db, {
          id: `artifact-${sha256(`${state.runId}\0${fileName}\0${hash}`).slice(0, 24)}`,
          runId: state.runId,
          kind,
          title: `${state.runId} ${fileName}`,
          content,
          sourceRef: resolvedArtifact.relativePath,
          occurredAt: state.updatedAt,
        });
        if (kind.endsWith("review") || kind === "browser_e2e") {
          const result = reviewResult(content);
          const findings = (content.match(/^(?:[-*]|\d+\.)\s+/gm) ?? []).length;
          db.prepare(`
            INSERT INTO reviews(
              id, run_id, task_id, review_type, result, findings_count,
              source_ref, content_hash, occurred_at
            ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)
          `).run(
            `review-${sha256(`${state.runId}\0${fileName}\0${hash}`).slice(0, 24)}`,
            state.runId,
            kind,
            result,
            findings,
            fileName,
            hash,
            state.updatedAt,
          );
        }
      }

      return {
        runId: state.runId,
        tasks: tasks.length,
        events: events.length,
        documents: Number(
          plainRow(db.prepare("SELECT COUNT(*) AS count FROM documents WHERE run_id=?").get(state.runId)).count,
        ),
      };
    });
  } finally {
    db.close();
  }
}

function orchestrationDirectories(projectRoot) {
  const root = join(resolve(projectRoot), ".orchestration");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .filter((directory) =>
      existsSync(join(directory, "state.json")) || existsSync(join(directory, "events.jsonl")),
    );
}

export function projectAllHistory(projectRoot, options = {}) {
  const results = [];
  const errors = [];
  for (const directory of orchestrationDirectories(projectRoot)) {
    try {
      results.push(projectRunHistory(projectRoot, directory, options));
    } catch (error) {
      errors.push({
        artifactDir: directory,
        code: error?.code ?? "PROJECTION_FAILED",
        message: error?.message ?? String(error),
      });
      if (options.failFast) throw error;
    }
  }
  return { projected: results, errors };
}

export function rebuildHistory(projectRoot, options = {}) {
  const { db } = openHistoryStore(projectRoot);
  try {
    withTransaction(db, () => {
      db.exec("DELETE FROM runs;");
    });
  } finally {
    db.close();
  }
  return projectAllHistory(projectRoot, options);
}

function safeFtsQuery(query) {
  const tokens = String(query ?? "").match(/[\p{L}\p{N}_./:+-]+/gu) ?? [];
  if (tokens.length === 0) {
    throw new OrchestrationHistoryError("EMPTY_SEARCH", "History search requires at least one token");
  }
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" AND ");
}

export function searchHistory(projectRoot, query, options = {}) {
  const { db } = openHistoryStore(projectRoot);
  try {
    const limit = Math.min(100, Math.max(1, Number(options.limit ?? 10)));
    const ftsQuery = options.raw ? String(query) : safeFtsQuery(query);
    let rows;
    try {
      rows = plainRows(db.prepare(`
        SELECT
          d.id,
          d.run_id,
          d.task_id,
          d.kind,
          d.title,
          d.source_ref,
          d.occurred_at,
          snippet(documents_fts, 1, '[', ']', '…', 32) AS snippet,
          bm25(documents_fts, 2.0, 1.0) AS rank,
          r.status AS run_status,
          r.slug
        FROM documents_fts
        JOIN documents d ON d.rowid = documents_fts.rowid
        JOIN runs r ON r.run_id = d.run_id
        WHERE documents_fts MATCH ?
        ORDER BY rank, d.occurred_at DESC
        LIMIT ?
      `).all(ftsQuery, limit));
    } catch (error) {
      throw new OrchestrationHistoryError(
        "INVALID_FTS_QUERY",
        `History search query is invalid: ${error.message}`,
        { query: ftsQuery },
      );
    }
    return { query: ftsQuery, count: rows.length, results: rows };
  } finally {
    db.close();
  }
}

export function browseHistory(projectRoot, options = {}) {
  const { db } = openHistoryStore(projectRoot);
  try {
    const limit = Math.min(100, Math.max(1, Number(options.limit ?? 20)));
    return plainRows(db.prepare(`
      SELECT run_id, slug, status, phase, phase_status, started_at, updated_at,
             completed_at, task_count, event_count
      FROM runs ORDER BY updated_at DESC LIMIT ?
    `).all(limit));
  } finally {
    db.close();
  }
}

export function historyStatus(projectRoot) {
  const { db, paths } = openHistoryStore(projectRoot);
  try {
    const tableCounts = {};
    for (const table of ["runs", "tasks", "events", "evidence", "failures", "solutions", "reviews", "models", "agents", "documents"]) {
      tableCounts[table] = Number(plainRow(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).count);
    }
    return { path: paths.historyDb, health: databaseHealth(db), counts: tableCounts };
  } finally {
    db.close();
  }
}
