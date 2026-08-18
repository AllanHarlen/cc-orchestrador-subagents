import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  OrchestrationStateError,
  auditRunCompletion,
  findRunDirectory,
  heartbeatTask,
  initRun,
  loadRun,
  requestRunCancellation,
  resolveTaskScope,
  resumeRunAtDirectory,
  sweepStalledTasks,
  syncRunFromArtifacts,
  updateCompletionGate,
  updatePhase,
  updateRunStatus,
  updateTaskStatus,
  verifyRun,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/orchestration-state.mjs";

const temporaryRoots = [];

function fixture(options = {}) {
  const root = mkdtempSync(join(process.cwd(), ".tmp-state-test-"));
  temporaryRoots.push(root);
  const artifactDir = join(root, ".orchestration", options.slug ?? "demo-run");
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(
    join(artifactDir, "tasks-classification.md"),
    [
      "# Tasks",
      "",
      "## BE-01 - Backend endpoint",
      "- category: BACKEND_ONLY",
      "- assignedAgent: codex:codex-rescue",
      "- expectedFiles: `src/output.txt`",
      "",
      "## FE-01 - Frontend screen",
      "- category: FRONTEND_ONLY",
      "- assignedAgent: cc-antigravity-plugin:antigravity-coder",
      "- validationPlan: `npm run build`",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(artifactDir, "waves.md"),
    [
      "# Waves",
      "",
      "## Wave 1",
      "- BE-01",
      "",
      "## Wave 2",
      "- FE-01",
    ].join("\n"),
    "utf8",
  );
  return { root, artifactDir };
}

function writeExpectedBackendFile(root) {
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "output.txt"), "done\n", "utf8");
}

function completeRun(root, artifactDir) {
  writeExpectedBackendFile(root);
  for (const taskId of ["BE-01", "FE-01"]) {
    updateTaskStatus(artifactDir, taskId, "RUNNING", { projectRoot: root });
    updateTaskStatus(artifactDir, taskId, "DONE", {
      projectRoot: root,
      evidence: [`executor:${taskId}:DONE`],
    });
  }
  for (const name of [
    "workflow-log.md",
    "subagents-context.md",
    "implementation-report.md",
    "handoff.json",
    "learning-report.md",
  ]) {
    writeFileSync(join(artifactDir, name), name === "handoff.json" ? "{}\n" : `# ${name}\n`, "utf8");
  }
  for (const gateId of [
    "backendReview",
    "frontendReview",
    "browserE2E",
    "reports",
    "handoff",
    "delivery",
    "learning",
  ]) {
    updateCompletionGate(artifactDir, gateId, "DONE", {
      projectRoot: root,
      evidence: [`test:${gateId}:PASS`],
    });
  }
  updatePhase(artifactDir, 12, "DONE", {
    projectRoot: root,
    evidence: "test:learning:PASS",
  });
}

function cleanup() {
  while (temporaryRoots.length > 0) {
    const target = temporaryRoots.pop();
    rmSync(target, { recursive: true, force: true });
  }
}

test.afterEach(cleanup);

test("browser E2E applicability can be waived explicitly without weakening fixed gates", () => {
  const { root, artifactDir } = fixture({ slug: "gate-applicability" });
  initRun({
    projectRoot: root,
    artifactDir,
    slug: "gate-applicability",
    runId: "gate-applicability-001",
  });
  assert.equal(loadRun(artifactDir).state.completionGates.browserE2E.required, true);
  assert.throws(
    () => updateCompletionGate(artifactDir, "backendReview", "N/A", {
      projectRoot: root,
      reason: "attempted fixed gate waiver",
    }),
    (error) => error instanceof OrchestrationStateError &&
      error.code === "REQUIRED_GATE_CANNOT_BE_SKIPPED",
  );
  const waived = updateCompletionGate(artifactDir, "browserE2E", "N/A", {
    projectRoot: root,
    reason: "front and back share the same origin and no browser integration gate applies",
  });
  assert.equal(waived.gate.required, false);
  assert.equal(waived.gate.requiredOverride, false);
  assert.equal(waived.gate.status, "N/A");
  syncRunFromArtifacts(artifactDir, { projectRoot: root });
  assert.equal(loadRun(artifactDir).state.completionGates.browserE2E.required, false);
});

