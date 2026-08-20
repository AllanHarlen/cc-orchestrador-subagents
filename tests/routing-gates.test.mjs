import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  initRun,
  loadRun,
  syncRunFromArtifacts,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/orchestration-state.mjs";

const roots = [];
const validateRouting = resolve(
  "skills/orchestrator-multi-agent-development/scripts/validate-routing.mjs",
);

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || `git ${args.join(" ")} failed`);
  return String(result.stdout).trim();
}

function fixture(files) {
  const root = mkdtempSync(join(process.cwd(), ".tmp-routing-test-"));
  roots.push(root);
  const artifactDir = join(root, ".orchestration", "run");
  mkdirSync(artifactDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(artifactDir, name), content, "utf8");
  }
  return { root, artifactDir };
}

function runValidator(artifactDir) {
  const result = spawnSync(process.execPath, [validateRouting, artifactDir], {
    encoding: "utf8",
    windowsHide: true,
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

test.afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

test("routing validation accepts the same task IDs the State Engine accepts", () => {
  const { artifactDir } = fixture({
    "tasks-classification.md": [
      "# Classificacao",
      "",
      "## BE-01 - API de pedidos",
      "- categoria: BACKEND_ONLY",
      "- assignedAgent: `codex:codex-rescue` --effort medium",
      "",
      "## FE-01 - Vitrine",
      "- categoria: FRONTEND_ONLY",
      "- assignedAgent: `cc-antigravity-plugin:antigravity-coder`",
      "- agyModel: `flash-high`",
      "- agyModelSource: `heuristic`",
    ].join("\n"),
    "waves.md": [
      "# Waves",
      "",
      "## Wave 1",
      "- BE-01 -> `codex:codex-rescue` --effort medium (BACKEND_ONLY)",
      "- FE-01 -> `cc-antigravity-plugin:antigravity-coder` --model `flash-high` --mode accept-edits --format stream-json agyModelSource: `heuristic` (FRONTEND_ONLY)",
    ].join("\n"),
  });

  const result = runValidator(artifactDir);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /passed for 2 task\(s\)/);
});

test("an AGY model name in a routing table is not mistaken for a task", () => {
  const { root, artifactDir } = fixture({
    "tasks-classification.md": [
      "# Classificacao",
      "",
      "| Modelo | Task | Categoria | Agente |",
      "|---|---|---|---|",
      "| agyModel: `flash-high` | FE-01 | FRONTEND_ONLY | `cc-antigravity-plugin:antigravity-coder` agyModelSource: `heuristic` |",
    ].join("\n"),
    "waves.md": [
      "# Waves",
      "",
      "## Wave 1",
      "- FE-01 -> `cc-antigravity-plugin:antigravity-coder` --model `flash-high` --format stream-json agyModelSource: `heuristic` (FRONTEND_ONLY)",
    ].join("\n"),
  });
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "orchestrator-tests@example.invalid");
  git(root, "config", "user.name", "Orchestrator Tests");

  const result = runValidator(artifactDir);
  assert.equal(result.status, 0, result.output);
  assert.doesNotMatch(result.output, /GEMINI-3/i);

  // O State Engine precisa concordar: nenhuma task fantasma vinda do nome do modelo.
  initRun({ projectRoot: root, artifactDir, slug: "model-name", runId: "model-name-001" });
  syncRunFromArtifacts(artifactDir, { projectRoot: root });
  assert.deepEqual(Object.keys(loadRun(artifactDir).state.tasks), ["FE-01"]);
});

test("routing validation refuses implementation delegated to the read-only AGY agent", () => {
  const { artifactDir } = fixture({
    "tasks-classification.md": [
      "# Classificacao",
      "",
      "## FE-01 - Vitrine",
      "- categoria: FRONTEND_ONLY",
      "- assignedAgent: `cc-antigravity-plugin:antigravity-agent`",
      "- agyModel: `flash-high`",
      "- agyModelSource: `heuristic`",
    ].join("\n"),
    "waves.md": [
      "# Waves",
      "",
      "## Wave 1",
      "- FE-01 -> `cc-antigravity-plugin:antigravity-coder` --model `flash-high` --format stream-json agyModelSource: `heuristic` (FRONTEND_ONLY)",
    ].join("\n"),
  });

  const result = runValidator(artifactDir);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /antigravity-agent, que e somente leitura/);
});

