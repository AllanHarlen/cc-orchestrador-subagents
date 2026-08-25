import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Guarda de sincronia: `run/prompts/` era um diretorio de layout ja declarado
 * em `scripts/lib/artifact-layout.mjs` mas nunca preenchido por nenhum script
 * ou instrucao — nada escrevia nele, nenhum doc o mencionava. Estes testes
 * garantem que a promessa de persistir o prompt efetivo como artefato da run
 * (references/workflow.md) e as colunas de proveniencia do prompt
 * (assets/subagents-context-template.md) continuam presentes.
 */

const REPO_ROOT = join(import.meta.dirname, "..");
const WORKFLOW_PATH = join(
  REPO_ROOT,
  "skills",
  "orchestrator-multi-agent-development",
  "references",
  "workflow.md",
);
const TEMPLATE_PATH = join(
  REPO_ROOT,
  "skills",
  "orchestrator-multi-agent-development",
  "assets",
  "subagents-context-template.md",
);

test("workflow.md instrui persistir o prompt efetivo em run/prompts/ antes do dispatch", () => {
  const content = readFileSync(WORKFLOW_PATH, "utf8");
  assert.match(content, /run\/prompts\/<taskId>\.md/);
  assert.match(content, /run\/prompts\/<taskId>-review\.md/);
  assert.match(content, /--dump-prompt/);
  assert.match(
    content,
    /check-prompt-budget\.mjs/,
    "workflow.md deveria medir o prompt persistido com check-prompt-budget.mjs, nao contar manualmente",
  );
});

test("subagents-context-template.md registra proveniencia e degradacao do prompt enviado", () => {
  const content = readFileSync(TEMPLATE_PATH, "utf8");
  assert.match(content, /\*\*Prompt enviado:\*\*/);
  assert.match(content, /\*\*Contexto degradado:\*\*/);
  assert.match(content, /\*\*Arquivos descartados pelo corte:\*\*/);
});
