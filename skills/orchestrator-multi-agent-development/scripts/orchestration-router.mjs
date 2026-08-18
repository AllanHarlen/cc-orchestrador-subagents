#!/usr/bin/env node

import {
  adaptiveRoutingReport,
  recordRoutingDecision,
  routeModel,
} from "./lib/adaptive-router.mjs";
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
    name: "orchestration-router",
    commands: {
      route: "route --context-json <json> [--record --run-id <id> --task-id <id>]",
      report: "report [--minimum-samples 5]",
    },
  };
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
    case "route": {
      const context = jsonArg(required(args, "context-json"));
      const thresholds = {
        minimumSamples: numberArg(args["minimum-samples"]),
        minimumStratumSamples: numberArg(args["minimum-stratum-samples"]),
        minimumQualityGain: numberArg(args["minimum-quality-gain"]),
        minimumScoreGain: numberArg(args["minimum-score-gain"]),
      };
      const decision = routeModel(root, context, thresholds);
      const recorded = boolArg(args.record, false)
        ? recordRoutingDecision(root, decision, context, {
            runId: required(args, "run-id"),
            taskId: required(args, "task-id"),
            attempt: numberArg(args.attempt),
          })
        : null;
      return { decision, recorded };
    }
    case "report":
      return { report: adaptiveRoutingReport(root, { minimumSamples: numberArg(args["minimum-samples"]) }) };
    default: {
      const error = new Error(`Unknown command: ${command}`);
      error.code = "UNKNOWN_COMMAND";
      throw error;
    }
  }
}

executeJsonCli(main);
