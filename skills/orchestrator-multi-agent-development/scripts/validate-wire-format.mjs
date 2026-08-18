#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { executeJsonCli, numberArg, parseArgs, required } from "./lib/cli-utils.mjs";
import {
  findJsonCodeBlocks,
  flattenJsonShape,
  intelligenceResult,
  jsonType,
  persistIntelligenceEvidence,
  resolveInside,
} from "./lib/intelligence.mjs";

function validateSchema(value, schema, path = "$") {
  const issues = [];
  if (!schema || typeof schema !== "object") return issues;
  if (schema.enum && !schema.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) {
    issues.push({ path, code: "ENUM_MISMATCH", expected: schema.enum, actual: value });
  }
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = jsonType(value);
    const normalizedActual = actual === "number" && Number.isInteger(value) ? ["integer", "number"] : [actual];
    if (!allowed.some((type) => normalizedActual.includes(type))) {
      issues.push({ path, code: "TYPE_MISMATCH", expected: allowed, actual });
      return issues;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) issues.push({ path: `${path}.${key}`, code: "REQUIRED_MISSING" });
    }
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties?.[key]) {
        issues.push(...validateSchema(child, schema.properties[key], `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        issues.push({ path: `${path}.${key}`, code: "ADDITIONAL_PROPERTY" });
      }
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => issues.push(...validateSchema(item, schema.items, `${path}[${index}]`)));
  }
  return issues;
}

function compareExample(payload, example) {
  const payloadShape = flattenJsonShape(payload);
  const exampleShape = flattenJsonShape(example);
  const payloadMap = new Map(payloadShape.map((item) => [item.path, item.type]));
  const exampleMap = new Map(exampleShape.map((item) => [item.path, item.type]));
  const issues = [];
  for (const [path, expected] of exampleMap) {
    if (!payloadMap.has(path)) issues.push({ path, code: "FIELD_MISSING", expected });
    else if (payloadMap.get(path) !== expected) {
      issues.push({ path, code: "TYPE_MISMATCH", expected, actual: payloadMap.get(path) });
    }
  }
  for (const [path, actual] of payloadMap) {
    if (!exampleMap.has(path)) issues.push({ path, code: "UNEXPECTED_FIELD", actual });
  }
  return issues;
}

function main(argv) {
  const args = parseArgs(argv);
  const root = resolve(args.root ?? process.cwd());
  const payloadPath = resolveInside(root, required(args, "payload")).absolute;
  const payload = JSON.parse(readFileSync(payloadPath, "utf8"));
  let mode;
  let reference;
  let issues;
  if (args.schema) {
    mode = "json-schema";
    reference = resolveInside(root, args.schema).absolute;
    const schema = JSON.parse(readFileSync(reference, "utf8"));
    issues = validateSchema(payload, schema);
  } else {
    mode = "contract-example";
    reference = resolveInside(root, required(args, "contract")).absolute;
    const blocks = findJsonCodeBlocks(readFileSync(reference, "utf8"));
    const blockIndex = numberArg(args["contract-block"], 0);
    const block = blocks[blockIndex];
    if (!block) {
      const error = new Error(`Contract JSON block ${blockIndex} was not found`);
      error.code = "CONTRACT_BLOCK_NOT_FOUND";
      throw error;
    }
    if (!block.valid) {
      const error = new Error(`Contract JSON block ${blockIndex} is invalid: ${block.error}`);
      error.code = "INVALID_CONTRACT_EXAMPLE";
      throw error;
    }
    issues = compareExample(payload, block.value);
  }
  const summary = {
    mode,
    payload: payloadPath,
    reference,
    valid: issues.length === 0,
    issueCount: issues.length,
  };
  const result = intelligenceResult("validate-wire-format", summary, { issues });
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
