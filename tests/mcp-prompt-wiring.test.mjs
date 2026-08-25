import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Guarda de sincronia entre `references/mcp-context.md` e
 * `references/subagent-prompts.md`.
 *
 * `mcp-context.md` promete que o bloco de instrucao do Codebase Memory MCP
 * (CBM_MCP) fica "encaixado na secao de contexto do template" de
 * `subagent-prompts.md`. Esse teste verifica que a promessa e verdadeira: todo
 * placeholder `Context7 MCP:` do template tem um `Codebase Memory MCP:`
 * correspondente, e que a regra de uso condicional ao preflight tambem existe
 * em "Regras comuns". Sem esse guard, o placeholder pode ser removido em uma
 * edicao futura sem que nenhum teste acuse a divergencia com a documentacao.
 */

const REPO_ROOT = join(import.meta.dirname, "..");
const PROMPTS_PATH = join(
  REPO_ROOT,
  "skills",
  "orchestrator-multi-agent-development",
  "references",
  "subagent-prompts.md",
);
const MCP_CONTEXT_PATH = join(
  REPO_ROOT,
  "skills",
  "orchestrator-multi-agent-development",
  "references",
  "mcp-context.md",
);

function countPlaceholder(content, label) {
  const pattern = new RegExp(`^${label}:\\r?\\n<MANTER SOMENTE SE DISPONIVEL>`, "gm");
  return (content.match(pattern) ?? []).length;
}

test("Regras comuns instrui uso do Codebase Memory condicionado ao sinal por agente, com fallback ao agregado", () => {
  const content = readFileSync(PROMPTS_PATH, "utf8");
  assert.match(
    content,
    /checks\.optional\.mcpPerAgent/,
    "Regras comuns deveria preferir o sinal ao vivo por agente (mcpPerAgent) ao agregado de arquivo",
  );
  assert.match(
    content,
    /checks\.optional\.mcp\.<servidor>\.ok|checks\.optional\.mcp\["codebase-memory"\]\.ok/,
    "Regras comuns deveria manter o fallback para o check agregado quando mcpPerAgent nao estiver disponivel",
  );
});

test("todo placeholder Context7 MCP: tem um Codebase Memory MCP: correspondente no template", () => {
  const content = readFileSync(PROMPTS_PATH, "utf8");
  const context7Count = countPlaceholder(content, "Context7 MCP");
  const codebaseMemoryCount = countPlaceholder(content, "Codebase Memory MCP");

  assert.ok(context7Count > 0, "template deveria ter ao menos um placeholder Context7 MCP:");
  assert.equal(
    codebaseMemoryCount,
    context7Count,
    `Codebase Memory MCP: deveria aparecer ${context7Count}x (uma por placeholder Context7 MCP:), encontrado ${codebaseMemoryCount}x`,
  );
});

test("mcp-context.md continua afirmando que o bloco esta no template de subagent-prompts.md", () => {
  const mcpContext = readFileSync(MCP_CONTEXT_PATH, "utf8");
  assert.match(
    mcpContext,
    /subagent-prompts\.md/,
    "mcp-context.md deveria continuar referenciando subagent-prompts.md como o local do bloco de contexto do grafo",
  );
});

/**
 * `subagent-prompts.md` manda preferir `checks.optional.mcpPerAgent` (sinal ao
 * vivo por agente), mas esse bloco so existe no relatorio quando o preflight
 * roda com `--check-agent-mcp` (opt-in, custo real de subprocesso). Se o
 * caminho padrao do preflight (SKILL.md Fase 0.1, workflow.md Fase 0) nao
 * passar a flag, a regra das "Regras comuns" e inalcancavel na run normal e o
 * roteamento sempre cai no agregado fraco que `mcp-context.md` avisa nao
 * distinguir CLI.
 */
test("preflight e invocado com --check-agent-mcp no caminho padrao (SKILL.md e workflow.md)", () => {
  const skillPath = join(
    REPO_ROOT,
    "skills",
    "orchestrator-multi-agent-development",
    "SKILL.md",
  );
  const workflowPath = join(
    REPO_ROOT,
    "skills",
    "orchestrator-multi-agent-development",
    "references",
    "workflow.md",
  );

  for (const path of [skillPath, workflowPath]) {
    const content = readFileSync(path, "utf8");
    assert.match(
      content,
      /preflight\.mjs["'`]?\s+--check-agent-mcp/,
      `${path} deveria invocar preflight.mjs com --check-agent-mcp no caminho padrao da Fase 0`,
    );
  }
});
