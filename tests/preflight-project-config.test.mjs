import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { writeProjectConfig } from "../skills/orchestrator-multi-agent-development/scripts/lib/project-config.mjs";

/**
 * Teste de fumaca do preflight com stack `claude-code` (task 5.5).
 *
 * Complementa as propriedades de `tests/preflight-config.property.test.mjs`
 * com dois exemplos concretos: uma stack inteira em `claude-code` sem
 * `codex`/`agy` no PATH continua `status: "ok"`, e um Project_Config_File
 * invalido reprova o check obrigatorio sem apagar o arquivo.
 *
 * Ambiente isolado nos mesmos moldes dos demais testes de preflight: `cwd` em
 * diretorio temporario, `HOME`/`USERPROFILE` apontando para um HOME temporario
 * e `PATH` reduzido a um diretorio vazio.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PREFLIGHT = join(
  REPO_ROOT,
  "skills",
  "orchestrator-multi-agent-development",
  "scripts",
  "preflight.mjs",
);

const TEMP_ROOTS = [];

after(() => {
  for (const root of TEMP_ROOTS) rmSync(root, { recursive: true, force: true });
});

function createIsolatedProject() {
  const root = mkdtempSync(join(tmpdir(), "preflight-smoke-"));
  TEMP_ROOTS.push(root);

  const projectRoot = join(root, "project");
  const home = join(root, "home");
  const emptyPath = join(root, "empty-path");
  for (const directory of [projectRoot, home, emptyPath]) {
    mkdirSync(directory, { recursive: true });
  }

  return { root, projectRoot, home, emptyPath };
}

function runPreflight(environment) {
  const result = spawnSync(process.execPath, [PREFLIGHT], {
    cwd: environment.projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: environment.home,
      USERPROFILE: environment.home,
      PATH: environment.emptyPath,
      Path: environment.emptyPath,
    },
  });

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `relatorio de preflight nao e JSON (${error.message}): ${(result.stdout ?? "").slice(0, 400)}`,
    );
  }

  return { report, exitCode: result.status };
}

test("stack toda claude-code, sem codex/agy no PATH, retorna status ok e nenhum cli.* em failed", () => {
  const environment = createIsolatedProject();
  writeProjectConfig(environment.projectRoot, {
    backendExecutor: "claude-code",
    frontendExecutor: "claude-code",
    backendReviewer: "claude-code",
    frontendReviewer: "claude-code",
  }, { now: "2026-02-14T18:05:31Z" });

  const { report, exitCode } = runPreflight(environment);

  assert.equal(report.status, "ok", `status inesperado: ${JSON.stringify(report.failed)}`);
  assert.equal(exitCode, 0);
  assert.deepEqual(report.failed, []);
  assert.equal(report.checks.cli.codex.required, false);
  assert.equal(report.checks.cli.agy.required, false);
  assert.equal(report.checks.plugins["openai-codex"].required, false);
  assert.equal(report.checks.plugins["cc-antigravity-plugin"].required, false);
  for (const failure of report.failed) {
    assert.notEqual(failure.category, "cli");
  }
  // Nenhuma CLI obrigatoria: os dois avisos de CLI aparecem com o motivo correto.
  const cliWarnings = report.warnings.filter((warning) => warning.category === "cli");
  assert.deepEqual(cliWarnings.map((warning) => warning.name).sort(), ["agy", "codex"]);
  for (const warning of cliWarnings) {
    assert.equal(warning.reason, "NOT_REQUIRED_BY_PROJECT_CONFIG");
  }
});

test("Project_Config_File invalido reprova o check obrigatorio sem apagar o arquivo", () => {
  const environment = createIsolatedProject();
  const configDir = join(environment.projectRoot, ".orchestrator");
  const configPath = join(configDir, "project-config.md");
  mkdirSync(configDir, { recursive: true });
  const invalidContent = [
    "# ORCHESTRATOR PROJECT CONFIG",
    "",
    "- **schemaVersion**: 1",
    "- **backendExecutor**: gpt-5",
    "- **frontendExecutor**: agy",
    "- **backendReviewer**: codex",
    "- **frontendReviewer**: agy",
    "- **updatedAt**: 2026-02-14T18:05:31Z",
    "",
  ].join("\n");
  writeFileSync(configPath, invalidContent, "utf8");

  const { report, exitCode } = runPreflight(environment);

  assert.equal(report.status, "failed");
  assert.notEqual(exitCode, 0);
  const configCheck = report.checks.config["project-config"];
  assert.equal(configCheck.ok, false);
  assert.equal(configCheck.required, true);
  assert.equal(configCheck.code, "PROJECT_CONFIG_INVALID_VALUE");
  assert.ok(report.failed.some((failure) => failure.category === "config" && failure.name === "project-config"));
  assert.ok(report.remediation.some((entry) => entry.target.includes("project-config.md")));

  // O arquivo invalido permanece exatamente como estava: preflight nunca escreve nele.
  assert.equal(readFileSync(configPath, "utf8"), invalidContent);
});