test("initialization creates a valid snapshot and write-ahead event log", () => {
  const { root, artifactDir } = fixture();
  const result = initRun({
    projectRoot: root,
    artifactDir,
    slug: "demo-run",
    runId: "demo-run-20260817-001",
    now: "2026-08-17T12:00:00.000Z",
  });

  assert.equal(result.created, true);
  assert.equal(result.state.revision, 1);
  assert.equal(result.state.tasks["BE-01"].status, "PENDING");
  assert.equal(result.state.tasks["BE-01"].executor, "codex");
  assert.deepEqual(result.state.waves[0], { id: 1, tasks: ["BE-01"] });
  assert.equal(existsSync(join(artifactDir, "state.json")), true);
  assert.equal(existsSync(join(artifactDir, "events.jsonl")), true);
  assert.equal(verifyRun(artifactDir).valid, true);
});

test("event replay repairs a missing snapshot after a simulated crash", () => {
  const { root, artifactDir } = fixture();
  initRun({ projectRoot: root, artifactDir, slug: "demo-run", runId: "run-replay" });
  updatePhase(artifactDir, 1, "DONE", { projectRoot: root });
  unlinkSync(join(artifactDir, "state.json"));

  const replayed = loadRun(artifactDir, { repairSnapshot: true });
  assert.equal(replayed.snapshotRecovered, true);
  assert.equal(replayed.state.phaseStatus, "DONE");
  assert.equal(replayed.state.revision, 2);
  assert.equal(existsSync(join(artifactDir, "state.json")), true);
  assert.equal(verifyRun(artifactDir).valid, true);
});

test("recovery discards an incomplete final event before appending new history", () => {
  const { root, artifactDir } = fixture();
  initRun({ projectRoot: root, artifactDir, slug: "demo-run", runId: "run-tail-repair" });
  const eventsPath = join(artifactDir, "events.jsonl");
  writeFileSync(eventsPath, '{"eventSchemaVersion":1', { encoding: "utf8", flag: "a" });

  assert.throws(
    () => verifyRun(artifactDir),
    (error) => error instanceof OrchestrationStateError && error.code === "TRUNCATED_EVENT_TAIL",
  );

  updatePhase(artifactDir, 1, "DONE", { projectRoot: root });

  const events = readFileSync(eventsPath, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(events.map((event) => event.revision), [1, 2]);
  assert.equal(verifyRun(artifactDir).valid, true);
});

test("semantic snapshot corruption is rebuilt from durable events", () => {
  const { root, artifactDir } = fixture();
  initRun({ projectRoot: root, artifactDir, slug: "demo-run", runId: "run-invalid-snapshot" });
  writeFileSync(join(artifactDir, "state.json"), '{"schemaVersion":999}\n', "utf8");

  const replayed = loadRun(artifactDir, { repairSnapshot: true });
  assert.equal(replayed.snapshotRecovered, true);
  assert.equal(replayed.state.runId, "run-invalid-snapshot");
  assert.equal(verifyRun(artifactDir).valid, true);
});

test("integrity verification detects valid JSON that diverges from event replay", () => {
  const { root, artifactDir } = fixture();
  initRun({ projectRoot: root, artifactDir, slug: "demo-run", runId: "run-diverged-snapshot" });
  const snapshotPath = join(artifactDir, "state.json");
  const tampered = JSON.parse(readFileSync(snapshotPath, "utf8"));
  tampered.tasks["BE-01"].title = "tampered but schema-valid";
  writeFileSync(snapshotPath, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");

  assert.throws(
    () => verifyRun(artifactDir),
    (error) => error instanceof OrchestrationStateError && error.code === "SNAPSHOT_DIVERGED",
  );

  const resumed = resumeRunAtDirectory(artifactDir, { projectRoot: root });
  assert.equal(resumed.state.tasks["BE-01"].title, "Backend endpoint");
  assert.equal(verifyRun(artifactDir).valid, true);
});

test("resume converts an interrupted RUNNING task to UNKNOWN, never FAILED", () => {
  const { root, artifactDir } = fixture();
  initRun({ projectRoot: root, artifactDir, slug: "demo-run", runId: "run-unknown" });
  updateTaskStatus(artifactDir, "BE-01", "RUNNING", {
    projectRoot: root,
    executor: "codex",
    sessionId: "codex-session-1",
    now: "2026-08-17T12:00:00.000Z",
  });

  const resumed = resumeRunAtDirectory(artifactDir, {
    projectRoot: root,
    now: "2026-08-17T12:10:00.000Z",
  });

  assert.deepEqual(resumed.unknownTasks, ["BE-01"]);
  assert.equal(resumed.state.tasks["BE-01"].status, "UNKNOWN");
  assert.equal(resumed.state.tasks["BE-01"].reasonCode, "OWNER_SESSION_INTERRUPTED");
  assert.equal(resumed.report.pendingExternalProbes[0].sessionId, "codex-session-1");
  assert.notEqual(resumed.state.tasks["BE-01"].status, "FAILED");
});

test("authoritative executor completion plus local evidence reconciles UNKNOWN to DONE", () => {
  const { root, artifactDir } = fixture();
  initRun({ projectRoot: root, artifactDir, slug: "demo-run", runId: "run-done" });
  updateTaskStatus(artifactDir, "BE-01", "RUNNING", {
    projectRoot: root,
    executor: "codex",
    sessionId: "codex-session-2",
  });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "output.txt"), "done\n", "utf8");
  const probeFile = join(artifactDir, "probe.json");
  writeFileSync(
    probeFile,
    JSON.stringify({
      tasks: {
        "BE-01": {
          executorStatus: "DONE",
          producedFiles: ["src/output.txt"],
          validations: [{ command: "fixture validation", status: "PASS" }],
        },
      },
    }),
    "utf8",
  );

  const resumed = resumeRunAtDirectory(artifactDir, { projectRoot: root, probeFile });
  assert.equal(resumed.state.tasks["BE-01"].status, "DONE");
  assert.equal(resumed.state.tasks["BE-01"].reconciliation.recommendation, "CONTINUE");
});

