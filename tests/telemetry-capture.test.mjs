/**
 * Cobertura dedicada dos Achados 2, 3 e 4 da run oficina-saas-20260905-001:
 * o sweeper de stall nunca gravava `lastSweepAt` sem uma mudanca real; um
 * redispatch (troca de sessionId/conversationId/executor com o mesmo status
 * RUNNING) nunca incrementava `attempt`; e `durationMs` media o dispatch em
 * lote, nao a task, porque `startedAt`/`completedAt` nao podiam ser
 * corrigidos para os timestamps reais das CLIs externas.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  OrchestrationStateError,
  initRun,
  loadRun,
  sweepStalledTasks,
  updateTaskStatus,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/orchestration-state.mjs";

const roots = [];

function fixture(slug = "telemetry-run") {
  const root = mkdtempSync(join(process.cwd(), ".tmp-telemetry-test-"));
  roots.push(root);
  const artifactDir = join(root, ".orchestration", slug);
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(
    join(artifactDir, "tasks-classification.md"),
    ["# Tasks", "", "## BE-01 - Endpoint", "- category: BACKEND_ONLY"].join("\n"),
    "utf8",
  );
  writeFileSync(join(artifactDir, "waves.md"), "# Waves\n\n## Wave 1\n- BE-01\n", "utf8");
  initRun({ projectRoot: root, artifactDir, slug, runId: `${slug}-001` });
  return { root, artifactDir };
}

test.afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */
/* Achado 2 — sweeper grava lastSweepAt mesmo sem stall real                   */
/* -------------------------------------------------------------------------- */

