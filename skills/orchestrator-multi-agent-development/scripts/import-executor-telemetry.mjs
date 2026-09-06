#!/usr/bin/env node
/**
 * Importa telemetria de volta dos logs que AGY e Codex ja produzem, para uma
 * task especifica de uma run (`import-executor-telemetry.mjs --dir <run>
 * --task <ID> [--agy-log <path>] [--agy-pid <n>] [--codex-job <path>]
 * [--codex-rollout <path>]`).
 *
 * Achado 2 da run oficina-saas-20260905-001: a telemetria por task ficou
 * vazia em 33/33 tasks porque a Fase 6 nunca lia de volta o que as CLIs ja
 * tinham publicado. Este script e o "ler de volta": grava
 * conversationId/sessionId, resolvedModel, codexEffort, duracao real
 * (`--started-at`/`--completed-at`) e `producedFiles` (via `git diff
 * --name-only` entre `commitBefore`/`commitAfter`, que ja estao preenchidos
 * em toda task).
 *
 * Read-only sobre os logs externos; a unica escrita e a atualizacao da task
 * via `updateTaskStatus` — mesma trilha de auditoria (events.jsonl) de
 * qualquer outra mutacao de task.
 */
import { execFileSync } from "node:child_process";

import {
  loadRun,
  updateTaskStatus,
} from "./lib/orchestration-state.mjs";
import {
  readAgyBridgeEvents,
  readCodexJob,
  readCodexRollout,
} from "./lib/executor-telemetry.mjs";
import { executeJsonCli, parseArgs } from "./lib/cli-utils.mjs";

function help() {
  return {
    name: "import-executor-telemetry",
    commands: {
      import: "import-executor-telemetry.mjs --dir <run> --task <ID> --root <projectRoot> " +
        "[--agy-log <path>] [--agy-pid <n>] [--agy-since <iso>] " +
        "[--codex-job <path>] [--codex-rollout <path>] [--dry-run]",
    },
  };
}

/** `git diff --name-only <before>..<after>` no projectRoot — [] em qualquer falha, nunca lanca. */
function producedFilesBetween(projectRoot, before, after) {
  if (!before || !after || before === after) return [];
  try {
    const output = execFileSync(
      "git",
      ["diff", "--name-only", `${before}..${after}`],
      { cwd: projectRoot, encoding: "utf8", windowsHide: true },
    );
    return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function main(argv) {
  const args = parseArgs(argv);
  if (args._[0] === "help" || args.help || args.h) return help();

  const dir = args.dir === true ? undefined : args.dir;
  if (!dir) {
    const error = new Error("--dir is required");
    error.code = "MISSING_ARGUMENT";
    throw error;
  }
  const taskId = args.task === true ? undefined : args.task;
  if (!taskId) {
    const error = new Error("--task is required");
    error.code = "MISSING_ARGUMENT";
    throw error;
  }
  const projectRoot = args.root === true ? process.cwd() : (args.root ?? process.cwd());

  const state = loadRun(dir).state;
  const task = state.tasks[String(taskId).toUpperCase()];
  if (!task) {
    const error = new Error(`Task ${taskId} not found in ${dir}`);
    error.code = "TASK_NOT_FOUND";
    throw error;
  }

  const captured = {};
  const sources = {};

  if (args["agy-log"] && args["agy-log"] !== true) {
    const agyPid = args["agy-pid"] != null && args["agy-pid"] !== true ? Number(args["agy-pid"]) : undefined;
    const agy = readAgyBridgeEvents(args["agy-log"], {
      pid: agyPid,
      since: args["agy-since"] === true ? undefined : args["agy-since"],
    });
    sources.agy = agy;
    if (agy.conversationId) captured.conversationId = agy.conversationId;
    if (agy.resolvedModel) captured.resolvedModel = agy.resolvedModel;
    if (agy.startedAt) captured.startedAt = agy.startedAt;
    if (agy.finishedAt) captured.completedAt = agy.finishedAt;
    if (Number.isFinite(agy.durationMs)) captured.durationSeconds = Math.round(agy.durationMs / 1000);
  }

  if (args["codex-job"] && args["codex-job"] !== true) {
    const job = readCodexJob(args["codex-job"]);
    sources.codexJob = job;
    if (job) {
      if (job.threadId) captured.conversationId = job.threadId;
      if (job.model) captured.resolvedModel = job.model;
      if (job.effort) captured.codexEffort = job.effort;
      if (job.startedAt) captured.startedAt = job.startedAt;
      if (job.finishedAt) captured.completedAt = job.finishedAt;
    }
  }

  if (args["codex-rollout"] && args["codex-rollout"] !== true) {
    const rollout = readCodexRollout(args["codex-rollout"]);
    sources.codexRollout = rollout;
    // O rollout e a fonte da verdade do que o Codex de fato usou — sobrepoe
    // qualquer valor planejado/assumido do job sidecar (Achado 13: o modelo
    // pedido e o efetivamente resolvido podem divergir sem aviso).
    if (rollout?.model) captured.resolvedModel = rollout.model;
    if (rollout?.reasoningEffort) captured.codexEffort = rollout.reasoningEffort;
  }

  const producedFiles = producedFilesBetween(projectRoot, task.commitBefore, task.commitAfter);
  if (producedFiles.length > 0) captured.producedFiles = producedFiles;

  if (args["dry-run"]) {
    return { result: { taskId: task.id, dryRun: true, captured, sources } };
  }

  if (Object.keys(captured).length === 0) {
    return { result: { taskId: task.id, updated: false, reason: "no telemetry field captured from the given sources", sources } };
  }

  const updated = updateTaskStatus(dir, task.id, task.status, {
    projectRoot,
    ...captured,
  });

  return {
    result: {
      taskId: task.id,
      updated: true,
      captured,
      task: updated.state.tasks[task.id],
    },
  };
}

executeJsonCli(main);
