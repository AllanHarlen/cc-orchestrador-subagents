import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  readAgyBridgeEvents,
  readCodexJob,
  readCodexRollout,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/executor-telemetry.mjs";

const roots = [];
function fixtureDir() {
  const dir = mkdtempSync(join(process.cwd(), ".tmp-executor-telemetry-test-"));
  roots.push(dir);
  return dir;
}
function writeJsonl(path, lines) {
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf8");
}
test.afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */
/* readAgyBridgeEvents                                                        */
/* -------------------------------------------------------------------------- */

test("readAgyBridgeEvents: missing log file returns an all-null shape, never throws", () => {
  const dir = fixtureDir();
  const result = readAgyBridgeEvents(join(dir, "does-not-exist.jsonl"));
  assert.equal(result.conversationId, null);
  assert.equal(result.resolvedModel, null);
  assert.equal(result.exitCode, null);
});

test("readAgyBridgeEvents: prefers bridge.exit as the primary source", () => {
  const dir = fixtureDir();
  const logPath = join(dir, "plugin.jsonl");
  writeJsonl(logPath, [
    { timestamp: "2026-09-05T17:18:58.000Z", pid: 111, event: "bridge.start" },
    { timestamp: "2026-09-05T17:18:58.100Z", pid: 111, event: "bridge.model.resolved", model: "flash-high" },
    { timestamp: "2026-09-05T17:24:02.000Z", pid: 111, event: "bridge.exit", exitCode: 0, durationMs: 304000, model: "flash-high", conversationId: "conv-abc", outputBytes: 14237, classified: null },
  ]);
  const result = readAgyBridgeEvents(logPath, { pid: 111 });
  assert.equal(result.conversationId, "conv-abc");
  assert.equal(result.resolvedModel, "flash-high");
  assert.equal(result.exitCode, 0);
  assert.equal(result.durationMs, 304000);
  assert.equal(result.outputBytes, 14237);
  assert.equal(result.classified, null);
});

test("readAgyBridgeEvents: filters by pid when multiple invocations share one log file", () => {
  const dir = fixtureDir();
  const logPath = join(dir, "plugin.jsonl");
  writeJsonl(logPath, [
    { timestamp: "2026-09-05T17:18:00.000Z", pid: 100, event: "bridge.exit", exitCode: 0, conversationId: "conv-first", durationMs: 1000 },
    { timestamp: "2026-09-05T17:19:00.000Z", pid: 200, event: "bridge.exit", exitCode: 10, conversationId: "conv-second", durationMs: 2000 },
  ]);
  const first = readAgyBridgeEvents(logPath, { pid: 100 });
  const second = readAgyBridgeEvents(logPath, { pid: 200 });
  assert.equal(first.conversationId, "conv-first");
  assert.equal(second.conversationId, "conv-second");
  assert.equal(second.exitCode, 10);
});

test("readAgyBridgeEvents: falls back to pre-bridge.exit events for older logs", () => {
  const dir = fixtureDir();
  const logPath = join(dir, "plugin.jsonl");
  writeJsonl(logPath, [
    { timestamp: "2026-09-05T17:18:58.000Z", pid: 111, event: "bridge.start" },
    { timestamp: "2026-09-05T17:18:58.100Z", pid: 111, event: "bridge.model.resolved", model: "flash-medium" },
    { timestamp: "2026-09-05T17:18:58.200Z", pid: 111, event: "bridge.agy.args.built", args: ["--conversation", "conv-legacy", "--model", "flash-medium"] },
    { timestamp: "2026-09-05T17:24:02.000Z", pid: 111, event: "bridge.output.file", bytes: 0 },
  ]);
  const result = readAgyBridgeEvents(logPath, { pid: 111 });
  assert.equal(result.conversationId, "conv-legacy");
  assert.equal(result.resolvedModel, "flash-medium");
  assert.equal(result.outputBytes, 0);
  assert.equal(result.exitCode, null, "no bridge.exit in this legacy log");
});

test("readAgyBridgeEvents: --since drops events from earlier invocations in the same shared log", () => {
  const dir = fixtureDir();
  const logPath = join(dir, "plugin.jsonl");
  writeJsonl(logPath, [
    { timestamp: "2026-09-05T17:00:00.000Z", pid: 111, event: "bridge.exit", exitCode: 0, conversationId: "conv-old" },
    { timestamp: "2026-09-05T18:00:00.000Z", pid: 111, event: "bridge.exit", exitCode: 0, conversationId: "conv-new" },
  ]);
  const result = readAgyBridgeEvents(logPath, { pid: 111, since: "2026-09-05T17:30:00.000Z" });
  assert.equal(result.conversationId, "conv-new");
});

