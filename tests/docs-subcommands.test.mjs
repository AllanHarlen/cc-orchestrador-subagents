import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Teste de documentacao dos subcomandos reservados (Task 12.7).
 *
 * `project-config` precisa aparecer como subcomando reservado em
 * `commands/orchestrator.md` (o comando canonico) e ser preservado no alias
 * em portugues `commands/orquestrador.md`, ao lado de `preflight`, `status`,
 * `resume`, `knowledge`, `telemetry`, `help` e `config`.
 *
 * Nao testa prosa: testa que o nome do subcomando esta presente nos pontos
 * de contrato do arquivo (argument-hint e lista de subcomandos reservados).
 * O alias delega lendo o canonico, entao nao duplica a lista de flags — so o
 * argument-hint precisa espelhar os subcomandos.
 */

const REPO_ROOT = join(import.meta.dirname, "..");
const CANONICAL_PATH = join(REPO_ROOT, "commands", "orchestrator.md");
const ALIAS_PATH = join(REPO_ROOT, "commands", "orquestrador.md");

function frontmatter(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  assert.ok(match, "arquivo de comando deveria ter frontmatter YAML");
  return match[1];
}

test("project-config aparece no argument-hint do comando canonico", () => {
  const content = readFileSync(CANONICAL_PATH, "utf8");
  const fm = frontmatter(content);
  assert.match(fm, /argument-hint:.*\bproject-config\b/);
});

test("project-config esta listado entre os subcomandos reservados do comando canonico", () => {
  const content = readFileSync(CANONICAL_PATH, "utf8");
  const heading = /## Subcomandos reservados|Subcomandos reservados:/;
  assert.match(content, heading, "secao de subcomandos reservados nao encontrada");

  const otherReserved = [
    "help",
    "preflight",
    "status",
    "resume",
    "config",
    "brain-pensador",
    "knowledge status",
    "telemetry report",
  ];
  for (const reserved of otherReserved) {
    assert.match(
      content,
      new RegExp(`\`${reserved.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      `subcomando de referencia ausente: ${reserved}`,
    );
  }

  // Aceita tanto a lista em prosa (`project-config` — ...) quanto a linha de
  // tabela (| `project-config` | ... |) usada pela superficie reestruturada.
  assert.match(
    content,
    /`project-config`\s*[—|]/,
    "project-config deveria estar documentado na lista de subcomandos reservados",
  );
});

test("o alias em portugues preserva project-config no argument-hint", () => {
  const content = readFileSync(ALIAS_PATH, "utf8");
  const fm = frontmatter(content);
  assert.match(fm, /argument-hint:.*\bproject-config\b/);
});

test("o alias delega ao canonico sem duplicar a superficie", () => {
  const content = readFileSync(ALIAS_PATH, "utf8");
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, "");

  assert.match(
    body,
    /commands\/orchestrator\.md/,
    "o alias precisa apontar para o arquivo canonico",
  );
  assert.match(body, /\$ARGUMENTS/, "o alias precisa repassar $ARGUMENTS");

  // A enumeracao de flags no corpo do alias era a fonte de deriva entre os dois
  // arquivos a cada renomeacao de parametro: o corpo nao pode redeclarar flag.
  for (const flag of ["--model", "--parallel", "--subagent-model", "--agy-"]) {
    assert.ok(
      !body.includes(flag),
      `o corpo do alias nao deve enumerar flags (encontrado: ${flag})`,
    );
  }
});

test("todo subcomando reservado do canonico com argumento fixo tambem aparece no argument-hint do alias", () => {
  const canonical = frontmatter(readFileSync(CANONICAL_PATH, "utf8"));
  const alias = frontmatter(readFileSync(ALIAS_PATH, "utf8"));
  const tokens = [
    "help",
    "preflight",
    "project-config",
    "brain-pensador",
    "status",
    "resume",
    "knowledge",
    "telemetry",
  ];
  for (const token of tokens) {
    assert.ok(canonical.includes(token), `canonico sem ${token} no argument-hint`);
    assert.ok(alias.includes(token), `alias sem ${token} no argument-hint`);
  }
});

test("o canonico documenta as flags novas e os aliases legados", () => {
  const content = readFileSync(CANONICAL_PATH, "utf8");
  for (const flag of ["--model", "--parallel", "--subagent-model"]) {
    assert.ok(content.includes(flag), `flag nova ausente na documentacao: ${flag}`);
  }
  // Os nomes antigos continuam aceitos: precisam estar registrados como alias.
  for (const legacy of ["--agy-model", "--agy-parallel", "--agy-subagent-model"]) {
    assert.ok(content.includes(legacy), `alias legado nao documentado: ${legacy}`);
  }
});
