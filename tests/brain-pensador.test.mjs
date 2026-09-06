/**
 * CLI de `/orquestrador brain-pensador` — `scripts/brain-pensador.mjs`.
 *
 * A logica de listagem ja e coberta a fundo em `pensador-ingest.test.mjs`
 * (testes de `listPensadorHandoffs`); este arquivo cobre so a superficie do
 * processo: JSON envelope, `--limit`/`--all`, `help`, e que nada em
 * `.pensador/` e tocado por uma invocacao real do binario.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const CLI = resolve("skills/orchestrator-multi-agent-development/scripts/brain-pensador.mjs");
const roots = [];

function fixture() {
  const root = mkdtempSync(join(process.cwd(), ".tmp-brain-pensador-test-"));
  roots.push(root);
  return root;
}

test.afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

function writeHandoff(root, slug, version, overrides = {}) {
  const dir = join(root, ".pensador", `${slug}-v${version}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "handoff.json"),
    JSON.stringify({
      handoffVersion: 1,
      stage: "pensador",
      slug,
      producer: { plugin: "cc-pensador", version: "1.0.0" },
      artifactRoot: `.pensador/${slug}-v${version}`,
      status: "DONE",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      summary: `handoff for ${slug}`,
      upstream: null,
      artifacts: [],
      nextStage: null,
      ...overrides,
    }),
    "utf8",
  );
}

function run(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", windowsHide: true });
  return { status: result.status, json: JSON.parse(result.stdout) };
}

test("brain-pensador --root with no .pensador/ returns an empty, well-formed envelope", () => {
  const root = fixture();
  const { status, json } = run(["--root", root]);
  assert.equal(status, 0);
  assert.equal(json.ok, true);
  assert.deepEqual(json.result.handoffs, []);
  assert.equal(json.result.count, 0);
});

test("brain-pensador lists one row per slug and respects --limit", () => {
  const root = fixture();
  writeHandoff(root, "oficina", 1);
  writeHandoff(root, "locadora", 1);
  writeHandoff(root, "clinica", 1);

  const all = run(["--root", root, "--all"]);
  assert.equal(all.json.result.count, 3);

  const limited = run(["--root", root, "--limit", "1"]);
  assert.equal(limited.json.result.count, 1);
});

test("brain-pensador help does not scan .pensador/", () => {
  const root = fixture();
  writeHandoff(root, "oficina", 1);
  const { status, json } = run(["help", "--root", root]);
  assert.equal(status, 0);
  assert.equal(json.ok, true);
  assert.equal(json.name, "brain-pensador");
});

test("brain-pensador never writes to .pensador/", () => {
  const root = fixture();
  writeHandoff(root, "oficina", 1);
  const handoffPath = join(root, ".pensador", "oficina-v1", "handoff.json");
  const before = readFileSync(handoffPath, "utf8");
  run(["--root", root, "--all"]);
  const after = readFileSync(handoffPath, "utf8");
  assert.equal(before, after);
});