test("readAgyBridgeEvents: tolerates a truncated/corrupt trailing line", () => {
  const dir = fixtureDir();
  const logPath = join(dir, "plugin.jsonl");
  writeFileSync(
    logPath,
    [
      JSON.stringify({ timestamp: "2026-09-05T17:00:00.000Z", pid: 111, event: "bridge.exit", exitCode: 0, conversationId: "conv-ok" }),
      '{"timestamp":"2026-09-05T17:00:01.000Z","pid":111,"event":"bridge', // truncated
    ].join("\n"),
    "utf8",
  );
  const result = readAgyBridgeEvents(logPath, { pid: 111 });
  assert.equal(result.conversationId, "conv-ok");
});

/* -------------------------------------------------------------------------- */
/* readCodexJob                                                               */
/* -------------------------------------------------------------------------- */

test("readCodexJob: missing file returns null, never throws", () => {
  const dir = fixtureDir();
  assert.equal(readCodexJob(join(dir, "no-such-job.json")), null);
});

test("readCodexJob: reads model/effort/timestamps with the documented field names", () => {
  const dir = fixtureDir();
  const jobPath = join(dir, "job.json");
  writeFileSync(
    jobPath,
    JSON.stringify({
      jobId: "job-be05",
      threadId: "01a072c1-38a5-7913-994f-9c77565bd3cc",
      status: "failed",
      model: "gpt-5.6-sol",
      effort: "medium",
      startedAt: "2026-09-05T17:51:57.988Z",
      finishedAt: "2026-09-05T18:01:39.000Z",
    }),
    "utf8",
  );
  const job = readCodexJob(jobPath);
  assert.equal(job.threadId, "01a072c1-38a5-7913-994f-9c77565bd3cc");
  assert.equal(job.model, "gpt-5.6-sol");
  assert.equal(job.effort, "medium");
  assert.equal(job.status, "failed");
});

test("readCodexJob: tolerates snake_case field name variants", () => {
  const dir = fixtureDir();
  const jobPath = join(dir, "job.json");
  writeFileSync(
    jobPath,
    JSON.stringify({
      job_id: "job-be06",
      thread_id: "thread-2",
      reasoning_effort: "high",
      created_at: "2026-09-05T17:51:58.000Z",
      completed_at: "2026-09-05T18:01:41.000Z",
    }),
    "utf8",
  );
  const job = readCodexJob(jobPath);
  assert.equal(job.jobId, "job-be06");
  assert.equal(job.threadId, "thread-2");
  assert.equal(job.effort, "high");
  assert.equal(job.startedAt, "2026-09-05T17:51:58.000Z");
  assert.equal(job.finishedAt, "2026-09-05T18:01:41.000Z");
});

/* -------------------------------------------------------------------------- */
/* readCodexRollout                                                           */
/* -------------------------------------------------------------------------- */

test("readCodexRollout: extracts the effectively-resolved model from thread_settings_applied", () => {
  const dir = fixtureDir();
  const rolloutPath = join(dir, "rollout.jsonl");
  writeJsonl(rolloutPath, [
    { type: "session_start", timestamp: "2026-09-05T17:18:43.000Z" },
    {
      type: "thread_settings_applied",
      timestamp: "2026-09-05T17:18:43.100Z",
      model: "gpt-5.6-sol",
      model_provider_id: "openai",
      service_tier: "default",
      reasoning_effort: "medium",
      approval_policy: "never",
    },
  ]);
  const result = readCodexRollout(rolloutPath);
  assert.equal(result.model, "gpt-5.6-sol");
  assert.equal(result.reasoningEffort, "medium");
  assert.equal(result.approvalPolicy, "never");
});

test("readCodexRollout: also accepts settings nested under a payload/settings wrapper", () => {
  const dir = fixtureDir();
  const rolloutPath = join(dir, "rollout.jsonl");
  writeJsonl(rolloutPath, [
    { event: "thread_settings_applied", payload: { model: "gpt-5.6-terra", reasoning_effort: "low" } },
  ]);
  const result = readCodexRollout(rolloutPath);
  assert.equal(result.model, "gpt-5.6-terra");
  assert.equal(result.reasoningEffort, "low");
});

test("readCodexRollout: returns null when the event never appears", () => {
  const dir = fixtureDir();
  const rolloutPath = join(dir, "rollout.jsonl");
  writeJsonl(rolloutPath, [{ type: "session_start" }]);
  assert.equal(readCodexRollout(rolloutPath), null);
});

test("readCodexRollout: missing file returns null, never throws", () => {
  const dir = fixtureDir();
  assert.equal(readCodexRollout(join(dir, "missing.jsonl")), null);
});
