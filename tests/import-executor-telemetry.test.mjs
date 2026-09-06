/**
 * `import-executor-telemetry.mjs`: le os logs que AGY/Codex ja publicam e
 * grava a telemetria de volta numa task de uma run real — end-to-end sobre
 * `orchestration-state.mjs`, não apenas os leitores puros de
 * `executor-telemetry.test.mjs`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import { loadRun } from "../skills/orchestrator-multi-agent-development/scripts/lib/orchestration-state.mjs";

const CLI = resolve("skills/orchestrator-multi-agent-development/scripts/import-executor-telemetry.mjs");
const STATE_CLI = resolve("skills/orchestrator-multi-agent-development/scripts/orchestration-state.mjs");
const roots = [];

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || `git ${args.join(" ")} failed`);
  return String(result.stdout).trim();
}

function stateCli(args) {
  const result = spawnSync(process.execPath, [STATE_CLI, ...args], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}

function importCli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", windowsHide: true });
  return { status: result.status, json: JSON.parse(result.stdout) };
}

function fixture() {
  const root = mkdtempSync(join(process.cwd(), ".tmp-import-telemetry-test-"));
  roots.push(root);
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "orchestrator-tests@example.invalid");
  git(root, "config", "user.name", "Orchestrator Tests");
  writeFileSync(join(root, "README.md"), "seed\n", "utf8");
  // .orchestration/ nao entra no repo do usuario (coordenacao, nao produto) —
  // sem isso, todo `git add -A` do teste pegaria state.json/events.jsonl
  // junto com a mudanca de producao real, contaminando o diff que
  // producedFiles deveria isolar.
  writeFileSync(join(root, ".gitignore"), ".orchestration/\n", "utf8");
  git(root, "add", "-A");
  git(root, "commit", "-m", "seed");

  const artifactDir = join(root, ".orchestration", "run");
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(
    join(artifactDir, "tasks-classification.md"),
    ["# Tasks", "", "## BE-01 - Endpoint", "- category: BACKEND_ONLY"].join("\n"),
    "utf8",
  );
  writeFileSync(join(artifactDir, "waves.md"), "# Waves\n\n## Wave 1\n- BE-01\n", "utf8");
  stateCli(["init", "--slug", "run", "--dir", artifactDir, "--root", root]);
  return { root, artifactDir };
}

test.afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

test("imports conversationId/resolvedModel/duration from an AGY bridge.exit event", () => {
  const { root, artifactDir } = fixture();
  stateCli(["task", "--dir", artifactDir, "--root", root, "--task", "BE-01", "--status", "RUNNING", "--executor", "agy"]);

  const logPath = join(root, "agy-bridge.jsonl");
  writeFileSync(
    logPath,
    JSON.stringify({
      timestamp: "2026-09-05T18:39:00.000Z",
      pid: 777,
      event: "bridge.exit",
      exitCode: 0,
      model: "flash-high",
      conversationId: "conv-fe07",
      durationMs: 644_206,
      outputBytes: 12000,
      classified: null,
    }) + "\n",
    "utf8",
  );

  const { status, json } = importCli([
    "--dir", artifactDir, "--task", "BE-01", "--root", root,
    "--agy-log", logPath, "--agy-pid", "777",
  ]);
  assert.equal(status, 0, JSON.stringify(json));
  assert.equal(json.result.updated, true);
  assert.equal(json.result.captured.conversationId, "conv-fe07");
  assert.equal(json.result.captured.resolvedModel, "flash-high");
  assert.equal(json.result.captured.durationSeconds, 644);

  const state = loadRun(artifactDir).state;
  assert.equal(state.tasks["BE-01"].conversationId, "conv-fe07");
  assert.equal(state.tasks["BE-01"].resolvedModel, "flash-high");
});

test("imports threadId/model/effort from a Codex job sidecar", () => {
  const { root, artifactDir } = fixture();
  stateCli(["task", "--dir", artifactDir, "--root", root, "--task", "BE-01", "--status", "RUNNING", "--executor", "codex"]);

  const jobPath = join(root, "job.json");
  writeFileSync(
    jobPath,
    JSON.stringify({
      threadId: "01a072c1-38a5-7913-994f-9c77565bd3cc",
      model: "gpt-5.6-terra",
      effort: "medium",
    }),
    "utf8",
  );

  const { status, json } = importCli(["--dir", artifactDir, "--task", "BE-01", "--root", root, "--codex-job", jobPath]);
  assert.equal(status, 0, JSON.stringify(json));
  assert.equal(json.result.captured.conversationId, "01a072c1-38a5-7913-994f-9c77565bd3cc");
  assert.equal(json.result.captured.resolvedModel, "gpt-5.6-terra");
  assert.equal(json.result.captured.codexEffort, "medium");
});

test("the Codex rollout's effectively-resolved model overrides the job sidecar's (Achado 13)", () => {
  const { root, artifactDir } = fixture();
  stateCli(["task", "--dir", artifactDir, "--root", root, "--task", "BE-01", "--status", "RUNNING", "--executor", "codex"]);

  const jobPath = join(root, "job.json");
  writeFileSync(jobPath, JSON.stringify({ model: "gpt-5.6-terra", effort: "medium" }), "utf8");
  const rolloutPath = join(root, "rollout.jsonl");
  writeFileSync(
    rolloutPath,
    JSON.stringify({
      type: "thread_settings_applied",
      model: "gpt-5.6-sol",
      reasoning_effort: "medium",
    }) + "\n",
    "utf8",
  );

  const { json } = importCli([
    "--dir", artifactDir, "--task", "BE-01", "--root", root,
    "--codex-job", jobPath, "--codex-rollout", rolloutPath,
  ]);
  // O job pediu terra; o rollout mostra que sol foi o que de fato rodou —
  // exatamente o cenario do Achado 13 (modelo de review fazendo implementacao).
  assert.equal(json.result.captured.resolvedModel, "gpt-5.6-sol");
});

test("derives producedFiles from git diff between commitBefore and commitAfter", () => {
  const { root, artifactDir } = fixture();
  stateCli(["task", "--dir", artifactDir, "--root", root, "--task", "BE-01", "--status", "RUNNING", "--executor", "codex"]);

  writeFileSync(join(root, "src.txt"), "new file\n", "utf8");
  git(root, "add", "-A");
  git(root, "commit", "-m", "BE-01 work");

  stateCli(["task", "--dir", artifactDir, "--root", root, "--task", "BE-01", "--status", "DONE", "--evidence", "executor:DONE"]);

  const { status, json } = importCli(["--dir", artifactDir, "--task", "BE-01", "--root", root]);
  assert.equal(status, 0, JSON.stringify(json));
  assert.deepEqual(json.result.captured.producedFiles, ["src.txt"]);
});

test("--dry-run reports what would be captured without writing to the run", () => {
  const { root, artifactDir } = fixture();
  stateCli(["task", "--dir", artifactDir, "--root", root, "--task", "BE-01", "--status", "RUNNING", "--executor", "agy"]);

  const logPath = join(root, "agy-bridge.jsonl");
  writeFileSync(
    logPath,
    JSON.stringify({ timestamp: "2026-09-05T18:39:00.000Z", pid: 1, event: "bridge.exit", exitCode: 0, conversationId: "conv-dry" }) + "\n",
    "utf8",
  );

  const { json } = importCli(["--dir", artifactDir, "--task", "BE-01", "--root", root, "--agy-log", logPath, "--agy-pid", "1", "--dry-run"]);
  assert.equal(json.result.dryRun, true);
  assert.equal(json.result.captured.conversationId, "conv-dry");

  const state = loadRun(artifactDir).state;
  assert.equal(state.tasks["BE-01"].conversationId, null, "dry-run must not mutate the run");
});

test("no sources given: reports nothing captured, no error", () => {
  const { root, artifactDir } = fixture();
  stateCli(["task", "--dir", artifactDir, "--root", root, "--task", "BE-01", "--status", "RUNNING", "--executor", "codex"]);
  const { status, json } = importCli(["--dir", artifactDir, "--task", "BE-01", "--root", root]);
  assert.equal(status, 0);
  assert.equal(json.result.updated, false);
});

test("unknown task id: TASK_NOT_FOUND", () => {
  const { root, artifactDir } = fixture();
  const result = spawnSync(process.execPath, [CLI, "--dir", artifactDir, "--task", "BE-99", "--root", root], {
    encoding: "utf8", windowsHide: true,
  });
  assert.equal(result.status, 1);
  // executeJsonCli writes error envelopes to stderr, success to stdout.
  const json = JSON.parse(result.stderr);
  assert.equal(json.error.code, "TASK_NOT_FOUND");
});
