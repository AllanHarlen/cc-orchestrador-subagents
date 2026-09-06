import assert from "node:assert/strict";
import test from "node:test";

import {
  CODEX_EFFORT_LEVELS,
  CODEX_MODEL_ROLES,
  CODEX_ROLES,
  CODEX_ROLE_BY_CATEGORY,
  CODEX_ROLE_BY_MODEL,
  codexEffortForTask,
  codexModelForRole,
  codexRoleForTask,
  isKnownCodexModel,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/codex-router.mjs";

test("CODEX_MODEL_ROLES has exactly the three documented slugs", () => {
  assert.deepEqual(CODEX_MODEL_ROLES, {
    review: "gpt-5.6-sol",
    implement: "gpt-5.6-terra",
    fix: "gpt-5.6-luna",
  });
  assert.deepEqual([...CODEX_ROLES].sort(), ["fix", "implement", "review"]);
});

test("CODEX_ROLE_BY_MODEL is the exact inverse of CODEX_MODEL_ROLES", () => {
  for (const [role, model] of Object.entries(CODEX_MODEL_ROLES)) {
    assert.equal(CODEX_ROLE_BY_MODEL[model], role);
  }
});

test("codexRoleForTask: implementation categories map to implement", () => {
  for (const category of ["BACKEND_ONLY", "DATABASE_ONLY", "DOCS_ONLY", "FULLSTACK"]) {
    assert.equal(codexRoleForTask({ category }), "implement");
  }
});

test("codexRoleForTask: REVIEW_ONLY maps to review", () => {
  assert.equal(codexRoleForTask({ category: "REVIEW_ONLY" }), "review");
});

test("codexRoleForTask: FRONTEND_ONLY does not use Codex", () => {
  assert.equal(codexRoleForTask({ category: "FRONTEND_ONLY" }), null);
});

test("codexRoleForTask: review-fix and e2e-fix always resolve to fix, regardless of category", () => {
  for (const category of ["BACKEND_ONLY", "REVIEW_ONLY", "FULLSTACK"]) {
    assert.equal(codexRoleForTask({ category, origin: "review-fix" }), "fix");
    assert.equal(codexRoleForTask({ category, origin: "e2e-fix" }), "fix");
  }
});

test("codexRoleForTask: rejects unknown category", () => {
  assert.throws(() => codexRoleForTask({ category: "NOT_A_CATEGORY" }), /Unknown task category/);
});

test("codexRoleForTask: rejects unknown origin", () => {
  assert.throws(
    () => codexRoleForTask({ category: "BACKEND_ONLY", origin: "bogus" }),
    /Unknown origin/,
  );
});

test("codexModelForRole: returns the fixed slug per role", () => {
  assert.equal(codexModelForRole("review"), "gpt-5.6-sol");
  assert.equal(codexModelForRole("implement"), "gpt-5.6-terra");
  assert.equal(codexModelForRole("fix"), "gpt-5.6-luna");
});

test("codexModelForRole: rejects unknown role", () => {
  assert.throws(() => codexModelForRole("bogus"), /Unknown Codex role/);
});

test("codexEffortForTask: high complexity or high risk always yields high", () => {
  assert.equal(codexEffortForTask({ complexity: "high" }), "high");
  assert.equal(codexEffortForTask({ complexity: "low", highRisk: true }), "high");
});

test("codexEffortForTask: low complexity without risk yields low", () => {
  assert.equal(codexEffortForTask({ complexity: "low" }), "low");
});

test("codexEffortForTask: default (unspecified complexity) yields medium", () => {
  assert.equal(codexEffortForTask({}), "medium");
  assert.equal(codexEffortForTask(), "medium");
});

test("CODEX_EFFORT_LEVELS matches AGY's three-level vocabulary", () => {
  assert.deepEqual([...CODEX_EFFORT_LEVELS], ["low", "medium", "high"]);
});

test("isKnownCodexModel: true only for the three fixed slugs", () => {
  assert.equal(isKnownCodexModel("gpt-5.6-sol"), true);
  assert.equal(isKnownCodexModel("gpt-5.6-terra"), true);
  assert.equal(isKnownCodexModel("gpt-5.6-luna"), true);
  assert.equal(isKnownCodexModel("gpt-5.6-turbo"), false);
  assert.equal(isKnownCodexModel(undefined), false);
});

test("CODEX_ROLE_BY_CATEGORY has no entry for FRONTEND_ONLY", () => {
  assert.equal(CODEX_ROLE_BY_CATEGORY.FRONTEND_ONLY, undefined);
});