test("Git or file evidence without executor authority stays UNKNOWN", () => {
  const { root, artifactDir } = fixture();
  initRun({ projectRoot: root, artifactDir, slug: "demo-run", runId: "run-conservative" });
  updateTaskStatus(artifactDir, "BE-01", "RUNNING", { projectRoot: root, executor: "codex" });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "output.txt"), "partial\n", "utf8");

  const resumed = resumeRunAtDirectory(artifactDir, { projectRoot: root });
  const task = resumed.state.tasks["BE-01"];
  assert.equal(task.status, "UNKNOWN");
  assert.equal(task.reconciliation.recommendation, "VERIFY_BEFORE_REEXECUTE");
});

test("stall detection uses progress silence and heartbeat recovers during grace", () => {
  const { root, artifactDir } = fixture();
  initRun({ projectRoot: root, artifactDir, slug: "demo-run", runId: "run-stall" });
  updateTaskStatus(artifactDir, "BE-01", "RUNNING", {
    projectRoot: root,
    now: "2026-08-17T12:00:00.000Z",
  });

  const noProgress = heartbeatTask(artifactDir, "BE-01", {
    now: "2026-08-17T12:03:00.000Z",
  });
  assert.equal(noProgress.changed, false);
  assert.equal(noProgress.task.lastActivityAt, "2026-08-17T12:00:00.000Z");

  const swept = sweepStalledTasks(artifactDir, {
    projectRoot: root,
    now: "2026-08-17T12:07:31.000Z",
    staleIdleSeconds: 450,
    stallGraceSeconds: 120,
  });
  assert.deepEqual(swept.stalled, ["BE-01"]);
  assert.equal(swept.state.tasks["BE-01"].status, "STALLED");
  assert.equal(swept.state.tasks["BE-01"].stall.phase, "idle");

  const resumed = resumeRunAtDirectory(artifactDir, {
    projectRoot: root,
    now: "2026-08-17T12:07:45.000Z",
  });
  assert.equal(
    resumed.report.recommendations.find((item) => item.taskId === "BE-01").action,
    "INTERRUPT_THEN_RECONCILE",
  );

  const heartbeat = heartbeatTask(artifactDir, "BE-01", {
    now: "2026-08-17T12:08:00.000Z",
    apiCalls: 2,
    toolCalls: 3,
  });
  assert.equal(heartbeat.task.status, "RUNNING");
  assert.equal(heartbeat.task.stall.recoveredAt, "2026-08-17T12:08:00.000Z");
});

test("a task-scoped failing validation is concrete FAILED evidence", () => {
  const { root, artifactDir } = fixture();
  initRun({ projectRoot: root, artifactDir, slug: "demo-run", runId: "run-validation-fail" });
  updateTaskStatus(artifactDir, "BE-01", "RUNNING", { projectRoot: root });
  const probeFile = join(artifactDir, "probe.json");
  writeFileSync(
    probeFile,
    JSON.stringify({
      tasks: {
        "BE-01": {
          validations: [{ command: "dotnet test --filter BE-01", status: "FAIL" }],
        },
      },
    }),
    "utf8",
  );

  const resumed = resumeRunAtDirectory(artifactDir, { projectRoot: root, probeFile });
  assert.equal(resumed.state.tasks["BE-01"].status, "FAILED");
  assert.equal(resumed.state.tasks["BE-01"].reconciliation.recommendation, "FIX_OR_REEXECUTE");
});

