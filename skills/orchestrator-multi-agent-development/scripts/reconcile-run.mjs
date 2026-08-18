#!/usr/bin/env node

import { resolve } from "node:path";

import { boolArg, executeJsonCli, parseArgs, required } from "./lib/cli-utils.mjs";
import {
  reconcileRunAtDirectory,
  resumeRunAtDirectory,
  verifyRun,
} from "./lib/orchestration-state.mjs";
import { intelligenceResult, persistIntelligenceEvidence } from "./lib/intelligence.mjs";

function main(argv) {
  const args = parseArgs(argv);
  const root = resolve(args.root ?? process.cwd());
  const artifactDir = resolve(required(args, "dir"));
  const options = {
    projectRoot: root,
    probeFile: args["probe-file"],
    actor: "intelligence:reconcile-run",
  };
  const reconciliation = boolArg(args.resume, false)
    ? resumeRunAtDirectory(artifactDir, options)
    : reconcileRunAtDirectory(artifactDir, options);
  const verification = verifyRun(artifactDir);
  const report = reconciliation.report;
  const summary = {
    runId: report.runId,
    resumeFromPhase: report.resumeFromPhase,
    currentWave: report.currentWave,
    pendingExternalProbes: report.pendingExternalProbes.length,
    recommendations: report.recommendations.length,
    integrityValid: verification.valid,
  };
  const result = intelligenceResult("reconcile-run", summary, {
    pendingExternalProbes: report.pendingExternalProbes,
    recommendations: report.recommendations,
    git: report.git,
  });
  return {
    result,
    stateSummary: reconciliation.summary,
    persistence: persistIntelligenceEvidence(result, {
      artifactDir,
      projectRoot: root,
    }),
  };
}

executeJsonCli(main);
