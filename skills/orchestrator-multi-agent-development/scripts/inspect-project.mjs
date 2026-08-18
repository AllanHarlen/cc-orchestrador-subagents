#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { addValidatedFact, renderProjectMemory } from "./lib/project-knowledge.mjs";
import { boolArg, executeJsonCli, numberArg, parseArgs } from "./lib/cli-utils.mjs";
import {
  intelligenceResult,
  persistIntelligenceEvidence,
  readTextBounded,
  walkFiles,
} from "./lib/intelligence.mjs";

const PACKAGE_FRAMEWORKS = new Map([
  ["react", "React"],
  ["next", "Next.js"],
  ["vue", "Vue"],
  ["@angular/core", "Angular"],
  ["svelte", "Svelte"],
  ["antd", "Ant Design"],
  ["@reduxjs/toolkit", "Redux Toolkit"],
  ["@playwright/test", "Playwright"],
  ["vite", "Vite"],
  ["typescript", "TypeScript"],
]);

function packageObservation(file) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file.absolute, "utf8"));
  } catch (error) {
    return { path: file.relative, valid: false, error: error.message };
  }
  const dependencies = {
    ...(parsed.dependencies ?? {}),
    ...(parsed.devDependencies ?? {}),
    ...(parsed.peerDependencies ?? {}),
  };
  const frameworks = [...PACKAGE_FRAMEWORKS]
    .filter(([name]) => dependencies[name] != null)
    .map(([name, displayName]) => ({ name: displayName, package: name, version: dependencies[name] }));
  const validation = Object.entries(parsed.scripts ?? {})
    .filter(([name]) => /^(?:build|test|test:.*|e2e|lint|typecheck|check)$/i.test(name))
    .map(([name, command]) => ({ name, command: `npm run ${name}`, script: command }));
  return {
    path: file.relative,
    valid: true,
    packageManager: parsed.packageManager ?? null,
    moduleType: parsed.type ?? null,
    engines: parsed.engines ?? {},
    frameworks,
    validation,
  };
}

function csprojObservation(file) {
  const content = readTextBounded(file.absolute);
  const targetFrameworks = [...content.matchAll(/<TargetFrameworks?>([^<]+)<\/TargetFrameworks?>/gi)]
    .flatMap((match) => match[1].split(";"))
    .map((value) => value.trim())
    .filter(Boolean);
  const packages = [...content.matchAll(/<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?/gi)]
    .map((match) => ({ name: match[1], version: match[2] ?? null }));
  const sdk = content.match(/<Project\s+Sdk="([^"]+)"/i)?.[1] ?? null;
  return { path: file.relative, sdk, targetFrameworks, packages };
}

function otherManifestObservation(file) {
  return { path: file.relative, type: basename(file.relative).toLowerCase() };
}

function recordFacts(root, observations) {
  const recorded = [];
  const errors = [];
  const record = (input) => {
    try {
      recorded.push(addValidatedFact(root, input));
    } catch (error) {
      errors.push({ code: error.code ?? "FACT_RECORD_FAILED", message: error.message, input });
    }
  };
  for (const packageFile of observations.packageFiles.filter((item) => item.valid)) {
    for (const framework of packageFile.frameworks) {
      record({
        section: "Frontend",
        key: framework.name,
        value: framework.version,
        sourceType: "FILE",
        sourceRef: packageFile.path,
      });
    }
    for (const validation of packageFile.validation) {
      record({
        section: "Validation",
        key: `${packageFile.path}:${validation.name}`,
        value: validation.command,
        sourceType: "FILE",
        sourceRef: packageFile.path,
      });
    }
  }
  for (const project of observations.dotnetProjects) {
    for (const framework of project.targetFrameworks) {
      record({
        section: "Architecture",
        key: `${project.path}:TargetFramework`,
        value: framework,
        sourceType: "FILE",
        sourceRef: project.path,
      });
    }
    for (const dependency of project.packages.filter((item) =>
      /EntityFrameworkCore|Npgsql|AspNetCore/i.test(item.name),
    )) {
      record({
        section: "Architecture",
        key: dependency.name,
        value: dependency.version ?? "declared",
        sourceType: "FILE",
        sourceRef: project.path,
      });
    }
  }
  return { recorded, errors, memory: renderProjectMemory(root) };
}

function main(argv) {
  const args = parseArgs(argv);
  const root = resolve(args.root ?? process.cwd());
  const files = walkFiles(root, {
    maxFiles: numberArg(args["max-files"], 20_000),
    names: ["package.json", "pyproject.toml", "cargo.toml", "go.mod", "pom.xml", "composer.json"],
  });
  const csprojFiles = walkFiles(root, {
    maxFiles: numberArg(args["max-files"], 20_000),
    extensions: [".csproj"],
  });
  const packageFiles = files.filter((file) => basename(file.relative).toLowerCase() === "package.json")
    .map(packageObservation);
  const observations = {
    packageFiles,
    dotnetProjects: csprojFiles.map(csprojObservation),
    otherManifests: files
      .filter((file) => basename(file.relative).toLowerCase() !== "package.json")
      .map(otherManifestObservation),
  };
  const summary = {
    manifestsChecked: files.length + csprojFiles.length,
    packageFiles: packageFiles.length,
    dotnetProjects: observations.dotnetProjects.length,
    frameworks: [...new Set(packageFiles.flatMap((item) => item.frameworks?.map((entry) => entry.name) ?? []))],
    validationCommands: packageFiles.reduce((count, item) => count + (item.validation?.length ?? 0), 0),
    invalidManifests: packageFiles.filter((item) => !item.valid).length,
  };
  const result = intelligenceResult("inspect-project", summary, observations);
  const persistence = persistIntelligenceEvidence(result, {
    artifactDir: args.dir,
    taskId: args.task,
    projectRoot: root,
  });
  const knowledge = boolArg(args["persist-knowledge"], false)
    ? recordFacts(root, observations)
    : null;
  return { result, persistence, knowledge };
}

executeJsonCli(main);
