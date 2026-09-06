import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  initRun,
  reconcileRunAtDirectory,
  updateTaskStatus,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/orchestration-state.mjs";
import { writeProjectConfig } from "../skills/orchestrator-multi-agent-development/scripts/lib/project-config.mjs";

/**
 * Testes concretos do roteamento com executor `claude-code` (task 8.3 do plano).
 *
 * Complementares a Property 12 (`tests/routing.property.test.mjs`), que ja cobre
 * generativamente o acordo entre o validador e a derivacao: aqui os tres pontos
 * pedidos pela task sao exemplos concretos —
 *
 * - o caminho de review por papel (Req 7.10);
 * - uma stack inteira `claude-code`, sem `codex`/`agy` em lugar nenhum (Req 7.11);
 * - o mapeamento de `reasonCode` (`QUOTA_EXHAUSTED`, `AUTH_REQUIRED`, `TIMEOUT`)
 *   quando o Executor da task e `claude-code` (Req 7.12) — exercitado pelo fluxo
 *   real de reconciliacao (`reconcileRunAtDirectory`), que nao ramifica por
 *   executor: a mesma tabela (`normalizeExternalStatus`) vale para
 *   `codex`/`agy`/`claude-code`, o que a comparacao lado a lado abaixo prova.
 */

const roots = [];
const VALIDATE_ROUTING = resolve(
  "skills/orchestrator-multi-agent-development/scripts/validate-routing.mjs",
);

function fixture(files) {
  const root = mkdtempSync(join(process.cwd(), ".tmp-routing-cc-"));
  roots.push(root);
  const artifactDir = join(root, ".orchestration", "run");
  mkdirSync(artifactDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(artifactDir, name), content, "utf8");
  }
  return { root, artifactDir };
}

function runValidator(artifactDir) {
  const result = spawnSync(process.execPath, [VALIDATE_ROUTING, artifactDir], {
    encoding: "utf8",
    windowsHide: true,
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || `git ${args.join(" ")} failed`);
  return String(result.stdout).trim();
}

test.afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */
/* Req 7.10: caminho de review por papel                                       */
/* -------------------------------------------------------------------------- */

test("REVIEW_ONLY com revisor claude-code so passa registrando o review read-only", () => {
  const config = {
    backendExecutor: "codex",
    frontendExecutor: "agy",
    backendReviewer: "claude-code",
    frontendReviewer: "claude-code",
  };

  const withoutRecord = fixture({
    "tasks-classification.md": [
      "# Classificacao",
      "",
      "## REV-01 - Review final",
      "- categoria: REVIEW_ONLY",
      "- executor: claude-code",
      "- executorSource: project-config",
    ].join("\n"),
    "waves.md": ["# Waves", "", "## Wave 1", "- REV-01"].join("\n"),
  });
  writeProjectConfig(withoutRecord.root, config);
  const failed = runValidator(withoutRecord.artifactDir);
  assert.equal(failed.status, 1, failed.output);
  assert.match(failed.output, /review\/review-final\.md.*review\/review-frontend\.md/);

  const withRecord = fixture({
    "tasks-classification.md": [
      "# Classificacao",
      "",
      "## REV-01 - Review final",
      "- categoria: REVIEW_ONLY",
      "- executor: claude-code",
      "- executorSource: project-config",
      "- review record: review/review-final.md",
    ].join("\n"),
    "waves.md": [
      "# Waves",
      "",
      "## Wave 1",
      "- REV-01 -> claude-code, review record: review/review-final.md",
    ].join("\n"),
  });
  writeProjectConfig(withRecord.root, config);
  const passed = runValidator(withRecord.artifactDir);
  assert.equal(passed.status, 0, passed.output);
});

test("REVIEW_ONLY com revisor codex so passa com --effort high", () => {
  const config = {
    backendExecutor: "codex",
    frontendExecutor: "agy",
    backendReviewer: "codex",
    frontendReviewer: "agy",
  };

  const withoutHighEffort = fixture({
    "tasks-classification.md": [
      "# Classificacao",
      "",
      "## REV-01 - Review final",
      "- categoria: REVIEW_ONLY",
      "- executor: codex",
      "- executorSource: project-config",
      "- assignedAgent: `codex:codex-rescue` --effort medium",
    ].join("\n"),
    "waves.md": ["# Waves", "", "## Wave 1", "- REV-01"].join("\n"),
  });
  writeProjectConfig(withoutHighEffort.root, config);
  const failed = runValidator(withoutHighEffort.artifactDir);
  assert.equal(failed.status, 1, failed.output);
  assert.match(failed.output, /nao aponta para Codex com --effort high/);

  const withHighEffort = fixture({
    "tasks-classification.md": [
      "# Classificacao",
      "",
      "## REV-01 - Review final",
      "- categoria: REVIEW_ONLY",
      "- executor: codex",
      "- executorSource: project-config",
      "- assignedAgent: `codex:codex-rescue` --effort high",
      "- codexModel: `gpt-5.6-sol`",
      "- codexModelSource: `heuristic`",
    ].join("\n"),
    "waves.md": [
      "# Waves",
      "",
      "## Wave 1",
      "- REV-01 -> `codex:codex-rescue` --effort high codexModel: `gpt-5.6-sol` codexModelSource: `heuristic`",
    ].join("\n"),
  });
  writeProjectConfig(withHighEffort.root, config);
  const passed = runValidator(withHighEffort.artifactDir);
  assert.equal(passed.status, 0, passed.output);
});

/* -------------------------------------------------------------------------- */
/* Req 7.11: stack inteira claude-code, sem codex/agy                          */
/* -------------------------------------------------------------------------- */

test("stack toda claude-code roteia toda categoria sem exigir codex ou agy", () => {
  const config = {
    backendExecutor: "claude-code",
    frontendExecutor: "claude-code",
    backendReviewer: "claude-code",
    frontendReviewer: "claude-code",
  };

  const { root, artifactDir } = fixture({
    "tasks-classification.md": [
      "# Classificacao",
      "",
      "## BE-01 - API",
      "- categoria: BACKEND_ONLY",
      "- executor: claude-code",
      "- executorSource: project-config",
      "",
      "## FE-01 - Vitrine",
      "- categoria: FRONTEND_ONLY",
      "- executor: claude-code",
      "- executorSource: project-config",
      "",
      "## DB-01 - Migracao",
      "- categoria: DATABASE_ONLY",
      "- executor: claude-code",
      "- executorSource: project-config",
      "",
      "## DOC-01 - Documentacao",
      "- categoria: DOCS_ONLY",
      "- executor: claude-code",
      "- executorSource: project-config",
      "",
      "## FS-01 - Feature completa",
      "- categoria: FULLSTACK",
      "- executor: claude-code",
      "- executorSource: project-config",
      "",
      "## REV-01 - Review final",
      "- categoria: REVIEW_ONLY",
      "- executor: claude-code",
      "- executorSource: project-config",
      "- review record: review/review-final.md",
    ].join("\n"),
    "waves.md": [
      "# Waves",
      "",
      "## Wave 1",
      "- BE-01",
      "- FE-01",
      "- DB-01",
      "- DOC-01",
      "- FS-01",
      "- REV-01 -> claude-code, review record: review/review-final.md",
    ].join("\n"),
  });
  writeProjectConfig(root, config);

  const result = runValidator(artifactDir);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /passed for 6 task\(s\)/);
  // Nenhuma CLI externa nem subagente de codex/agy e mencionado no relatorio.
  assert.doesNotMatch(result.output, /codex:codex-rescue/i);
  assert.doesNotMatch(result.output, /cc-antigravity-plugin/i);
});

