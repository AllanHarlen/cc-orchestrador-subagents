#!/usr/bin/env node

import {
  boolArg,
  executeJsonCli,
  jsonArg,
  numberArg,
  parseArgs,
  required,
} from "./lib/cli-utils.mjs";
import {
  buildOtlpLogExport,
  compactTelemetry,
  exportTelemetryOtlp,
  projectRunTelemetry,
  recordTelemetry,
  telemetryReport,
} from "./lib/telemetry.mjs";

function help() {
  return {
    name: "orchestration-telemetry",
    privacy: "metadata-only; prompts, source, diffs, raw output and secrets are rejected",
    commands: {
      project: "project --dir .orchestration/<slug>",
      record: "record --event-json <json>",
      report: "report [--detailed]",
      compact: "compact [--retention-days 365] [--apply]",
      "otlp-preview": "otlp-preview [--since <ISO>] [--limit N]",
      "otlp-export": "otlp-export --endpoint <https-url> [--headers-json <json>] [--allow-insecure]",
    },
  };
}

function main(argv) {
  const [command = "report", ...rest] = argv;
  const args = parseArgs(rest);
  const root = args.root ?? process.cwd();
  switch (command) {
    case "help":
    case "--help":
    case "-h":
      return help();
    case "project":
      return { projection: projectRunTelemetry(root, required(args, "dir")) };
    case "record":
      return { record: recordTelemetry(root, jsonArg(required(args, "event-json"))) };
    case "report":
      return { report: telemetryReport(root, { detailed: boolArg(args.detailed, false) }) };
    case "compact":
      return compactTelemetry(root, {
        retentionDays: numberArg(args["retention-days"]),
        dryRun: !boolArg(args.apply, false),
        now: args.now,
      });
    case "otlp-preview":
      return {
        payload: buildOtlpLogExport(root, {
          since: args.since,
          limit: numberArg(args.limit),
        }),
      };
    case "otlp-export":
      return exportTelemetryOtlp(root, {
        endpoint: required(args, "endpoint"),
        headers: args["headers-json"] ? jsonArg(args["headers-json"]) : undefined,
        allowInsecure: boolArg(args["allow-insecure"], false),
        since: args.since,
        limit: numberArg(args.limit),
        timeoutMs: numberArg(args["timeout-ms"]),
      });
    default: {
      const error = new Error(`Unknown telemetry command: ${command}`);
      error.code = "UNKNOWN_COMMAND";
      throw error;
    }
  }
}

executeJsonCli(main);