test("terminal DONE cannot be silently restarted", () => {
  const { root, artifactDir } = fixture();
  initRun({ projectRoot: root, artifactDir, slug: "demo-run", runId: "run-terminal" });
  writeExpectedBackendFile(root);
  updateTaskStatus(artifactDir, "BE-01", "RUNNING", { projectRoot: root });
  updateTaskStatus(artifactDir, "BE-01", "DONE", {
    projectRoot: root,
    evidence: "executor:DONE",
  });

  assert.throws(
    () => updateTaskStatus(artifactDir, "BE-01", "RUNNING", { projectRoot: root }),
    (error) => error instanceof OrchestrationStateError && error.code === "INVALID_TASK_TRANSITION",
  );
});

test("reconciliation never regresses a terminal task", () => {
  const { root, artifactDir } = fixture();
  initRun({ projectRoot: root, artifactDir, slug: "demo-run", runId: "run-terminal-probe" });
  writeExpectedBackendFile(root);
  updateTaskStatus(artifactDir, "BE-01", "RUNNING", { projectRoot: root });
  updateTaskStatus(artifactDir, "BE-01", "DONE", {
    projectRoot: root,
    evidence: "executor:DONE",
  });
  const probeFile = join(artifactDir, "probe.json");
  writeFileSync(
    probeFile,
    JSON.stringify({ tasks: { "BE-01": { executorStatus: "RUNNING" } } }),
    "utf8",
  );

  const resumed = resumeRunAtDirectory(artifactDir, { projectRoot: root, probeFile });
  assert.equal(resumed.state.tasks["BE-01"].status, "DONE");
});

test("resume advances past a durably completed phase", () => {
  const { root, artifactDir } = fixture();
  initRun({ projectRoot: root, artifactDir, slug: "demo-run", runId: "run-next-phase" });
  updatePhase(artifactDir, 6, "DONE", { projectRoot: root });

  const resumed = resumeRunAtDirectory(artifactDir, { projectRoot: root });
  assert.equal(resumed.report.resumeFromPhase, 7);
});

test("run completion is explicit and refuses incomplete tasks", () => {
  const { root, artifactDir } = fixture();
  initRun({ projectRoot: root, artifactDir, slug: "demo-run", runId: "run-explicit-done" });

  assert.throws(
    () => updateRunStatus(artifactDir, "DONE"),
    (error) => error instanceof OrchestrationStateError && error.code === "RUN_COMPLETION_GATES_FAILED",
  );

  completeRun(root, artifactDir);
  assert.equal(auditRunCompletion(artifactDir).complete, true);
  const completed = updateRunStatus(artifactDir, "DONE");
  assert.equal(completed.state.status, "DONE");
  assert.throws(
    () => resumeRunAtDirectory(artifactDir, { projectRoot: root }),
    (error) => error instanceof OrchestrationStateError && error.code === "RUN_TERMINAL",
  );
});

test("sync adds newly classified tasks without deleting durable history", () => {
  const { root, artifactDir } = fixture();
  initRun({ projectRoot: root, artifactDir, slug: "demo-run", runId: "run-sync" });
  const classificationPath = join(artifactDir, "tasks-classification.md");
  writeFileSync(
    classificationPath,
    `${readFileSync(classificationPath, "utf8")}\n## BE-02 - Worker\n- category: BACKEND_ONLY\n- assignedAgent: codex\n`,
    "utf8",
  );

  const synced = syncRunFromArtifacts(artifactDir, { projectRoot: root });
  assert.equal(synced.state.tasks["BE-02"].status, "PENDING");
  assert.equal(synced.state.tasks["BE-01"].sourcePresent, true);
});