test("stack toda claude-code reprova task que ainda invoca codex:codex-rescue ou o plugin AGY", () => {
  const config = {
    backendExecutor: "claude-code",
    frontendExecutor: "claude-code",
    backendReviewer: "claude-code",
    frontendReviewer: "claude-code",
  };

  const leftoverCodex = fixture({
    "tasks-classification.md": [
      "# Classificacao",
      "",
      "## BE-01 - API",
      "- categoria: BACKEND_ONLY",
      "- executor: claude-code",
      "- executorSource: project-config",
      "- assignedAgent: `codex:codex-rescue` --effort medium",
    ].join("\n"),
    "waves.md": ["# Waves", "", "## Wave 1", "- BE-01"].join("\n"),
  });
  writeProjectConfig(leftoverCodex.root, config);
  const codexResult = runValidator(leftoverCodex.artifactDir);
  assert.equal(codexResult.status, 1, codexResult.output);
  assert.match(codexResult.output, /invoca Codex \(`codex:codex-rescue` ou `codex-companion\.mjs` direto\)/);

  const leftoverCodexDirect = fixture({
    "tasks-classification.md": [
      "# Classificacao",
      "",
      "## BE-02 - API direta",
      "- categoria: BACKEND_ONLY",
      "- executor: claude-code",
      "- executorSource: project-config",
      "- assignedAgent: node \"<companionPath>/codex-companion.mjs\" task --effort medium",
    ].join("\n"),
    "waves.md": ["# Waves", "", "## Wave 1", "- BE-02"].join("\n"),
  });
  writeProjectConfig(leftoverCodexDirect.root, config);
  const codexDirectResult = runValidator(leftoverCodexDirect.artifactDir);
  assert.equal(codexDirectResult.status, 1, codexDirectResult.output);
  assert.match(codexDirectResult.output, /invoca Codex \(`codex:codex-rescue` ou `codex-companion\.mjs` direto\)/);

  const leftoverAgy = fixture({
    "tasks-classification.md": [
      "# Classificacao",
      "",
      "## FE-01 - Vitrine",
      "- categoria: FRONTEND_ONLY",
      "- executor: claude-code",
      "- executorSource: project-config",
      "- assignedAgent: `cc-antigravity-plugin:antigravity-coder`",
    ].join("\n"),
    "waves.md": ["# Waves", "", "## Wave 1", "- FE-01"].join("\n"),
  });
  writeProjectConfig(leftoverAgy.root, config);
  const agyResult = runValidator(leftoverAgy.artifactDir);
  assert.equal(agyResult.status, 1, agyResult.output);
  assert.match(agyResult.output, /invoca subagente do `cc-antigravity-plugin`/);
});

