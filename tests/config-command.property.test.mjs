import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import fc from "fast-check";

import { arbRoles } from "./helpers/project-config-arbitraries.mjs";

/**
 * Teste de propriedade do isolamento do Config_Command (Property 17 do design).
 *
 * Uma propriedade do design por teste, com o comentario de tag e no minimo 100
 * iteracoes. O sujeito e o **CLI real** (`project-config.mjs` chama
 * `executeJsonCli` e sai com codigo de processo), entao cada iteracao roda o
 * binario via `spawnSync`, como `tests/project-config.property.test.mjs` ja faz
 * para `preflight.mjs`.
 */

const NUM_RUNS = 100;

const CLI_SCRIPT = fileURLToPath(
  new URL(
    "../skills/orchestrator-multi-agent-development/scripts/project-config.mjs",
    import.meta.url,
  ),
);

const roots = [];

function temporaryProject() {
  const root = mkdtempSync(join(tmpdir(), "config-command-property-"));
  roots.push(root);
  return root;
}

test.afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

function runCli(root, args) {
  const run = spawnSync(process.execPath, [CLI_SCRIPT, ...args], { cwd: root, encoding: "utf8" });
  return { status: run.status };
}

/**
 * Snapshot recursivo do projeto: caminho relativo (barras normalizadas) mais
 * `mtimeMs` e tamanho de cada arquivo, para detectar tanto criacao quanto
 * modificacao de conteudo em um caminho ja existente.
 */
function snapshot(root) {
  if (!existsSync(root)) return {};
  const entries = readdirSync(root, { recursive: true });
  const files = {};
  for (const entry of entries) {
    const absolute = join(root, entry);
    const stat = statSync(absolute);
    if (!stat.isFile()) continue;
    const key = relative(root, absolute).split("\\").join("/");
    files[key] = { size: stat.size, mtimeMs: stat.mtimeMs };
  }
  return files;
}

/** Um subcomando arbitrario, com os flags de `write` quando aplicavel. */
function arbInvocation() {
  return fc.oneof(
    fc.constant(["show"]),
    fc.constant(["validate"]),
    fc.constant(["required-clis"]),
    arbRoles().map((roles) => [
      "write",
      "--backend-executor",
      roles.backendExecutor,
      "--frontend-executor",
      roles.frontendExecutor,
      "--backend-reviewer",
      roles.backendReviewer,
      "--frontend-reviewer",
      roles.frontendReviewer,
    ]),
    // Invocacao invalida: prova que mesmo a falha nao produz efeito colateral.
    fc.constant(["write", "--backend-executor", "not-a-real-executor"]),
    fc.constant(["write"]),
  );
}

/* -------------------------------------------------------------------------- */
/* Propriedade                                                                 */
/* -------------------------------------------------------------------------- */

// Feature: orchestrator-mcp-agent-config, Property 17: Config_Command nao produz efeito de Run
// Para qualquer invocacao do Config_Command, o unico caminho criado ou alterado no projeto e
// `.orchestrator/project-config.md`; nenhum diretorio `.orchestration/` e criado e nenhum PRD e lido.
//
// **Validates: Requirements 6.8**
test("Property 17: unico caminho afetado e .orchestrator/project-config.md, nunca .orchestration/", () => {
  fc.assert(
    fc.property(
      fc.array(arbInvocation(), { minLength: 1, maxLength: 3 }),
      (invocations) => {
        const root = temporaryProject();
        // Nenhum PRD existe no fixture: se o Config_Command precisasse ler um, a
        // invocacao falharia com um erro de arquivo ausente em vez do contrato
        // JSON normal — o que nenhuma das asserções abaixo tolera.
        const before = snapshot(root);

        for (const args of invocations) runCli(root, args);

        const after = snapshot(root);

        const changedOrCreated = new Set();
        for (const key of Object.keys(after)) {
          const previous = before[key];
          if (!previous || previous.size !== after[key].size || previous.mtimeMs !== after[key].mtimeMs) {
            changedOrCreated.add(key);
          }
        }
        for (const key of Object.keys(before)) {
          if (!(key in after)) changedOrCreated.add(key);
        }

        // O unico caminho tocavel e o arquivo canonico da Project_Config.
        for (const key of changedOrCreated) {
          assert.equal(
            key,
            ".orchestrator/project-config.md",
            `Config_Command alterou um caminho fora do escopo: ${key}`,
          );
        }

        // Nenhuma Run: nenhum diretorio `.orchestration/` aparece, em nenhum nivel.
        assert.ok(
          !existsSync(join(root, ".orchestration")),
          "Config_Command nao deveria criar .orchestration/",
        );
        for (const key of Object.keys(after)) {
          assert.ok(!key.startsWith(".orchestration/"), `caminho de Run apareceu: ${key}`);
        }

        // Nenhum artefato de PRD/spec (Pensador) foi criado como efeito colateral.
        assert.ok(!existsSync(join(root, ".pensador")), "Config_Command nao deveria tocar .pensador/");
        for (const key of Object.keys(after)) {
          assert.ok(
            !/(^|\/)prd\.md$/i.test(key) && !/(^|\/)spec\.md$/i.test(key),
            `artefato de PRD/spec apareceu: ${key}`,
          );
        }
      },
    ),
    { numRuns: NUM_RUNS },
  );
});