test("a front-end run keeps browserE2E required until an explicit waiver is recorded", () => {
  const { root, artifactDir } = fixture({
    "tasks-classification.md": [
      "# Classificacao",
      "",
      "## FE-01 - Vitrine consumindo API existente",
      "- categoria: FRONTEND_ONLY",
      "- expectedFiles: `src/App.tsx`",
    ].join("\n"),
    "waves.md": ["# Waves", "", "## Wave 1", "- FE-01"].join("\n"),
  });
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "orchestrator-tests@example.invalid");
  git(root, "config", "user.name", "Orchestrator Tests");

  initRun({ projectRoot: root, artifactDir, slug: "front-only", runId: "front-only-001" });
  syncRunFromArtifacts(artifactDir, { projectRoot: root });

  // A run without back-end tasks is exactly the separate-origin SPA case Phase 9.5 exists
  // for. The gate must survive as PENDING instead of being derived away without a reason.
  const gate = loadRun(artifactDir).state.completionGates.browserE2E;
  assert.equal(gate.required, true);
  assert.equal(gate.status, "PENDING");
  assert.equal(gate.reason, null);
});

test("routing accepts dynamic user slugs but keeps heuristic routing on capability aliases", () => {
  const valid = fixture({
    "tasks-classification.md": [
      "# Classificacao", "", "## FE-01 - Vitrine", "- categoria: FRONTEND_ONLY",
      "- executor: agy", "- executorSource: project-config",
      "- assignedAgent: `cc-antigravity-plugin:antigravity-coder`",
      "- agyModel: `gemini-4.2-pro-ultra`", "- agyModelSource: `user`",
      "- agyEffort: `medium`", "- agyTimeout: `5m`", "- agyFormat: `stream-json`",
    ].join("\n"),
    "waves.md": [
      "# Waves", "", "## Wave 1",
      "- FE-01 -> `cc-antigravity-plugin:antigravity-coder` --model `gemini-4.2-pro-ultra` --format stream-json agyModelSource: `user` (FRONTEND_ONLY)",
    ].join("\n"),
  });
  assert.equal(runValidator(valid.artifactDir).status, 0);

  const invalid = fixture({
    "tasks-classification.md": [
      "# Classificacao", "", "## FE-02 - Vitrine", "- categoria: FRONTEND_ONLY",
      "- assignedAgent: `cc-antigravity-plugin:antigravity-coder`",
      "- agyModel: `gemini-4.2-pro-ultra`", "- agyModelSource: `heuristic`",
    ].join("\n"),
    "waves.md": [
      "# Waves", "", "## Wave 1",
      "- FE-02 -> `cc-antigravity-plugin:antigravity-coder` --model `gemini-4.2-pro-ultra` agyModelSource: `heuristic` (FRONTEND_ONLY)",
    ].join("\n"),
  });
  const result = runValidator(invalid.artifactDir);
  assert.equal(result.status, 1);
  assert.match(result.output, /Routing heuristic\/adaptive deve usar aliases/);
});

test("routing validates the public AGY effort, timeout and implementation format contract", () => {
  const root = fixture({
    "tasks-classification.md": [
      "# Classificacao", "", "## FE-03 - Vitrine", "- categoria: FRONTEND_ONLY",
      "- assignedAgent: `cc-antigravity-plugin:antigravity-coder`",
      "- agyModel: `flash-medium`", "- agyModelSource: `heuristic`",
      "- agyEffort: `ultra`", "- agyTimeout: `forever`", "- agyFormat: `json`",
    ].join("\n"),
    "waves.md": [
      "# Waves", "", "## Wave 1",
      "- FE-03 -> `cc-antigravity-plugin:antigravity-coder` --model `flash-medium` agyModelSource: `heuristic` (FRONTEND_ONLY)",
    ].join("\n"),
  });
  const result = runValidator(root.artifactDir);
  assert.equal(result.status, 1);
  assert.match(result.output, /agyEffort invalido/);
  assert.match(result.output, /agyTimeout invalido/);
  assert.match(result.output, /implementacao AGY 4\.0 usa stream-json/);
});

test("legacy runs with versioned AGY slugs remain resumable without migration", () => {
  const root = fixture({
    "tasks-classification.md": [
      "# Classificacao", "", "## FE-04 - Run antiga", "- categoria: FRONTEND_ONLY",
      "- assignedAgent: `cc-antigravity-plugin:antigravity-coder`",
      "- agyModel: `gemini-3.5-flash-high`", "- agyModelSource: `heuristic`",
    ].join("\n"),
    "waves.md": [
      "# Waves", "", "## Wave 1",
      "- FE-04 -> `cc-antigravity-plugin:antigravity-coder` --model `gemini-3.5-flash-high` agyModelSource: `heuristic` (FRONTEND_ONLY)",
    ].join("\n"),
  });
  const result = runValidator(root.artifactDir);
  assert.equal(result.status, 0);
  assert.match(result.output, /preserva slug legado gemini-3\.5-flash-high/);
});
