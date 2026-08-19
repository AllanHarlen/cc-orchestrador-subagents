import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Teste de documentacao dos subcomandos reservados (Task 12.7).
 *
 * `project-config` precisa aparecer como subcomando reservado em
 * `commands/orchestrator.md` (o comando canonico) e ser preservado no alias
 * em portugues `commands/orchestrador.md`, ao lado de `preflight`, `resume`,
 * `knowledge` e `telemetry`.
 *
 * Nao testa prosa: testa que o nome do subcomando esta presente nos pontos
 * de contrato do arquivo (argument-hint, lista de subcomandos reservados e,
 * no alias, a lista de argumentos preservados).
 */

const REPO_ROOT = join(import.meta.dirname, "..");
const CANONICAL_PATH = join(REPO_ROOT, "commands", "orchestrator.md");
const ALIAS_PATH = join(REPO_ROOT, "commands", "orchestrador.md");

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

  const otherReserved = ["preflight", "resume", "knowledge status", "telemetry report"];
  for (const reserved of otherReserved) {
    assert.match(
      content,
      new RegExp(`\`${reserved.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      `subcomando de referencia ausente: ${reserved}`,
    );
  }

  assert.match(
    content,
    /`project-config`\s*—/,
    "project-config deveria estar documentado na lista de subcomandos reservados",
  );
});

test("o alias em portugues preserva project-config no argument-hint e na delegacao", () => {
  const content = readFileSync(ALIAS_PATH, "utf8");
  const fm = frontmatter(content);
  assert.match(fm, /argument-hint:.*\bproject-config\b/);

  // O alias delega lendo o arquivo canonico em vez de duplicar o workflow;
  // a frase que preserva os argumentos precisa nomear project-config.
  assert.match(content, /\bproject-config\b/);
});

test("todo subcomando reservado do canonico com argumento fixo tambem aparece no argument-hint do alias", () => {
  const canonical = frontmatter(readFileSync(CANONICAL_PATH, "utf8"));
  const alias = frontmatter(readFileSync(ALIAS_PATH, "utf8"));
  for (const token of ["preflight", "project-config", "resume", "knowledge", "telemetry"]) {
    assert.ok(canonical.includes(token), `canonico sem ${token} no argument-hint`);
    assert.ok(alias.includes(token), `alias sem ${token} no argument-hint`);
  }
});
