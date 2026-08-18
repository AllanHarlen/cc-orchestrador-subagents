#!/usr/bin/env node

import {
  addValidatedFact,
  auditKnowledgeSources,
  knowledgeStatus,
  listFacts,
  pinFact,
  renderProjectMemory,
  revokeFact,
} from "./lib/project-knowledge.mjs";
import {
  browseHistory,
  historyStatus,
  projectAllHistory,
  projectRunHistory,
  rebuildHistory,
  searchHistory,
} from "./lib/orchestration-history.mjs";
import {
  boolArg,
  executeJsonCli,
  jsonArg,
  numberArg,
  parseArgs,
  required,
} from "./lib/cli-utils.mjs";

function help() {
  return {
    name: "orchestrator-knowledge",
    nodeRequirement: ">=22.13.0 (node:sqlite without --experimental-sqlite)",
    commands: {
      init: "init [--root <project>]",
      status: "status [--root <project>]",
      render: "render [--max-facts 100] [--max-chars 16000]",
      "fact-add": "fact-add --section <section> --key <key> (--value <text>|--value-json <json>) --source-type FILE|CONTRACT|TEST|RUN_EVENT|USER --source-ref <ref>",
      "fact-list": "fact-list [--status VALIDATED|CONFLICT|STALE|REVOKED]",
      "fact-revoke": "fact-revoke --id <factId> --reason <text>",
      "fact-pin": "fact-pin --id <factId> [--pinned true|false]",
      audit: "audit",
      "history-project": "history-project [--dir .orchestration/<slug>|--rebuild] [--fail-fast]",
      "history-search": "history-search <query> [--limit 10] [--raw]",
      "history-browse": "history-browse [--limit 20]",
      "history-status": "history-status",
    },
  };
}

function maybeRender(root, args) {
  return boolArg(args["no-render"], false)
    ? null
    : renderProjectMemory(root, {
        maxFacts: numberArg(args["max-facts"]),
        maxChars: numberArg(args["max-chars"]),
      });
}

function main(argv) {
  const [command = "help", ...rest] = argv;
  const args = parseArgs(rest);
  const root = args.root ?? process.cwd();
  switch (command) {
    case "help":
    case "--help":
    case "-h":
      return help();
    case "init":
      return { status: knowledgeStatus(root), memory: renderProjectMemory(root) };
    case "status":
      return { status: knowledgeStatus(root) };
    case "render":
      return {
        memory: renderProjectMemory(root, {
          maxFacts: numberArg(args["max-facts"]),
          maxChars: numberArg(args["max-chars"]),
        }),
      };
    case "fact-add": {
      const value = args["value-json"] !== undefined
        ? jsonArg(args["value-json"])
        : required(args, "value");
      const result = addValidatedFact(root, {
        section: required(args, "section"),
        key: required(args, "key"),
        value,
        sourceType: required(args, "source-type"),
        sourceRef: required(args, "source-ref"),
        sourceStatus: args["source-status"],
        evidence: args["evidence-json"] ? jsonArg(args["evidence-json"]) : undefined,
        confidence: numberArg(args.confidence, 1),
        runId: args["run-id"],
        pinned: boolArg(args.pinned, false),
      });
      return { result, memory: maybeRender(root, args) };
    }
    case "fact-list":
      return { facts: listFacts(root, { status: args.status }) };
    case "fact-revoke": {
      const fact = revokeFact(root, required(args, "id"), required(args, "reason"));
      return { fact, memory: maybeRender(root, args) };
    }
    case "fact-pin": {
      const fact = pinFact(root, required(args, "id"), boolArg(args.pinned, true));
      return { fact, memory: maybeRender(root, args) };
    }
    case "audit": {
      const audit = auditKnowledgeSources(root);
      return { audit, memory: maybeRender(root, args) };
    }
    case "history-project":
      if (args.dir) return { projection: projectRunHistory(root, args.dir) };
      if (boolArg(args.rebuild, false)) {
        return { projection: rebuildHistory(root, { failFast: boolArg(args["fail-fast"], false) }) };
      }
      return { projection: projectAllHistory(root, { failFast: boolArg(args["fail-fast"], false) }) };
    case "history-search":
      return searchHistory(root, args._.join(" ") || required(args, "query"), {
        limit: numberArg(args.limit),
        raw: boolArg(args.raw, false),
      });
    case "history-browse":
      return { runs: browseHistory(root, { limit: numberArg(args.limit) }) };
    case "history-status":
      return { status: historyStatus(root) };
    default: {
      const error = new Error(`Unknown command: ${command}`);
      error.code = "UNKNOWN_COMMAND";
      throw error;
    }
  }
}

executeJsonCli(main);
