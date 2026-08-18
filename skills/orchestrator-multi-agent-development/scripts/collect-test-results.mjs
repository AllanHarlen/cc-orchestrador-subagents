#!/usr/bin/env node

import { resolve } from "node:path";

import { boolArg, executeJsonCli, parseArgs, required } from "./lib/cli-utils.mjs";
import { addValidatedFact, renderProjectMemory } from "./lib/project-knowledge.mjs";
import {
  collectInputFiles,
  intelligenceResult,
  persistIntelligenceEvidence,
  readTextBounded,
} from "./lib/intelligence.mjs";

function attr(text, name) {
  const value = text.match(new RegExp(`\\b${name}="([^"]+)"`, "i"))?.[1];
  return value == null ? 0 : Number(value) || 0;
}

function parseJUnit(content) {
  const suites = [...content.matchAll(/<testsuite\b([^>]*)>/gi)].map((match) => match[1]);
  if (suites.length === 0) return null;
  return suites.reduce((result, attributes) => ({
    total: result.total + attr(attributes, "tests"),
    passed: result.passed + Math.max(0,
      attr(attributes, "tests") - attr(attributes, "failures") - attr(attributes, "errors") - attr(attributes, "skipped"),
    ),
    failed: result.failed + attr(attributes, "failures") + attr(attributes, "errors"),
    skipped: result.skipped + attr(attributes, "skipped"),
    durationSeconds: result.durationSeconds + attr(attributes, "time"),
  }), { total: 0, passed: 0, failed: 0, skipped: 0, durationSeconds: 0, format: "junit" });
}

function parseTrx(content) {
  const counters = content.match(/<Counters\b([^>]*)\/>/i)?.[1];
  if (!counters) return null;
  const total = attr(counters, "total");
  const failed = attr(counters, "failed") + attr(counters, "error") + attr(counters, "timeout") + attr(counters, "aborted");
  const skipped = attr(counters, "notExecuted") + attr(counters, "inconclusive");
  return {
    format: "trx",
    total,
    passed: attr(counters, "passed") || Math.max(0, total - failed - skipped),
    failed,
    skipped,
    durationSeconds: 0,
  };
}

function parseJson(content) {
  let value;
  try {
    value = JSON.parse(content);
  } catch {
    return null;
  }
  const source = value.numTotalTests != null
    ? {
        total: value.numTotalTests,
        passed: value.numPassedTests,
        failed: value.numFailedTests,
        skipped: value.numPendingTests ?? value.numTodoTests,
      }
    : value.summary ?? value;
  const total = Number(source.total ?? source.tests ?? 0);
  const failed = Number(source.failed ?? source.failures ?? source.errors ?? 0);
  const skipped = Number(source.skipped ?? source.pending ?? 0);
  const passed = Number(source.passed ?? Math.max(0, total - failed - skipped));
  if (![total, failed, skipped, passed].some((number) => number > 0)) return null;
  return {
    format: "json",
    total,
    passed,
    failed,
    skipped,
    durationSeconds: Number(source.durationSeconds ?? source.duration ?? 0),
  };
}

function parseText(content) {
  const patterns = {
    total: /(?:tests?|total)\s*[:=]?\s*(\d+)/i,
    passed: /(?:passed|pass)\s*[:=]?\s*(\d+)/i,
    failed: /(?:failed|failures?)\s*[:=]?\s*(\d+)/i,
    skipped: /(?:skipped|pending)\s*[:=]?\s*(\d+)/i,
  };
  const values = Object.fromEntries(Object.entries(patterns).map(([key, pattern]) => [
    key,
    Number(content.match(pattern)?.[1] ?? 0),
  ]));
  if (Object.values(values).every((number) => number === 0)) return null;
  return { format: "text", ...values, durationSeconds: 0 };
}

function parseResult(file) {
  const content = readTextBounded(file.absolute, 10_000_000);
  const parsed = parseTrx(content) ?? parseJUnit(content) ?? parseJson(content) ?? parseText(content);
  if (!parsed) return { path: file.relative, format: "unknown", parsed: false };
  return { path: file.relative, parsed: true, ...parsed };
}

function main(argv) {
  const args = parseArgs(argv);
  const root = resolve(args.root ?? process.cwd());
  const inputs = args.input ?? args._;
  if (!inputs || inputs.length === 0) required(args, "input");
  const files = collectInputFiles(root, inputs);
  const results = files.map(parseResult);
  const parsed = results.filter((result) => result.parsed);
  const totals = parsed.reduce((accumulator, result) => ({
    total: accumulator.total + result.total,
    passed: accumulator.passed + result.passed,
    failed: accumulator.failed + result.failed,
    skipped: accumulator.skipped + result.skipped,
    durationSeconds: accumulator.durationSeconds + result.durationSeconds,
  }), { total: 0, passed: 0, failed: 0, skipped: 0, durationSeconds: 0 });
  const summary = {
    filesChecked: files.length,
    filesParsed: parsed.length,
    filesUnparsed: results.length - parsed.length,
    ...totals,
    status: parsed.length === 0 ? "UNKNOWN" : totals.failed > 0 ? "FAIL" : "PASS",
  };
  const result = intelligenceResult("collect-test-results", summary, { results });
  const knowledge = boolArg(args["persist-knowledge"], false) && summary.status === "PASS"
    ? {
        fact: addValidatedFact(root, {
          section: "Validation",
          key: args.command ?? `collected:${files.map((file) => file.relative).join(",")}`,
          value: args.command ?? `validated by ${files.length} result file(s)`,
          sourceType: "TEST",
          sourceRef: args.command ?? files.map((file) => file.relative).join(","),
          sourceStatus: "PASS",
          evidence: { summary, evidenceId: result.evidenceId },
        }),
        memory: renderProjectMemory(root),
      }
    : null;
  return {
    result,
    knowledge,
    validation: {
      command: args.command ?? `collected:${files.length}-result-files`,
      status: summary.status,
      evidenceId: result.evidenceId,
    },
    persistence: persistIntelligenceEvidence(result, {
      artifactDir: args.dir,
      taskId: args.task,
      projectRoot: root,
    }),
  };
}

executeJsonCli(main);
