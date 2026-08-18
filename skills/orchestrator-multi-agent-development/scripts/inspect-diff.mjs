#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { boolArg, executeJsonCli, parseArgs } from "./lib/cli-utils.mjs";
import { intelligenceResult, persistIntelligenceEvidence } from "./lib/intelligence.mjs";

function git(root, args, allowFailure = false) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 20_000,
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
  } catch (error) {
    if (allowFailure) return "";
    const wrapped = new Error(error.stderr?.trim() || error.message);
    wrapped.code = "GIT_DIFF_FAILED";
    throw wrapped;
  }
}

function riskFor(path, patch) {
  const risks = [];
  if (/(?:^|\/)(?:migrations?|schema)(?:\/|$)/i.test(path)) risks.push("DATABASE_MIGRATION");
  if (/(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|packages\.lock\.json)$/i.test(path)) risks.push("DEPENDENCY_LOCK");
  if (/(?:auth|permission|policy|cors|tenant)/i.test(path)) risks.push("SECURITY_OR_TENANCY");
  if (/(?:controller|route|endpoint|dto|contract|openapi|swagger)/i.test(path)) risks.push("PUBLIC_API");
  if (/\.(?:env|pem|pfx|key)$/i.test(path)) risks.push("SENSITIVE_FILE");
  if (/^\+.*(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{8,}/im.test(patch)) {
    risks.push("POSSIBLE_SECRET");
  }
  if (/^\+.*(?:TODO|FIXME|HACK)\b/im.test(patch)) risks.push("NEW_TODO");
  if (/^\+.*(?:console\.log|debugger;|print\()/im.test(patch)) risks.push("DEBUG_ARTIFACT");
  return [...new Set(risks)];
}

function main(argv) {
  const args = parseArgs(argv);
  const root = resolve(args.root ?? process.cwd());
  const baseArgs = ["diff"];
  if (boolArg(args.cached, false)) baseArgs.push("--cached");
  if (args.base) baseArgs.push(args.base);
  const names = git(root, [...baseArgs, "--name-only"], true).split(/\r?\n/).filter(Boolean);
  const numstatText = git(root, [...baseArgs, "--numstat"], true);
  const stats = new Map();
  for (const line of numstatText.split(/\r?\n/).filter(Boolean)) {
    const [added, deleted, ...pathParts] = line.split("\t");
    stats.set(pathParts.join("\t"), {
      added: added === "-" ? null : Number(added),
      deleted: deleted === "-" ? null : Number(deleted),
    });
  }
  const files = names.map((path) => {
    const patch = git(root, [...baseArgs, "--", path], true);
    return { path, ...(stats.get(path) ?? { added: 0, deleted: 0 }), risks: riskFor(path, patch) };
  });
  const riskCounts = {};
  for (const risk of files.flatMap((file) => file.risks)) riskCounts[risk] = (riskCounts[risk] ?? 0) + 1;
  const summary = {
    filesChanged: files.length,
    insertions: files.reduce((sum, file) => sum + (file.added ?? 0), 0),
    deletions: files.reduce((sum, file) => sum + (file.deleted ?? 0), 0),
    binaryFiles: files.filter((file) => file.added == null).length,
    riskyFiles: files.filter((file) => file.risks.length > 0).length,
    riskCounts,
  };
  const result = intelligenceResult("inspect-diff", summary, { files });
  return {
    result,
    persistence: persistIntelligenceEvidence(result, {
      artifactDir: args.dir,
      taskId: args.task,
      projectRoot: root,
    }),
  };
}

executeJsonCli(main);
