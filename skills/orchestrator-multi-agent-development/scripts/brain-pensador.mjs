#!/usr/bin/env node
/**
 * CLI do subcomando `/orquestrador brain-pensador` (`brain-pensador.mjs
 * [--root .] [--limit 10] [--all]`). Read-only: lista os handoffs do
 * Pensador em `.pensador/`, um por slug (versao mais alta), ordenados por
 * recencia, para o usuario escolher qual implementar em modo conjunto.
 *
 * Nunca escreve em `.pensador/` — a mesma regra absoluta de
 * `lib/pensador-ingest.mjs`.
 */
import { listPensadorHandoffs } from "./lib/pensador-ingest.mjs";
import { executeJsonCli, parseArgs } from "./lib/cli-utils.mjs";

function help() {
  return {
    name: "brain-pensador",
    commands: {
      list: "brain-pensador.mjs [--root .] [--limit 10] [--all]",
    },
  };
}

function main(argv) {
  const args = parseArgs(argv);
  if (args._[0] === "help" || args.help || args.h) return help();
  const root = args.root === true ? process.cwd() : (args.root ?? process.cwd());
  const all = Boolean(args.all);
  const limit = args.limit === true ? undefined : args.limit;
  const handoffs = listPensadorHandoffs({ projectRoot: root, limit, all });
  return { result: { handoffs, count: handoffs.length } };
}

executeJsonCli(main);