test("sweepStalledTasks persists lastSweepAt even when nothing stalled", () => {
  const { root, artifactDir } = fixture();
  updateTaskStatus(artifactDir, "BE-01", "RUNNING", {
    projectRoot: root,
    executor: "codex",
    now: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(loadRun(artifactDir).state.lifecycle.lastSweepAt, null);

  const swept = sweepStalledTasks(artifactDir, {
    projectRoot: root,
    now: "2026-01-01T00:00:10.000Z",
    staleIdleSeconds: 450,
  });
  assert.equal(swept.changed, false);
  assert.equal(swept.stalled.length, 0);
  assert.equal(swept.state.lifecycle.lastSweepAt, "2026-01-01T00:00:10.000Z");
  assert.equal(loadRun(artifactDir).state.lifecycle.lastSweepAt, "2026-01-01T00:00:10.000Z");
});

test("sweepStalledTasks advances lastSweepAt on every call, changed or not", () => {
  const { root, artifactDir } = fixture();
  updateTaskStatus(artifactDir, "BE-01", "RUNNING", { projectRoot: root, executor: "codex" });

  sweepStalledTasks(artifactDir, { projectRoot: root, now: "2026-01-01T00:00:01.000Z" });
  sweepStalledTasks(artifactDir, { projectRoot: root, now: "2026-01-01T00:00:02.000Z" });
  const third = sweepStalledTasks(artifactDir, { projectRoot: root, now: "2026-01-01T00:00:03.000Z" });
  assert.equal(third.state.lifecycle.lastSweepAt, "2026-01-01T00:00:03.000Z");
});

/* -------------------------------------------------------------------------- */
/* Achado 4 — redispatch nao declarado e recusado; declarado incrementa       */
/* -------------------------------------------------------------------------- */

test("a RUNNING update with a different conversationId, no --new-attempt, is ATTEMPT_NOT_DECLARED", () => {
  const { root, artifactDir } = fixture();
  updateTaskStatus(artifactDir, "BE-01", "RUNNING", {
    projectRoot: root,
    executor: "agy",
    conversationId: "conv-1",
  });
  assert.throws(
    () =>
      updateTaskStatus(artifactDir, "BE-01", "RUNNING", {
        projectRoot: root,
        executor: "agy",
        conversationId: "conv-2",
      }),
    (error) => error instanceof OrchestrationStateError && error.code === "ATTEMPT_NOT_DECLARED",
  );
});

test("a RUNNING update with a different executor, no --new-attempt, is ATTEMPT_NOT_DECLARED", () => {
  const { root, artifactDir } = fixture();
  updateTaskStatus(artifactDir, "BE-01", "RUNNING", { projectRoot: root, executor: "codex" });
  assert.throws(
    () => updateTaskStatus(artifactDir, "BE-01", "RUNNING", { projectRoot: root, executor: "claude-code" }),
    (error) => error instanceof OrchestrationStateError && error.code === "ATTEMPT_NOT_DECLARED",
  );
});

test("backfilling a conversationId/sessionId that was null is not a redispatch (no --new-attempt needed)", () => {
  const { root, artifactDir } = fixture();
  updateTaskStatus(artifactDir, "BE-01", "RUNNING", { projectRoot: root, executor: "codex" });
  // O dispatch original nao capturou conversationId/sessionId; um import de
  // telemetria posterior (import-executor-telemetry.mjs) os descobre a
  // partir do log da CLI e so preenche o que estava vazio.
  const result = updateTaskStatus(artifactDir, "BE-01", "RUNNING", {
    projectRoot: root,
    conversationId: "conv-discovered-later",
    sessionId: "session-discovered-later",
  });
  assert.equal(result.state.tasks["BE-01"].attempt, 1);
  assert.equal(result.state.tasks["BE-01"].conversationId, "conv-discovered-later");
});

test("a plain RUNNING heartbeat-like update (same executor/session/conversation) is not an attempt change", () => {
  const { root, artifactDir } = fixture();
  updateTaskStatus(artifactDir, "BE-01", "RUNNING", {
    projectRoot: root,
    executor: "codex",
    conversationId: "conv-1",
  });
  const result = updateTaskStatus(artifactDir, "BE-01", "RUNNING", {
    projectRoot: root,
    executor: "codex",
    conversationId: "conv-1",
    currentTool: "Edit",
  });
  assert.equal(result.state.tasks["BE-01"].attempt, 1);
});

test("--new-attempt on a RUNNING->RUNNING redispatch increments attempt and opens a new attemptHistory entry", () => {
  const { root, artifactDir } = fixture();
  updateTaskStatus(artifactDir, "BE-01", "RUNNING", {
    projectRoot: root,
    executor: "agy",
    conversationId: "conv-truncated",
    now: "2026-01-01T00:00:00.000Z",
  });
  const redispatched = updateTaskStatus(artifactDir, "BE-01", "RUNNING", {
    projectRoot: root,
    executor: "agy",
    conversationId: "conv-resumed",
    newAttempt: true,
    startedAt: "2026-01-01T00:05:10.000Z",
  });
  const task = redispatched.state.tasks["BE-01"];
  assert.equal(task.attempt, 2);
  assert.equal(task.attemptHistory.length, 2);
  assert.equal(task.attemptHistory[1].conversationId, "conv-resumed");
  assert.equal(task.startedAt, "2026-01-01T00:05:10.000Z");
});

/* -------------------------------------------------------------------------- */
/* Achado 3 — --started-at/--completed-at corrigem durationMs para o real     */
/* -------------------------------------------------------------------------- */

test("durationMs is computed from --started-at/--completed-at, not from batch-processing time", () => {
  const { root, artifactDir } = fixture();
  updateTaskStatus(artifactDir, "BE-01", "RUNNING", {
    projectRoot: root,
    executor: "agy",
    startedAt: "2026-01-01T10:00:00.000Z",
    // "now" simula o orquestrador processando o dispatch em lote bem depois
    // do horario real de inicio reportado pela CLI.
    now: "2026-01-01T10:05:00.000Z",
  });
  const done = updateTaskStatus(artifactDir, "BE-01", "DONE", {
    projectRoot: root,
    evidence: ["executor:DONE"],
    completedAt: "2026-01-01T10:02:30.000Z",
    now: "2026-01-01T10:09:00.000Z",
  });
  const attempt = done.state.tasks["BE-01"].attemptHistory[0];
  assert.equal(attempt.startedAt, "2026-01-01T10:00:00.000Z");
  assert.equal(attempt.completedAt, "2026-01-01T10:02:30.000Z");
  // 2m30s reais, nao os ~9 min entre os dois "now" de processamento do orquestrador.
  assert.equal(attempt.durationMs, 150_000);
});

test("codexEffort is captured per attempt, distinct from the planned agyEffort/model field", () => {
  const { root, artifactDir } = fixture();
  updateTaskStatus(artifactDir, "BE-01", "RUNNING", {
    projectRoot: root,
    executor: "codex",
    resolvedModel: "gpt-5.6-terra",
    codexEffort: "high",
  });
  const state = loadRun(artifactDir).state;
  assert.equal(state.tasks["BE-01"].resolvedModel, "gpt-5.6-terra");
  assert.equal(state.tasks["BE-01"].codexEffort, "high");
  assert.equal(state.tasks["BE-01"].attemptHistory[0].codexEffort, "high");
});
