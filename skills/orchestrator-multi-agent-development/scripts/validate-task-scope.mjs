#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { executeJsonCli, parseArgs, required } from "./lib/cli-utils.mjs";
import {
  inspectGit,
  loadRun,
} from "./lib/orchestration-state.mjs";
import { intelligenceResult, persistIntelligenceEvidence } from "./lib/intelligence.mjs";

function committedFiles(root, before, head) {
  if (!before || !head || before === head) return [];
  try {
    return execFileSync("git", ["diff", "--name-only", `${before}..${head}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    }).split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function patternRegex(pattern) {
  const normalized = String(pattern).replaceAll("\\", "/").replace(/^\.\//, "");
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "::DOUBLE_STAR::")
    .replaceAll("*", "[^/]*")
    .replaceAll("::DOUBLE_STAR::", ".*");
  return new RegExp(`^${escaped}${normalized.endsWith("/") ? ".*" : "(?:$|/.*)"}`);
}

function matchesScope(path, patterns) {
  const normalized = path.replaceAll("\\", "/");
  return patterns.some((pattern) => patternRegex(pattern).test(normalized));
}

function overlap(left, right) {
  return left.some((leftPattern) => right.some((rightPattern) => {
    const leftBase = String(leftPattern).replace(/[*].*$/, "").replace(/\/$/, "");
    const rightBase = String(rightPattern).replace(/[*].*$/, "").replace(/\/$/, "");
    return leftBase && rightBase &&
      (leftBase === rightBase || leftBase.startsWith(`${rightBase}/`) || rightBase.startsWith(`${leftBase}/`));
  }));
}

function main(argv) {
  const args = parseArgs(argv);
  const root = resolve(args.root ?? process.cwd());
  const artifactDir = resolve(required(args, "dir"));
  const taskId = String(required(args, "task")).toUpperCase();
  const state = loadRun(artifactDir, { verifyReplay: true }).state;
  const task = state.tasks?.[taskId];
  if (!task) {
    const error = new Error(`Task not found: ${taskId}`);
    error.code = "TASK_NOT_FOUND";
    throw error;
  }
  const git = inspectGit(root);
  const changedFiles = [...new Set([
    ...(git.changedFiles ?? []),
    ...committedFiles(root, task.commitBefore, git.head),
  ])].filter((path) => {
    const normalized = path.replaceAll("\\", "/");
    return !normalized.startsWith(".orchestration/") && !normalized.startsWith(".orchestrator/");
  }).sort();
  const scopePatterns = (task.allowedPaths?.length ? task.allowedPaths : task.expectedFiles) ?? [];
  const outOfScope = scopePatterns.length === 0
    ? changedFiles
    : changedFiles.filter((path) => !matchesScope(path, scopePatterns));
  const overlappingTasks = Object.values(state.tasks)
    .filter((candidate) => candidate.id !== taskId && !["DONE", "CANCELLED"].includes(candidate.status))
    .map((candidate) => ({
      taskId: candidate.id,
      patterns: (candidate.allowedPaths?.length ? candidate.allowedPaths : candidate.expectedFiles) ?? [],
    }))
    .filter((candidate) => overlap(scopePatterns, candidate.patterns))
    .map((candidate) => candidate.taskId);
  const summary = {
    taskId,
    filesChanged: changedFiles.length,
    scopePatterns: scopePatterns.length,
    outOfScope: outOfScope.length,
    overlappingActiveTasks: overlappingTasks.length,
    valid: outOfScope.length === 0 && overlappingTasks.length === 0,
  };
  const result = intelligenceResult("validate-task-scope", summary, {
    changedFiles,
    allowedPatterns: scopePatterns,
    outOfScope,
    overlappingTasks,
  });
  return {
    result,
    persistence: persistIntelligenceEvidence(result, {
      artifactDir,
      taskId,
      projectRoot: root,
    }),
  };
}

executeJsonCli(main);