test("task parsing preserves split task suffixes as independent lifecycle entries", () => {
  const { root, artifactDir } = fixture();
  const classificationPath = join(artifactDir, "tasks-classification.md");
  const wavesPath = join(artifactDir, "waves.md");
  writeFileSync(
    classificationPath,
    `${readFileSync(classificationPath, "utf8")}\n## FE-02-A - First prompt slice\n- category: FRONTEND_ONLY\n\n## FE-02-B - Second prompt slice\n- category: FRONTEND_ONLY\n`,
    "utf8",
  );
  writeFileSync(
    wavesPath,
    `${readFileSync(wavesPath, "utf8")}\n## Wave 3\n- FE-02-A\n- FE-02-B\n`,
    "utf8",
  );

  const initialized = initRun({
    projectRoot: root,
    artifactDir,
    slug: "demo-run",
    runId: "run-split-tasks",
  });
  assert.equal(initialized.state.tasks["FE-02-A"].status, "PENDING");
  assert.equal(initialized.state.tasks["FE-02-B"].status, "PENDING");
  assert.deepEqual(initialized.state.waves.at(-1).tasks, ["FE-02-A", "FE-02-B"]);
});

test("root CLI wrapper performs an end-to-end resume", () => {
  const { root, artifactDir } = fixture();
  const cli = join(process.cwd(), "scripts", "orchestration-state.mjs");
  const run = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };

  run("init", "--slug", "demo-run", "--dir", artifactDir, "--run-id", "run-cli-resume");
  run(
    "task",
    "--dir",
    artifactDir,
    "--task",
    "BE-01",
    "--status",
    "RUNNING",
    "--executor",
    "codex",
    "--session-id",
    "cli-session",
  );
  const resumed = run("resume", "run-cli-resume", "--root", root);
  assert.equal(resumed.state.tasks["BE-01"].status, "UNKNOWN");
  assert.equal(resumed.report.pendingExternalProbes[0].sessionId, "cli-session");
});

test("an empty Phase 1 run cannot become DONE", () => {
  const { root, artifactDir } = fixture();
  writeFileSync(join(artifactDir, "tasks-classification.md"), "# Tasks\n", "utf8");
  writeFileSync(join(artifactDir, "waves.md"), "# Waves\n", "utf8");
  initRun({ projectRoot: root, artifactDir, slug: "demo-run", runId: "run-empty" });

  assert.throws(
    () => updateRunStatus(artifactDir, "DONE"),
    (error) =>
      error instanceof OrchestrationStateError &&
      error.code === "RUN_COMPLETION_GATES_FAILED" &&
      error.details.taskCount === 0,
  );
});

test("terminal run identity rejects phase mutation and init reuse", () => {
  const { root, artifactDir } = fixture();
  initRun({ projectRoot: root, artifactDir, slug: "demo-run", runId: "run-global-terminal" });
  completeRun(root, artifactDir);
  updateRunStatus(artifactDir, "DONE");

  assert.throws(
    () => updatePhase(artifactDir, 6, "RUNNING", { projectRoot: root }),
    (error) => error instanceof OrchestrationStateError && error.code === "RUN_TERMINAL",
  );
  assert.throws(
    () => initRun({ projectRoot: root, artifactDir, slug: "demo-run" }),
    (error) => error instanceof OrchestrationStateError && error.code === "RUN_TERMINAL",
  );
});

test("a task removed from classification blocks completion until scope is resolved", () => {
  const { root, artifactDir } = fixture();
  initRun({ projectRoot: root, artifactDir, slug: "demo-run", runId: "run-scope" });
  writeFileSync(
    join(artifactDir, "tasks-classification.md"),
    [
      "# Tasks",
      "",
      "## BE-01 - Backend endpoint",
      "- category: BACKEND_ONLY",
      "- assignedAgent: codex",
      "- expectedFiles: `src/output.txt`",
    ].join("\n"),
    "utf8",
  );
  const synced = syncRunFromArtifacts(artifactDir, { projectRoot: root });
  assert.deepEqual(synced.missingFromSource, ["FE-01"]);
  assert.deepEqual(auditRunCompletion(artifactDir).unresolvedScope, ["FE-01"]);

  const resolved = resolveTaskScope(artifactDir, "FE-01", "REMOVE", {
    projectRoot: root,
    reason: "User removed the feature from the authoritative specification",
  });
  assert.equal(resolved.task.status, "CANCELLED");
  assert.equal(resolved.task.scopeResolution.status, "REMOVED");
  assert.deepEqual(auditRunCompletion(artifactDir).unresolvedScope, []);
});

test("automatic and targeted lookup surface a corrupt newest run", () => {
  const { root, artifactDir } = fixture({ slug: "older-run" });
  initRun({ projectRoot: root, artifactDir, slug: "older-run", runId: "older-run-id" });
  const corruptDir = join(root, ".orchestration", "newest-run");
  mkdirSync(corruptDir, { recursive: true });
  const corruptState = join(corruptDir, "state.json");
  writeFileSync(corruptState, "{ not-json\n", "utf8");
  const future = new Date(Date.now() + 60_000);
  utimesSync(corruptState, future, future);

  for (const runId of [undefined, "newest-run"]) {
    assert.throws(
      () => findRunDirectory({ projectRoot: root, runId }),
      (error) => error instanceof OrchestrationStateError && error.code === "RUN_CORRUPT",
    );
  }
});

