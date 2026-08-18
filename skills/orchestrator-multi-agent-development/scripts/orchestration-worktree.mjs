#!/usr/bin/env node

import {
  cleanupTaskWorktree,
  createTaskWorktree,
  integrateTaskWorktree,
  markTaskWorktreeReady,
  planTaskWorktrees,
  recoverTaskWorktrees,
  worktreeStatus,
} from "./lib/worktree-manager.mjs";
import { boolArg, executeJsonCli, parseArgs, required } from "./lib/cli-utils.mjs";

function help() {
  return {
    name: "orchestration-worktree",
    warning: "create/integrate/cleanup mutate Git. plan/status/recover only inspect or reconcile persisted state.",
    commands: {
      plan: "plan --dir .orchestration/<slug> [--task T1 --task T2] [--wave 1]",
      create: "create --dir <run> --task <id> [--base <commit>]",
      status: "status --dir <run> [--task <id>]",
      ready: "ready --dir <run> --task <id> [--allow-empty]",
      integrate: "integrate --dir <run> --task <id> [--integration-branch <branch>]",
      cleanup: "cleanup --dir <run> --task <id> [--force] [--keep-branch]",
      recover: "recover --dir <run>",
    },
  };
}

function listArg(value) {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

function main(argv) {
  const [command = "help", ...rest] = argv;
  const args = parseArgs(rest);
  const root = args.root ?? process.cwd();
  const dir = args.dir;
  switch (command) {
    case "help":
    case "--help":
    case "-h":
      return help();
    case "plan":
      return { plan: planTaskWorktrees(root, required(args, "dir"), {
        taskIds: listArg(args.task),
        wave: args.wave,
      }) };
    case "create":
      return createTaskWorktree(root, required(args, "dir"), required(args, "task"), {
        baseCommit: args.base,
        force: boolArg(args.force, false),
      });
    case "status":
      return worktreeStatus(root, required(args, "dir"), { taskIds: listArg(args.task) });
    case "ready":
      return markTaskWorktreeReady(root, required(args, "dir"), required(args, "task"), {
        allowEmpty: boolArg(args["allow-empty"], false),
      });
    case "integrate":
      return integrateTaskWorktree(root, required(args, "dir"), required(args, "task"), {
        integrationBranch: args["integration-branch"],
      });
    case "cleanup":
      return cleanupTaskWorktree(root, required(args, "dir"), required(args, "task"), {
        force: boolArg(args.force, false),
        keepBranch: boolArg(args["keep-branch"], false),
      });
    case "recover":
      return recoverTaskWorktrees(root, required(args, "dir"));
    default: {
      const error = new Error(`Unknown command: ${command}`);
      error.code = "UNKNOWN_COMMAND";
      throw error;
    }
  }
}

executeJsonCli(main);
