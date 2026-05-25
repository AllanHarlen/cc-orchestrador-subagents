#!/usr/bin/env node
/**
 * Validate generated orchestrator routing artifacts.
 *
 * Usage:
 *   node "${CLAUDE_SKILL_DIR}/scripts/validate-routing.mjs" openspec/changes/<change>
 *   node scripts/validate-routing.mjs openspec/changes/<change>
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const CATEGORIES = [
  "BACKEND_ONLY",
  "FRONTEND_ONLY",
  "FULLSTACK",
  "DATABASE_ONLY",
  "REVIEW_ONLY",
  "DOCS_ONLY",
  "TEST_ONLY",
];

const TASK_RE = /\bT\d+\b/g;
const FRONTEND_AGENT_RE = /\b(cc-antigravity-plugin:antigravity-agent|antigravity|agy)\b/i;
const CODEX_AGENT_RE = /\b(codex:codex-rescue|codex)\b/i;
const AGY_MODE_SELECTOR_RE = /(?:--model\b|\b[A-Z0-9_]*MODEL[A-Z0-9_]*\b|\bgemini-\S+)/i;
const CODEX_MEDIUM_RE = /--effort\s+medium/i;
const CODEX_HIGH_RE = /--effort\s+high/i;

const targetDir = resolve(process.argv[2] ?? process.cwd());
const requiredFiles = [
  join(targetDir, "tasks-classification.md"),
  join(targetDir, "waves.md"),
];

const errors = [];
const warnings = [];

function readRequired(file) {
  if (!existsSync(file)) {
    errors.push(`Arquivo obrigatorio ausente: ${file}`);
    return "";
  }

  return readFileSync(file, "utf8");
}

function uniqueMatches(text, regex) {
  return [...new Set([...text.matchAll(regex)].map((match) => match[0]))];
}

function findCategory(text) {
  return CATEGORIES.find((category) => new RegExp(`\\b${category}\\b`).test(text));
}

function hasFrontendAgent(text) {
  return FRONTEND_AGENT_RE.test(text);
}

function hasCodexAgent(text) {
  return CODEX_AGENT_RE.test(text) || CODEX_MEDIUM_RE.test(text) || CODEX_HIGH_RE.test(text);
}

function extractBlocks(content) {
  const lines = content.split(/\r?\n/);
  const blocks = [];
  let current = null;

  function pushCurrent() {
    if (current && current.lines.length > 0) {
      blocks.push({
        ids: [...current.ids],
        text: current.lines.join("\n"),
      });
    }
    current = null;
  }

  for (const line of lines) {
    const ids = uniqueMatches(line, TASK_RE);
    const isTaskHeading = ids.length > 0 && /^#{2,6}\s+/.test(line);
    const isTaskTableRow = ids.length > 0 && /^\s*\|/.test(line);
    const isTaskIdLine = ids.length > 0 && /\bID\b/i.test(line);

    if (isTaskTableRow) {
      blocks.push({ ids: [ids[0]], text: line });
      continue;
    }

    if (isTaskHeading || isTaskIdLine) {
      pushCurrent();
      current = { ids: new Set([ids[0]]), lines: [line] };
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  pushCurrent();
  return blocks;
}

function validateBlock(source, block, categoryByTask) {
  const category = findCategory(block.text);
  const ids = block.ids.length > 0 ? block.ids : ["<sem task id>"];

  for (const id of ids) {
    const taskCategory = category ?? categoryByTask.get(id);

    if (!taskCategory) {
      errors.push(`${source}: ${id} sem categoria conhecida. Registre a task em tasks-classification.md.`);
      continue;
    }

    const frontend = hasFrontendAgent(block.text);
    const codex = hasCodexAgent(block.text);

    if (frontend && AGY_MODE_SELECTOR_RE.test(block.text)) {
      errors.push(`${source}: ${id} aponta para AGY, mas tenta especificar modelo ou modo. Remova seletores de modelo/modo.`);
    }

    if (taskCategory === "FRONTEND_ONLY") {
      if (!frontend) {
        errors.push(`${source}: ${id} e FRONTEND_ONLY, mas nao aponta para Antigravity/AGY.`);
      }
      if (codex) {
        errors.push(`${source}: ${id} e FRONTEND_ONLY, mas aponta para Codex como agente primario.`);
      }
    }

    if (taskCategory === "FULLSTACK") {
      if (!frontend || !codex) {
        errors.push(`${source}: ${id} e FULLSTACK, mas nao declara Codex + Antigravity/AGY.`);
      }
    }

    if (["BACKEND_ONLY", "DATABASE_ONLY", "TEST_ONLY"].includes(taskCategory)) {
      if (!codex) {
        errors.push(`${source}: ${id} e ${taskCategory}, mas nao aponta para Codex.`);
      }
      if (frontend) {
        warnings.push(`${source}: ${id} e ${taskCategory}, mas tambem menciona AGY. Confirme se nao houve mistura de escopo.`);
      }
    }

    if (taskCategory === "REVIEW_ONLY") {
      if (!codex || !CODEX_HIGH_RE.test(block.text)) {
        errors.push(`${source}: ${id} e REVIEW_ONLY, mas nao aponta para Codex com --effort high.`);
      }
    }
  }
}

const [classificationFile, wavesFile] = requiredFiles;
const classification = readRequired(classificationFile);
const waves = readRequired(wavesFile);
const classificationBlocks = extractBlocks(classification);
const waveBlocks = extractBlocks(waves);
const categoryByTask = new Map();

for (const block of classificationBlocks) {
  const category = findCategory(block.text);
  if (!category) continue;
  for (const id of block.ids) categoryByTask.set(id, category);
}

if (classificationBlocks.length === 0) {
  errors.push(`${classificationFile}: nenhum bloco de task T<N> encontrado.`);
}

if (waveBlocks.length === 0) {
  errors.push(`${wavesFile}: nenhum bloco de task T<N> encontrado.`);
}

for (const block of classificationBlocks) {
  validateBlock(basename(classificationFile), block, categoryByTask);
}

for (const block of waveBlocks) {
  validateBlock(basename(wavesFile), block, categoryByTask);
}

if (errors.length > 0) {
  console.error("Routing validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  if (warnings.length > 0) {
    console.error("\nWarnings:");
    for (const warning of warnings) console.error(`- ${warning}`);
  }
  process.exit(1);
}

if (warnings.length > 0) {
  console.warn("Routing validation warnings:");
  for (const warning of warnings) console.warn(`- ${warning}`);
}

console.log(`Routing validation passed for ${categoryByTask.size} task(s) in ${targetDir}.`);