test("cancellation must interrupt and reconcile active executors before finalization", () => {
  const { root, artifactDir } = fixture();
  initRun({ projectRoot: root, artifactDir, slug: "demo-run", runId: "run-cancel" });
  updateTaskStatus(artifactDir, "BE-01", "RUNNING", {
    projectRoot: root,
    executor: "codex",
    sessionId: "cancel-session",
  });
  const requested = requestRunCancellation(artifactDir, {
    projectRoot: root,
    reason: "User cancelled the run",
  });
  assert.equal(requested.state.status, "UNKNOWN");
  assert.equal(requested.state.tasks["BE-01"].status, "UNKNOWN");
  assert.equal(requested.state.tasks["FE-01"].status, "CANCELLED");
  assert.equal(requested.pendingExecutorStops[0].sessionId, "cancel-session");
  assert.throws(
    () => updateRunStatus(artifactDir, "CANCELLED", { reason: "too early" }),
    (error) => error instanceof OrchestrationStateError && error.code === "CANCELLATION_NOT_RECONCILED",
  );

  updateTaskStatus(artifactDir, "BE-01", "CANCELLED", {
    projectRoot: root,
    reasonCode: "EXECUTOR_CANCELLED",
    reason: "Codex session confirmed stopped",
  });
  const finalized = updateRunStatus(artifactDir, "CANCELLED", { reason: "Cancellation reconciled" });
  assert.equal(finalized.state.status, "CANCELLED");
  assert.ok(finalized.state.cancellation.finalizedAt);
});

test("external DONE without local corroboration remains UNKNOWN", () => {
  const { root, artifactDir } = fixture();
  initRun({ projectRoot: root, artifactDir, slug: "demo-run", runId: "run-no-corroboration" });
  updateTaskStatus(artifactDir, "FE-01", "RUNNING", {
    projectRoot: root,
    executor: "agy",
    conversationId: "agy-no-evidence",
  });
  const probeFile = join(artifactDir, "probe-no-evidence.json");
  writeFileSync(
    probeFile,
    JSON.stringify({ tasks: { "FE-01": { executorStatus: "DONE" } } }),
    "utf8",
  );
  const resumed = resumeRunAtDirectory(artifactDir, { projectRoot: root, probeFile });
  const task = resumed.state.tasks["FE-01"];
  assert.equal(task.status, "UNKNOWN");
  assert.equal(task.reconciliation.recommendation, "COLLECT_LOCAL_EVIDENCE");
  assert.equal(task.reconciliation.localCorroboration, null);
});

test("executor operational reason codes survive canonical status mapping", () => {
  const { root, artifactDir } = fixture();
  initRun({ projectRoot: root, artifactDir, slug: "demo-run", runId: "run-reason-code" });
  updateTaskStatus(artifactDir, "FE-01", "RUNNING", {
    projectRoot: root,
    executor: "agy",
  });
  const probeFile = join(artifactDir, "probe-quota.json");
  writeFileSync(
    probeFile,
    JSON.stringify({ tasks: { "FE-01": { executorStatus: "QUOTA_EXHAUSTED" } } }),
    "utf8",
  );
  const resumed = resumeRunAtDirectory(artifactDir, { projectRoot: root, probeFile });
  assert.equal(resumed.state.tasks["FE-01"].status, "BLOCKED");
  assert.equal(resumed.state.tasks["FE-01"].reasonCode, "QUOTA_EXHAUSTED");
  assert.equal(
    resumed.state.tasks["FE-01"].reconciliation.externalRawStatus,
    "QUOTA_EXHAUSTED",
  );
});

test("resume follows the explicit phase sequence after browser E2E", () => {
  const { root, artifactDir } = fixture();
  initRun({ projectRoot: root, artifactDir, slug: "demo-run", runId: "run-phase-sequence" });
  updatePhase(artifactDir, 9.5, "DONE", {
    projectRoot: root,
    evidence: "browser:e2e:PASS",
  });
  const resumed = resumeRunAtDirectory(artifactDir, { projectRoot: root });
  assert.equal(resumed.report.resumeFromPhase, 10);
});
