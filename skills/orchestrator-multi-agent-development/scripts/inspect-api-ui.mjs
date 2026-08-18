#!/usr/bin/env node

import { resolve } from "node:path";

import { executeJsonCli, parseArgs, required } from "./lib/cli-utils.mjs";
import {
  collectInputFiles,
  intelligenceResult,
  lowerCamel,
  persistIntelligenceEvidence,
  readTextBounded,
} from "./lib/intelligence.mjs";

function normalizedTypeName(value) {
  return String(value)
    .replace(/(?:Dto|Request|Response|Model|ViewModel|Vm|Contract)$/i, "")
    .toLowerCase();
}

function extractCSharp(files) {
  const types = [];
  for (const file of files) {
    const content = readTextBounded(file.absolute);
    const declarations = [...content.matchAll(/\b(?:class|record(?:\s+class)?)\s+([A-Za-z_][A-Za-z0-9_]*)[^\{]*\{/g)];
    for (let index = 0; index < declarations.length; index += 1) {
      const declaration = declarations[index];
      const start = declaration.index + declaration[0].length;
      const end = declarations[index + 1]?.index ?? content.length;
      const body = content.slice(start, end);
      const fields = [];
      const propertyPattern = /(?:\[JsonPropertyName\("([^"]+)"\)\]\s*)?(?:\[[^\]]+\]\s*)*public\s+[A-Za-z0-9_<>,.?\[\]\s]+\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{\s*get\s*;/g;
      for (const match of body.matchAll(propertyPattern)) {
        fields.push({
          sourceName: match[2],
          wireName: match[1] ?? lowerCamel(match[2]),
          explicitWireName: match[1] != null,
        });
      }
      if (fields.length > 0) {
        types.push({
          name: declaration[1],
          normalizedName: normalizedTypeName(declaration[1]),
          path: file.relative,
          fields,
        });
      }
    }
  }
  return types;
}

function extractTypeScript(files) {
  const types = [];
  for (const file of files) {
    const content = readTextBounded(file.absolute);
    const pattern = /\b(?:export\s+)?(?:interface|type)\s+([A-Za-z_][A-Za-z0-9_]*)[^=\{]*(?:=\s*)?\{([\s\S]*?)\}/g;
    for (const match of content.matchAll(pattern)) {
      const fields = [];
      for (const field of match[2].matchAll(/^\s*(?:readonly\s+)?(?:["']([^"']+)["']|([A-Za-z_$][A-Za-z0-9_$]*))\??\s*:/gm)) {
        fields.push({ name: field[1] ?? field[2] });
      }
      if (fields.length > 0) {
        types.push({
          name: match[1],
          normalizedName: normalizedTypeName(match[1]),
          path: file.relative,
          fields,
        });
      }
    }
  }
  return types;
}

function comparePair(backend, frontend) {
  const backendNames = new Map(backend.fields.map((field) => [field.wireName, field]));
  const frontendNames = new Set(frontend.fields.map((field) => field.name));
  const missingInFrontend = [...backendNames.keys()].filter((name) => !frontendNames.has(name));
  const missingInBackend = [...frontendNames].filter((name) => !backendNames.has(name));
  const casingMismatches = [];
  for (const backendName of missingInFrontend) {
    const frontendName = missingInBackend.find((name) => name.toLowerCase() === backendName.toLowerCase());
    if (frontendName) casingMismatches.push({ backend: backendName, frontend: frontendName });
  }
  const casingBackend = new Set(casingMismatches.map((item) => item.backend));
  const casingFrontend = new Set(casingMismatches.map((item) => item.frontend));
  return {
    backendType: backend.name,
    backendPath: backend.path,
    frontendType: frontend.name,
    frontendPath: frontend.path,
    backendFieldCount: backend.fields.length,
    frontendFieldCount: frontend.fields.length,
    missingInFrontend: missingInFrontend.filter((name) => !casingBackend.has(name)),
    missingInBackend: missingInBackend.filter((name) => !casingFrontend.has(name)),
    casingMismatches,
  };
}

function main(argv) {
  const args = parseArgs(argv);
  const root = resolve(args.root ?? process.cwd());
  const backendFiles = collectInputFiles(root, required(args, "backend"), { extensions: [".cs"] });
  const frontendFiles = collectInputFiles(root, required(args, "frontend"), { extensions: [".ts", ".tsx"] });
  const backendTypes = extractCSharp(backendFiles);
  const frontendTypes = extractTypeScript(frontendFiles);
  const comparisons = [];
  const unmatchedBackendTypes = [];
  for (const backend of backendTypes) {
    const matches = frontendTypes.filter((frontend) =>
      frontend.normalizedName === backend.normalizedName,
    );
    if (matches.length === 0) {
      unmatchedBackendTypes.push({ name: backend.name, path: backend.path });
      continue;
    }
    for (const frontend of matches) comparisons.push(comparePair(backend, frontend));
  }
  const mismatches = comparisons.filter((comparison) =>
    comparison.missingInFrontend.length > 0 ||
    comparison.missingInBackend.length > 0 ||
    comparison.casingMismatches.length > 0,
  );
  const summary = {
    backendFiles: backendFiles.length,
    frontendFiles: frontendFiles.length,
    backendTypes: backendTypes.length,
    frontendTypes: frontendTypes.length,
    contractsChecked: comparisons.length,
    matched: comparisons.length - mismatches.length,
    mismatches: mismatches.length,
    casingMismatches: mismatches.reduce((count, item) => count + item.casingMismatches.length, 0),
    unmatchedBackendTypes: unmatchedBackendTypes.length,
  };
  const result = intelligenceResult("inspect-api-ui", summary, {
    mismatches,
    unmatchedBackendTypes,
    matchedPairs: comparisons
      .filter((comparison) => !mismatches.includes(comparison))
      .map((comparison) => ({
        backendType: comparison.backendType,
        frontendType: comparison.frontendType,
      })),
  });
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
