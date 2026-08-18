import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  adaptiveRoutingReport,
  recordRoutingDecision,
  routeModel,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/adaptive-router.mjs";
import {
  cancelRunLifecycle,
  interruptTaskLifecycle,
  retryTaskLifecycle,
  tickLifecycle,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/lifecycle-manager.mjs";
import {
  executeExecutorControl,
  ExecutorControlError,
  validateExecutorControlConfig,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/executor-control.mjs";
import {
  initRun,
  loadRun,
  updateTaskStatus,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/orchestration-state.mjs";
import {
  buildOtlpLogExport,
  compactTelemetry,
  readTelemetry,
  recordTelemetry,
  TelemetryError,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/telemetry.mjs";

const roots = [];

function fixture(runId = "lifecycle-run-001") {
  const root = mkdtempSync(join(process.cwd(), ".tmp-lifecycle-test-"));
  roots.push(root);
  const artifactDir = join(root, ".orchestration", "lifecycle-run");
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, "tasks-classification.md"), [
    "# Tasks",
    "",
    "## BE-01 - Background task",
    "- category: BACKEND_ONLY",
    "- complexity: medium",
    "- assignedAgent: codex",
    "- validationPlan: `verify`",
  ].join("\n"), "utf8");
  writeFileSync(join(artifactDir, "waves.md"), "# Waves\n\n## Wave 1\n- BE-01\n", "utf8");
  initRun({ projectRoot: root, artifactDir, slug: "lifecycle-run", runId });
  return { root, artifactDir };
}

function controlFixture(root, options = {}) {
  const helper = join(root, "executor-helper.mjs");
  writeFileSync(helper, [
    "const [action, status, identity] = process.argv.slice(2);",
    "const result = { accepted: true, status, executorStatus: status, apiCalls: 2, toolCalls: 4, lastActivityAt: '2026-08-17T12:05:00.000Z' };",
    "if (action === 'dispatch') result.sessionId = identity || 'retry-session';",
    "else result.sessionId = identity;",
    "console.log(JSON.stringify(result));",
  ].join("\n"), "utf8");
  const config = {
    codex: {
      probe: {
        command: process.execPath,
        args: [helper, "probe", options.probeStatus ?? "RUNNING", "{sessionId}"],
      },
      interrupt: {
        command: process.execPath,
        args: [helper, "interrupt", "CANCELLED", "{sessionId}"],
      },
      dispatch: {
        command: process.execPath,
        args: [helper, "dispatch", "RUNNING", "retry-session"],
      },
    },
  };
  const path = join(root, "executor-control.json");
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return path;
}

test.afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

test("lifecycle polls a real control adapter, persists the result first and renews a lease", () => {
  const { root, artifactDir } = fixture();
  updateTaskStatus(artifactDir, "BE-01", "RUNNING", {
    projectRoot: root,
    executor: "codex",
    sessionId: "session-one",
    model: "account-default",
    now: "2026-08-17T12:00:00.000Z",
  });
  const adapterConfig = controlFixture(root);
  const tick = tickLifecycle(artifactDir, {
    projectRoot: root,
    adapterConfig,
    now: "2026-08-17T12:05:00.000Z",
  });
  assert.equal(tick.controlResults[0].ok, true);
  assert.equal(existsSync(tick.controlResults[0].persisted.path), true);
  assert.equal(tick.heartbeats[0].lease.status, "ACTIVE");
  assert.equal(loadRun(artifactDir).state.tasks["BE-01"].status, "RUNNING");
  assert.ok(readTelemetry(root).length >= 1);
});

test("interrupt and retry require confirmed executor actions and preserve attempt history", () => {
  const { root, artifactDir } = fixture();
  updateTaskStatus(artifactDir, "BE-01", "RUNNING", {
    projectRoot: root,
    executor: "codex",
    sessionId: "session-one",
  });
  assert.throws(
    () => interruptTaskLifecycle(artifactDir, "BE-01", { projectRoot: root }),
    (error) => error.code === "EXECUTOR_CONTROL_REQUIRED",
  );
  const adapterConfig = controlFixture(root);
  const interrupted = interruptTaskLifecycle(artifactDir, "BE-01", {
    projectRoot: root,
    adapterConfig,
  });
  assert.equal(interrupted.task.status, "UNKNOWN");
  assert.ok(interrupted.controlResult.evidence);
  updateTaskStatus(artifactDir, "BE-01", "FAILED", {
    projectRoot: root,
    reasonCode: "EXECUTOR_INTERRUPTED",
  });
  const retried = retryTaskLifecycle(artifactDir, "BE-01", {
    projectRoot: root,
    adapterConfig,
  });
  assert.equal(retried.task.status, "RUNNING");
  assert.equal(retried.task.attempt, 2);
  assert.equal(retried.task.attemptHistory[0].status, "FAILED");
  assert.equal(retried.task.attemptHistory[1].status, "RUNNING");
});

test("run cancellation interrupts, reconciles and finalizes only after executor termination", () => {
  const { root, artifactDir } = fixture("cancel-run-001");
  updateTaskStatus(artifactDir, "BE-01", "RUNNING", {
    projectRoot: root,
    executor: "codex",
    sessionId: "session-one",
  });
  const adapterConfig = controlFixture(root, { probeStatus: "CANCELLED" });
  const cancelled = cancelRunLifecycle(artifactDir, {
    projectRoot: root,
    adapterConfig,
    reason: "User requested cancellation",
    finalize: true,
  });
  assert.deepEqual(cancelled.pendingTasks, []);
  assert.equal(loadRun(artifactDir).state.status, "CANCELLED");
  assert.equal(loadRun(artifactDir).state.tasks["BE-01"].status, "CANCELLED");
});

test("executor controls reject open configuration surfaces and command interpolation", () => {
  assert.throws(
    () => validateExecutorControlConfig({
      codex: {
        probe: {
          command: "{untrustedCommand}",
          args: [],
        },
      },
    }),
    (error) => error instanceof ExecutorControlError && error.code === "INVALID_EXECUTOR_CONTROL_ACTION",
  );
  assert.throws(
    () => validateExecutorControlConfig({
      codex: {
        probe: {
          command: process.execPath,
          args: [],
          environment: { SECRET: "value" },
        },
      },
    }),
    (error) => error instanceof ExecutorControlError && error.code === "INVALID_EXECUTOR_CONTROL_ACTION",
  );
});

test("executor controls bound structured output returned to orchestration context", () => {
  const { root } = fixture("bounded-control-run-001");
  const config = {
    codex: {
      probe: {
        command: process.execPath,
        args: [
          "-e",
          "console.log(JSON.stringify({accepted:true,status:'RUNNING',payload:Array.from({length:10},()=>\"x\".repeat(20000))}))",
        ],
      },
    },
  };
  const result = executeExecutorControl(config, "codex", "probe", {}, { projectRoot: root });
  assert.equal(result.accepted, true);
  assert.equal(result.status, "RUNNING");
  assert.equal(result.truncated, true);
  assert.equal("payload" in result, false);
  assert.ok(result.originalBytes > 128 * 1024);
});

function telemetryEvent(index, model, result) {
  return {
    eventId: `adaptive-${model}-${index}`,
    eventType: "task_attempt_outcome",
    occurredAt: `2026-08-${String(10 + index).padStart(2, "0")}T12:00:00.000Z`,
    runId: `run-${model}-${index}`,
    taskId: `FE-${index}`,
    taskType: "FRONTEND_ONLY",
    complexity: "medium",
    executor: "agy",
    model,
    attempt: 1,
    durationMs: model.includes("pro") ? 400_000 : 200_000,
    result,
    reviewResult: result === "DONE" ? "PASS" : "FAIL",
    regressions: result === "DONE" ? 0 : 1,
  };
}

test("adaptive router escalates only with comparable evidence and keeps user overrides authoritative", () => {
  const { root } = fixture("router-run-001");
  for (let index = 0; index < 8; index += 1) {
    recordTelemetry(root, telemetryEvent(index, "gemini-3.5-flash-medium", index < 2 ? "DONE" : "FAILED"));
    recordTelemetry(root, telemetryEvent(index, "gemini-3.1-pro-low", index < 8 ? "DONE" : "FAILED"));
  }
  const context = { taskType: "FRONTEND_ONLY", complexity: "medium", executor: "agy" };
  const decision = routeModel(root, context, { minimumSamples: 5, minimumStratumSamples: 1 });
  assert.equal(decision.source, "adaptive");
  assert.equal(decision.model, "gemini-3.1-pro-low");
  const recorded = recordRoutingDecision(root, decision, context, {
    runId: "router-run-001",
    taskId: "FE-99",
  });
  assert.equal(recorded.created, true);
  assert.equal(adaptiveRoutingReport(root).samples, 16);

  const override = routeModel(root, { ...context, userModel: "gemini-3.5-flash-high" });
  assert.equal(override.source, "user");
  assert.equal(override.model, "gemini-3.5-flash-high");
});

test("telemetry rejects user content fields by contract", () => {
  const { root } = fixture("privacy-run-001");
  assert.throws(
    () => recordTelemetry(root, {
      runId: "privacy-run-001",
      eventType: "task_outcome",
      prompt: "sensitive source",
    }),
    (error) => error instanceof TelemetryError && error.code === "TELEMETRY_FIELD_FORBIDDEN",
  );
  assert.throws(
    () => recordTelemetry(root, {
      runId: "privacy-run-001",
      eventType: "task_outcome",
      metadata: { nested: { rawOutput: "sensitive" } },
    }),
    (error) => error instanceof TelemetryError && error.code === "TELEMETRY_FIELD_FORBIDDEN",
  );
  assert.throws(
    () => recordTelemetry(root, {
      runId: "privacy-run-001",
      eventType: "task_outcome",
      metadata: { note: "an arbitrary value is not metadata allowlisted by contract" },
    }),
    (error) => error instanceof TelemetryError && error.code === "TELEMETRY_FIELD_FORBIDDEN",
  );
  assert.throws(
    () => recordTelemetry(root, {
      runId: "privacy-run-001",
      eventType: "task_outcome",
      validationSummary: { total: 1, sourceCode: "sensitive" },
    }),
    (error) => error instanceof TelemetryError && error.code === "TELEMETRY_FIELD_FORBIDDEN",
  );
  assert.throws(
    () => recordTelemetry(root, {
      runId: { nested: { sourceCode: "sensitive" } },
      eventType: "task_outcome",
    }),
    (error) => error instanceof TelemetryError && error.code === "INVALID_TELEMETRY_STRING",
  );
  assert.throws(
    () => recordTelemetry(root, {
      runId: "privacy-run-001",
      eventType: "task_outcome",
      metadata: { firstPass: "source text disguised as a flag" },
    }),
    (error) => error instanceof TelemetryError && error.code === "INVALID_TELEMETRY_METADATA",
  );
  assert.throws(
    () => recordTelemetry(root, {
      runId: "privacy-run-001",
      eventType: "task_outcome",
      validationSummary: { total: -1 },
    }),
    (error) => error instanceof TelemetryError && error.code === "INVALID_VALIDATION_SUMMARY",
  );
});

test("telemetry retention is recoverable and OTLP output stays metadata-only", () => {
  const { root } = fixture("retention-run-001");
  recordTelemetry(root, {
    eventId: "old-event",
    eventType: "task_outcome",
    occurredAt: "2020-01-01T00:00:00.000Z",
    runId: "retention-run-001",
    taskId: "BE-01",
    result: "DONE",
  });
  recordTelemetry(root, {
    eventId: "new-event",
    eventType: "task_outcome",
    occurredAt: "2026-08-17T00:00:00.000Z",
    runId: "retention-run-001",
    taskId: "BE-02",
    result: "FAILED",
  });
  const preview = compactTelemetry(root, {
    now: "2026-08-18T00:00:00.000Z",
    retentionDays: 365,
  });
  assert.equal(preview.dryRun, true);
  assert.equal(preview.after, 1);
  const applied = compactTelemetry(root, {
    now: "2026-08-18T00:00:00.000Z",
    retentionDays: 365,
    dryRun: false,
  });
  assert.ok(existsSync(applied.backup));
  assert.deepEqual(readTelemetry(root).map((event) => event.eventId), ["new-event"]);
  const payload = JSON.stringify(buildOtlpLogExport(root));
  assert.match(payload, /orchestrator\.taskId/);
  assert.doesNotMatch(payload, /prompt|rawOutput|sourceCode/);
});
