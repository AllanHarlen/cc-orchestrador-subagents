#!/usr/bin/env node
/**
 * CLI de ingestao do handoff do Pensador (`ingest-pensador [--root .] [--slug <slug>]`).
 * Read-only: descobre o handoff em `.pensador/<slug>-vN/` e relata o modo de
 * operacao (conjunto vs independente).
 */
import { ingestPensadorHandoff } from "./lib/pensador-ingest.mjs";
import { executeJsonCli, parseArgs } from "./lib/cli-utils.mjs";

function help() {
  return {
    name: "ingest-pensador",
    commands: {
      ingest: "ingest-pensador.mjs [--root .] [--slug <slug>]",
    },
  };
}

function main(argv) {
  const args = parseArgs(argv);
  if (args._[0] === "help" || args.help || args.h) return help();
  const root = args.root === true ? process.cwd() : (args.root ?? process.cwd());
  const slug = args.slug === true ? undefined : args.slug;
  return { result: ingestPensadorHandoff({ projectRoot: root, slug }) };
}

executeJsonCli(main);
