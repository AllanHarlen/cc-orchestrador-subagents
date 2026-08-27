#!/usr/bin/env node
/**
 * CLI: validates a handoff.json file against the canonical envelope shape
 * (scripts/lib/handoff-validator.mjs). Producers run this before writing
 * `status: "DONE"`; consumers run it before trusting an upstream handoff.
 *
 * Usage:
 *   node scripts/validate-handoff.mjs --file <path/to/handoff.json>
 *
 * Output: JSON to stdout, `{ ok: boolean, file: string, errors: [...] }`.
 * Exit code 0 only when `ok === true` — mirrors preflight.mjs's convention
 * of always emitting JSON but signaling failure via a non-zero exit too, so
 * this also works as a plain shell gate (`node validate-handoff.mjs --file
 * <path> || exit 1`).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateHandoff } from "./lib/handoff-validator.mjs";

function parseArgs(argv) {
  const args = { file: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--file") {
      args.file = argv[i + 1] ?? null;
      i += 1;
    }
  }
  return args;
}

function main() {
  const { file } = parseArgs(process.argv.slice(2));
  if (!file) {
    console.log(JSON.stringify({ ok: false, file: null, errors: [{ code: "MISSING_FILE_ARG", message: "--file <path> is required", path: null }] }));
    process.exitCode = 1;
    return;
  }

  const resolved = resolve(file);
  let raw;
  try {
    raw = readFileSync(resolved, "utf8");
  } catch (error) {
    console.log(JSON.stringify({ ok: false, file: resolved, errors: [{ code: "FILE_NOT_READABLE", message: error.message, path: null }] }));
    process.exitCode = 1;
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.log(JSON.stringify({ ok: false, file: resolved, errors: [{ code: "INVALID_JSON", message: error.message, path: null }] }));
    process.exitCode = 1;
    return;
  }

  const result = validateHandoff(parsed);
  console.log(JSON.stringify({ ok: result.ok, file: resolved, errors: result.errors }, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

main();
