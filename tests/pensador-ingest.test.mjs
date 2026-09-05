/**
 * Ingestao do handoff do Pensador (WF-011): descobre `.pensador/<slug>-vN/`,
 * escolhe a maior versao por slug, detecta ambiguidade entre slugs
 * distintos, cai para o fallback legado `.pensador-progress.json`, e
 * degrada para modo independente quando nada valida.
 *
 * Antes desta implementacao, esse algoritmo existia so como prosa em
 * `references/workflow.md` secao 1.0 — nenhum codigo o executava.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { ingestPensadorHandoff } from "../skills/orchestrator-multi-agent-development/scripts/lib/pensador-ingest.mjs";

const roots = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pensador-ingest-test-"));
  roots.push(root);
  return root;
}
test.afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

function writeJson(path, data) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof data === "string" ? data : JSON.stringify(data, null, 2), "utf8");
}

function baseHandoff(slug, status = "DONE") {
  return {
    handoffVersion: 1,
    stage: "pensador",
    slug,
    producer: { plugin: "cc-pensador", version: "1.0.0" },
    artifactRoot: `.pensador/${slug}-v1`,
    status,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    summary: "pensador done",
    upstream: null,
    artifacts: [],
    nextStage: null,
  };
}

test("returns standalone mode when no .pensador/ directory exists", () => {
  const root = fixture();
  const result = ingestPensadorHandoff({ projectRoot: root });
  assert.equal(result.mode, "standalone");
  assert.ok(result.warning);
});

test("detects joint mode from a single slug/version handoff.json", () => {
  const root = fixture();
  writeJson(join(root, ".pensador/login-social-v1/handoff.json"), baseHandoff("login-social"));

  const result = ingestPensadorHandoff({ projectRoot: root });
  assert.equal(result.mode, "joint");
  assert.equal(result.slug, "login-social");
  assert.equal(result.version, 1);
  assert.ok(result.pensadorHandoff);
});

test("picks the highest version among several -vN directories for the same slug", () => {
  const root = fixture();
  writeJson(join(root, ".pensador/checkout-v1/handoff.json"), baseHandoff("checkout"));
  writeJson(join(root, ".pensador/checkout-v3/handoff.json"), baseHandoff("checkout"));
  writeJson(join(root, ".pensador/checkout-v2/handoff.json"), baseHandoff("checkout"));

  const result = ingestPensadorHandoff({ projectRoot: root });
  assert.equal(result.mode, "joint");
  assert.equal(result.version, 3);
});

test("returns ambiguous mode when multiple distinct slugs exist without an explicit slug", () => {
  const root = fixture();
  writeJson(join(root, ".pensador/login-social-v1/handoff.json"), baseHandoff("login-social"));
  writeJson(join(root, ".pensador/checkout-v1/handoff.json"), baseHandoff("checkout"));

  const result = ingestPensadorHandoff({ projectRoot: root });
  assert.equal(result.mode, "ambiguous");
  assert.deepEqual([...result.slugCandidates].sort(), ["checkout", "login-social"]);
});

test("an explicit slug selects that slug even when other slugs exist", () => {
  const root = fixture();
  writeJson(join(root, ".pensador/login-social-v1/handoff.json"), baseHandoff("login-social"));
  writeJson(join(root, ".pensador/checkout-v1/handoff.json"), baseHandoff("checkout"));

  const result = ingestPensadorHandoff({ projectRoot: root, slug: "checkout" });
  assert.equal(result.mode, "joint");
  assert.equal(result.slug, "checkout");
});

test("an explicit slug with no matching directory degrades to standalone", () => {
  const root = fixture();
  writeJson(join(root, ".pensador/login-social-v1/handoff.json"), baseHandoff("login-social"));

  const result = ingestPensadorHandoff({ projectRoot: root, slug: "does-not-exist" });
  assert.equal(result.mode, "standalone");
});

test("falls back to legacy .pensador-progress.json when handoff.json is absent", () => {
  const root = fixture();
  writeJson(join(root, ".pensador/login-social-v1/.pensador-progress.json"), {
    checkpointVersion: 2,
    artifacts: [{ kind: "prd", path: "prd.md" }],
  });

  const result = ingestPensadorHandoff({ projectRoot: root, slug: "login-social" });
  assert.equal(result.mode, "joint");
  assert.ok(result.legacyProgress);
  assert.equal(result.pensadorHandoff, null);
  assert.match(result.warning, /legacy/i);
});

// N-14-style regression: a corrupt v2 handoff.json must not mask a usable
// legacy fallback in the same versioned directory.
test("falls back to legacy progress when handoff.json is present but corrupt", () => {
  const root = fixture();
  writeJson(join(root, ".pensador/login-social-v1/handoff.json"), "{ not valid json");
  writeJson(join(root, ".pensador/login-social-v1/.pensador-progress.json"), {
    checkpointVersion: 2,
    artifacts: [{ kind: "prd", path: "prd.md" }],
  });

  const result = ingestPensadorHandoff({ projectRoot: root, slug: "login-social" });
  assert.equal(result.mode, "joint");
  assert.ok(result.legacyProgress);
});

test("degrades to standalone when handoff.json is invalid and no legacy fallback exists", () => {
  const root = fixture();
  writeJson(join(root, ".pensador/login-social-v1/handoff.json"), "{ not valid json");

  const result = ingestPensadorHandoff({ projectRoot: root, slug: "login-social" });
  assert.equal(result.mode, "standalone");
  assert.ok(result.invalidHandoff);
});

test("degrades to standalone when handoff has an unsupported handoffVersion and no legacy fallback exists", () => {
  const root = fixture();
  writeJson(join(root, ".pensador/login-social-v1/handoff.json"), {
    handoffVersion: 99,
    stage: "pensador",
    slug: "login-social",
  });

  const result = ingestPensadorHandoff({ projectRoot: root, slug: "login-social" });
  assert.equal(result.mode, "standalone");
});
