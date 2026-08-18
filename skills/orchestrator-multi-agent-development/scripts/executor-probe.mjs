#!/usr/bin/env node

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { adaptExecutorProbe, adaptProbeSet } from "./lib/executor-adapters.mjs";
import { boolArg, executeJsonCli, parseArgs, readJsonFile, required } from "./lib/cli-utils.mjs";

function writeAtomic(path, value) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, absolute);
  return absolute;
}

function main(argv) {
  const args = parseArgs(argv);
  const input = args.input
    ? readJsonFile(args.input)
    : args.text
      ? args.text
      : args["text-file"]
        ? readFileSync(resolve(args["text-file"]), "utf8")
        : null;
  if (input == null) required(args, "input");
  const probe = args.task
    ? {
        schemaVersion: 1,
        tasks: {
          [String(args.task).toUpperCase()]: adaptExecutorProbe(
            required(args, "executor"),
            input,
            { authoritative: boolArg(args.authoritative) },
          ),
        },
      }
    : adaptProbeSet(input, {
        executor: args.executor,
        authoritative: boolArg(args.authoritative),
      });
  return { probe, output: args.output ? writeAtomic(args.output, probe) : null };
}

executeJsonCli(main);
