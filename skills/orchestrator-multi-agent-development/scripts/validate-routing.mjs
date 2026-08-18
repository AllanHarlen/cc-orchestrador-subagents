#!/usr/bin/env node
/**
 * Validate generated orchestrator routing artifacts.
 *
 * Usage:
 *   node "${CLAUDE_SKILL_DIR}/scripts/validate-routing.mjs" .orchestration/<name>
 *   node scripts/validate-routing.mjs .orchestration/<name>
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
];

// Mesma gramatica de ID do State Engine (scripts/lib/orchestration-state.mjs, TASK_ID_SOURCE).
// Aceita T1, T12-A, BE-01, FE-001-B. Os dois parsers precisam concordar sobre o que e uma
// task: um ID valido para o State Engine que este validador nao reconhecesse tornaria o gate
// de roteamento inalcancavel para a classificacao inteira.
// O lookahead descarta versao (`gemini-3.5`): sem ele, o nome de modelo AGY que aparece em
// toda linha de roteamento seria lido como task e poderia virar o ID do bloco numa tabela.
const TASK_ID_SOURCE = "(?:[A-Z]{1,8}-\\d{1,4}(?!\\.\\d)(?:-[A-Z0-9]+)?|T\\d+(?:-[A-Z0-9]+)?)";
const TASK_RE = new RegExp(`\\b${TASK_ID_SOURCE}\\b`, "gi");
const FRONTEND_AGENT_RE = /\b(cc-antigravity-plugin:antigravity-coder|antigravity|agy)\b/i;
// antigravity-agent e o subagente somente-leitura do plugin AGY (analise/review). Ele nunca
// pode receber task de implementacao; quem cria e edita arquivo e o antigravity-coder.
const READ_ONLY_AGY_AGENT_RE = /\b(?:cc-antigravity-plugin:)?antigravity-agent\b/i;
const CODEX_AGENT_RE = /\b(codex:codex-rescue|codex)\b/i;
const CODEX_MEDIUM_RE = /--effort\s+medium/i;
const CODEX_HIGH_RE = /--effort\s+high/i;
const AGY_MODEL_RE = /(?:^|[\s|,])(?:agyModel(?!Source)|--agy-model|--model)\b\s*[:=]?\s*`?([a-z0-9.-]+(?:-[a-z0-9.-]+)*)`?/im;
const AGY_MODEL_SOURCE_RE = /agyModelSource\s*[:=]?\s*`?(user|heuristic|adaptive)`?/i;
const AGY_ADAPTIVE_SOURCE_RE = /agyModelSource\s*[:=]?\s*`?adaptive`?/i;
const AGY_ADAPTIVE_EVIDENCE_RE = /agyModelEvidence\s*[:=]?\s*`?[^`\n]+`?/i;
const AGY_SUBAGENT_MODEL_RE = /agySubagentModel\s*[:=]?\s*`?([a-z0-9.-]+(?:-[a-z0-9.-]+)*)`?/im;
const ALLOWED_AGY_MODELS = new Set([
  "gemini-3.5-flash-low",
  "gemini-3.5-flash-medium",
  "gemini-3.5-flash-high",
  "gemini-3.1-pro-low",
  "gemini-3.1-pro-high",
  "claude-4.6-sonnet-thinking",
  "claude-4.6-opus-thinking",
  "gpt-oss-120b-medium",
  "auto",
]);

// Escada de capacidade (SKILL.md): flash-low < flash-medium < flash-high < pro-low < pro-high.
// Tasks que implementam um design system (Open Design) exigem julgamento visual e nunca
// podem usar os dois tiers mais baixos da escada Gemini — ver regra "Roteamento por
// fidelidade de design" no SKILL.md. Modelos fora da escada Gemini (claude-*, gpt-oss,
// auto) nao tem tier conhecido aqui; nao sao bloqueados por esta regra especifica.
const LOW_TIER_AGY_MODELS = new Set(["gemini-3.5-flash-low", "gemini-3.5-flash-medium"]);
const DESIGN_SYSTEM_SIGNAL_RE = /\b(tokens\.css|components\.html|design-systems?\/|DESIGN\.md|design[- ]system)\b/i;

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

  // Strip UTF-8 BOM if present (common on Windows editors)
  const content = readFileSync(file, "utf8");
  return content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;
}

function uniqueTaskIds(text) {
  return [...new Set([...text.matchAll(TASK_RE)].map((match) => match[0].toUpperCase()))];
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

function extractAgyModel(text) {
  const match = text.match(AGY_MODEL_RE);
  return match?.[1] ?? null;
}

function hasAgyModelSource(text) {
  return AGY_MODEL_SOURCE_RE.test(text);
}

function extractAgySubagentModel(text) {
  const match = text.match(AGY_SUBAGENT_MODEL_RE);
  return match?.[1] ?? null;
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

  // Uma entrada de wave costuma ser um item de lista ("- FE-01 -> agente"), formato que o
  // State Engine tambem aceita. O ID precisa abrir o item para que uma mencao no meio de uma
  // frase ("depende de FE-01") nao quebre o bloco em que ela aparece.
  const taskListItemRe = new RegExp(`^\\s*[-*+]\\s*\`?${TASK_ID_SOURCE}\\b`, "i");

  for (const line of lines) {
    const ids = uniqueTaskIds(line);
    const isTaskHeading = ids.length > 0 && /^#{2,6}\s+/.test(line);
    const isTaskTableRow = ids.length > 0 && /^\s*\|/.test(line);
    const isTaskIdLine = ids.length > 0 && /\bID\b/i.test(line);
    const isTaskListItem = ids.length > 0 && taskListItemRe.test(line);

    if (isTaskTableRow) {
      blocks.push({ ids: [ids[0]], text: line });
      continue;
    }

    if (isTaskHeading || isTaskIdLine || isTaskListItem) {
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

    if (["FRONTEND_ONLY", "FULLSTACK"].includes(taskCategory) && READ_ONLY_AGY_AGENT_RE.test(block.text)) {
      errors.push(`${source}: ${id} e ${taskCategory}, mas delega implementacao a cc-antigravity-plugin:antigravity-agent, que e somente leitura. Use cc-antigravity-plugin:antigravity-coder; antigravity-agent so e valido no review de front-end da Fase 9.`);
    }

    const agyModel = extractAgyModel(block.text);

    if (frontend && !agyModel) {
      errors.push(`${source}: ${id} aponta para AGY, mas nao registra agyModel/--agy-model/--model.`);
    }

    if (frontend && agyModel && !ALLOWED_AGY_MODELS.has(agyModel)) {
      errors.push(`${source}: ${id} usa agyModel invalido (${agyModel}). Use um modelo da allowlist.`);
    }

    if (frontend && agyModel && LOW_TIER_AGY_MODELS.has(agyModel) && DESIGN_SYSTEM_SIGNAL_RE.test(block.text)) {
      errors.push(`${source}: ${id} implementa design system (tokens.css/components.html/DESIGN.md) mas usa agyModel de tier baixo (${agyModel}). Fidelidade visual exige no minimo gemini-3.5-flash-high (ver "Roteamento por fidelidade de design" no SKILL.md).`);
    }

    const agySubagentModel = extractAgySubagentModel(block.text);
    if (agySubagentModel && agySubagentModel !== "inherit" && !ALLOWED_AGY_MODELS.has(agySubagentModel)) {
      errors.push(`${source}: ${id} usa agySubagentModel invalido (${agySubagentModel}). Use um modelo da allowlist ou "inherit".`);
    }

    if (frontend && !hasAgyModelSource(block.text)) {
      errors.push(`${source}: ${id} aponta para AGY, mas nao registra agyModelSource=user|heuristic|adaptive.`);
    }

    if (frontend && AGY_ADAPTIVE_SOURCE_RE.test(block.text) && !AGY_ADAPTIVE_EVIDENCE_RE.test(block.text)) {
      errors.push(`${source}: ${id} usa routing adaptativo, mas nao registra agyModelEvidence auditavel.`);
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
      if (frontend && !agyModel) {
        errors.push(`${source}: ${id} e FULLSTACK, mas a fatia front-end nao registra agyModel.`);
      }
    }

    if (["BACKEND_ONLY", "DATABASE_ONLY"].includes(taskCategory)) {
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
  errors.push(`${classificationFile}: nenhum bloco de task encontrado (IDs aceitos: T1, T12-A, BE-01, FE-001-B).`);
}

if (waveBlocks.length === 0) {
  errors.push(`${wavesFile}: nenhum bloco de task encontrado (IDs aceitos: T1, T12-A, BE-01, FE-001-B).`);
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
