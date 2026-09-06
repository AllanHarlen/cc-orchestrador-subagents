/**
 * Achado 14 (analise-run-oficina-saas-20260905.md): `.orchestration/<slug>/`
 * e `.orchestrator/` diferem em tres caracteres, ambos ocultos, ambos na
 * raiz do projeto — a run analisada perdeu tempo real recriando um worktree
 * removido por engano de um pelo outro. Toda run nova passa a nascer em
 * `.orchestrator/runs/<slug>/`; `.orchestration/<slug>/` continua sendo
 * lido (nunca migrado automaticamente).
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  currentRunsRoot,
  legacyRunsRoot,
  runRootCandidates,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/artifact-layout.mjs";
import {
  findRunDirectory,
  initRun,
  loadRun,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/orchestration-state.mjs";

const roots = [];
function fixtureRoot() {
  const root = mkdtempSync(join(process.cwd(), ".tmp-run-root-migration-test-"));
  roots.push(root);
  return root;
}

function writeClassification(artifactDir) {
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(
    join(artifactDir, "tasks-classification.md"),
    ["# Tasks", "", "## BE-01 - Endpoint", "- category: BACKEND_ONLY"].join("\n"),
    "utf8",
  );
  writeFileSync(join(artifactDir, "waves.md"), "# Waves\n\n## Wave 1\n- BE-01\n", "utf8");
}

test.afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

test("currentRunsRoot / legacyRunsRoot point at the two historically-confused paths", () => {
  const root = fixtureRoot();
  assert.equal(currentRunsRoot(root), join(root, ".orchestrator", "runs"));
  assert.equal(legacyRunsRoot(root), join(root, ".orchestration"));
});

test("a new run, with no explicit artifactDir, is created under .orchestrator/runs/<slug>/", () => {
  const root = fixtureRoot();
  const artifactDir = join(root, ".orchestrator", "runs", "oficina");
  writeClassification(artifactDir);
  const result = initRun({ projectRoot: root, slug: "oficina", runId: "oficina-001" });
  assert.equal(result.artifactDir, artifactDir);
  assert.equal(loadRun(artifactDir).state.slug, "oficina");
});

test("findRunDirectory discovers a run that lives only under the legacy .orchestration/<slug>/ root", () => {
  const root = fixtureRoot();
  const legacyDir = join(root, ".orchestration", "legado");
  writeClassification(legacyDir);
  initRun({ projectRoot: root, artifactDir: legacyDir, slug: "legado", runId: "legado-001" });

  const found = findRunDirectory({ projectRoot: root, runId: "legado-001" });
  assert.equal(found, legacyDir);
});

test("findRunDirectory discovers a run that lives under the current .orchestrator/runs/<slug>/ root", () => {
  const root = fixtureRoot();
  const currentDir = join(root, ".orchestrator", "runs", "novo");
  writeClassification(currentDir);
  initRun({ projectRoot: root, artifactDir: currentDir, slug: "novo", runId: "novo-001" });

  const found = findRunDirectory({ projectRoot: root, runId: "novo-001" });
  assert.equal(found, currentDir);
});

test("findRunDirectory sees runs in both roots at once and picks the most recently active one", () => {
  const root = fixtureRoot();
  const legacyDir = join(root, ".orchestration", "antigo");
  const currentDir = join(root, ".orchestrator", "runs", "recente");
  writeClassification(legacyDir);
  writeClassification(currentDir);
  initRun({ projectRoot: root, artifactDir: legacyDir, slug: "antigo", runId: "antigo-001" });
  initRun({ projectRoot: root, artifactDir: currentDir, slug: "recente", runId: "recente-001" });

  // Sem runId explicito: a run mais recente/ativa vence, venha ela de
  // qualquer uma das duas raizes.
  const found = findRunDirectory({ projectRoot: root });
  assert.equal(found, currentDir);
});

test("findRunDirectory throws RUN_NOT_FOUND when neither root exists", () => {
  const root = fixtureRoot();
  assert.throws(
    () => findRunDirectory({ projectRoot: root }),
    (error) => error.code === "RUN_NOT_FOUND",
  );
});

test("runId numbering stays unique across both roots — a legacy run's prefix is not reused by a new one", () => {
  const root = fixtureRoot();
  const legacyDir = join(root, ".orchestration", "oficina-mecanica");
  writeClassification(legacyDir);
  const legacy = initRun({
    projectRoot: root,
    artifactDir: legacyDir,
    slug: "oficina-mecanica",
    now: "2026-09-05T12:00:00.000Z",
  });
  const legacyRunId = legacy.state.runId;

  const currentDir = join(root, ".orchestrator", "runs", "oficina-mecanica-2");
  writeClassification(currentDir);
  const next = initRun({
    projectRoot: root,
    artifactDir: currentDir,
    slug: "oficina-mecanica",
    now: "2026-09-05T12:00:00.000Z",
  });
  assert.notEqual(next.state.runId, legacyRunId);
  // O prefixo (slug-data-) e o mesmo; o numero de sequencia precisa avancar.
  const prefix = legacyRunId.slice(0, legacyRunId.lastIndexOf("-") + 1);
  assert.ok(next.state.runId.startsWith(prefix));
  assert.notEqual(next.state.runId.slice(prefix.length), legacyRunId.slice(prefix.length));
});

test("runRootCandidates reports existence independently for each root", () => {
  const root = fixtureRoot();
  const before = runRootCandidates(root);
  assert.deepEqual(before.map((c) => c.exists), [false, false]);

  const legacyDir = join(root, ".orchestration", "x");
  mkdirSync(legacyDir, { recursive: true });
  const after = runRootCandidates(root);
  const legacy = after.find((c) => c.root === legacyRunsRoot(root));
  const current = after.find((c) => c.root === currentRunsRoot(root));
  assert.equal(legacy.exists, true);
  assert.equal(current.exists, false);
});