/* -------------------------------------------------------------------------- */
/* Req 7.12: mapeamento de reasonCode uniforme entre executores                */
/* -------------------------------------------------------------------------- */

/**
 * Uma Run com uma task por executor, cada uma levada a RUNNING e depois
 * reconciliada com o mesmo `reasonCode` bruto vindo do probe externo.
 *
 * `reconcileTask`/`normalizeExternalStatus` (`scripts/lib/orchestration-state.mjs`)
 * nunca leem `task.executor` na decisao de status — a comparacao entre os tres
 * executores prova isso na pratica, em vez de so ler o codigo.
 */
function reconciledStatusFor(executor, rawReasonCode) {
  const projectRoot = mkdtempSync(join(process.cwd(), ".tmp-routing-cc-reason-"));
  roots.push(projectRoot);
  const artifactDir = join(projectRoot, ".orchestration", "run");
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(
    join(artifactDir, "tasks-classification.md"),
    ["# Classificacao", "", "## BE-01 - API", "- categoria: BACKEND_ONLY"].join("\n"),
    "utf8",
  );
  writeFileSync(join(artifactDir, "waves.md"), "# Waves\n\n## Wave 1\n- BE-01\n", "utf8");
  // Isola o projeto do repositorio real: sem `git init` aqui, `inspectGit`
  // enxergaria o `.git` deste proprio repositorio (o diretorio temporario e
  // criado dentro de `process.cwd()`), o que torna cada reconciliacao lenta.
  git(projectRoot, "init", "-b", "main");
  git(projectRoot, "config", "user.email", "orchestrator-tests@example.invalid");
  git(projectRoot, "config", "user.name", "Orchestrator Tests");
  initRun({ projectRoot, artifactDir, slug: "run", runId: `${executor}-${rawReasonCode}` });
  updateTaskStatus(artifactDir, "BE-01", "RUNNING", { projectRoot, executor });

  const probeFile = join(projectRoot, "probe.json");
  writeFileSync(
    probeFile,
    JSON.stringify({ tasks: { "BE-01": { status: rawReasonCode } } }),
    "utf8",
  );
  const result = reconcileRunAtDirectory(artifactDir, { projectRoot, probeFile });
  const task = result.state.tasks["BE-01"];
  return { status: task.status, reasonCode: task.reasonCode, executor: task.executor };
}

test("QUOTA_EXHAUSTED, AUTH_REQUIRED e TIMEOUT mapeiam para o mesmo status em codex, agy e claude-code", () => {
  const EXPECTED_STATUS = Object.freeze({
    QUOTA_EXHAUSTED: "BLOCKED",
    AUTH_REQUIRED: "BLOCKED",
    TIMEOUT: "FAILED",
  });

  for (const rawReasonCode of Object.keys(EXPECTED_STATUS)) {
    const outcomes = ["codex", "agy", "claude-code"].map((executor) => ({
      executor,
      ...reconciledStatusFor(executor, rawReasonCode),
    }));

    for (const outcome of outcomes) {
      assert.equal(
        outcome.status,
        EXPECTED_STATUS[rawReasonCode],
        `${outcome.executor}/${rawReasonCode}: status inesperado`,
      );
      assert.equal(
        outcome.reasonCode,
        rawReasonCode,
        `${outcome.executor}/${rawReasonCode}: reasonCode inesperado`,
      );
    }

    // A politica de bloqueio nao depende do executor: os tres produzem o mesmo
    // status e o mesmo reasonCode para o mesmo motivo (Req 7.12).
    const statuses = new Set(outcomes.map((outcome) => outcome.status));
    const reasonCodes = new Set(outcomes.map((outcome) => outcome.reasonCode));
    assert.equal(statuses.size, 1, `${rawReasonCode}: status divergiu entre executores`);
    assert.equal(reasonCodes.size, 1, `${rawReasonCode}: reasonCode divergiu entre executores`);
  }
});
