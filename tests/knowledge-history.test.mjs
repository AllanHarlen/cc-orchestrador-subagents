import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  ProjectKnowledgeError,
  addValidatedFact,
  auditKnowledgeSources,
  findDurableRunEvent,
  knowledgeStatus,
  listFacts,
  renderProjectMemory,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/project-knowledge.mjs";
import {
  historyStatus,
  projectAllHistory,
  projectRunHistory,
  rebuildHistory,
  searchHistory,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/orchestration-history.mjs";
import {
  initRun,
  updateTaskStatus,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/orchestration-state.mjs";

const roots = [];

function temporaryProject() {
  const root = mkdtempSync(join(process.cwd(), ".tmp-knowledge-test-"));
  roots.push(root);
  return root;
}

function runFixture(root, options = {}) {
  const slug = options.slug ?? "demo";
  const artifactDir = join(root, ".orchestration", slug);
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(
    join(artifactDir, "tasks-classification.md"),
    [
      "# Tasks",
      "",
      "## BE-01 - Restore packages",
      "- category: BACKEND_ONLY",
      "- assignedAgent: codex",
      "- validationPlan: `dotnet restore`",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(join(artifactDir, "waves.md"), "# Waves\n\n## Wave 1\n- BE-01\n", "utf8");
  initRun({
    projectRoot: root,
    artifactDir,
    slug,
    runId: options.runId ?? `${slug}-run`,
  });
  return artifactDir;
}

test.afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

test("project memory contains only validated facts with source provenance", () => {
  const root = temporaryProject();
  writeFileSync(join(root, "package.json"), '{"name":"demo","type":"module"}\n', "utf8");
  const added = addValidatedFact(root, {
    section: "Architecture",
    key: "Runtime",
    value: "Node.js",
    sourceType: "FILE",
    sourceRef: "package.json",
  });
  assert.equal(added.fact.status, "VALIDATED");
  const rendered = renderProjectMemory(root);
  const content = readFileSync(rendered.path, "utf8");
  assert.match(content, /Runtime: Node\.js/);
  assert.match(content, /VALIDATED · SOURCE: FILE:package\.json/);
  assert.equal(knowledgeStatus(root).health.integrity, "ok");
});

test("unverifiable files and failing tests cannot become project facts", () => {
  const root = temporaryProject();
  assert.throws(
    () => addValidatedFact(root, {
      section: "Architecture",
      key: "Database",
      value: "PostgreSQL",
      sourceType: "FILE",
      sourceRef: "missing.csproj",
    }),
    (error) => error instanceof ProjectKnowledgeError && error.code === "EVIDENCE_FILE_NOT_FOUND",
  );
  assert.throws(
    () => addValidatedFact(root, {
      section: "Validation",
      key: "Backend",
      value: "dotnet test",
      sourceType: "TEST",
      sourceRef: "dotnet test",
      sourceStatus: "FAIL",
    }),
    (error) => error instanceof ProjectKnowledgeError && error.code === "TEST_EVIDENCE_NOT_PASSING",
  );
});

test("RUN_EVENT facts require and continuously audit a real durable event", () => {
  const root = temporaryProject();
  const artifactDir = runFixture(root, { slug: "event-source", runId: "event-source-run" });
  assert.throws(
    () => addValidatedFact(root, {
      section: "Architecture",
      key: "Run policy",
      value: "event sourced",
      sourceType: "RUN_EVENT",
      sourceRef: "event:not-real",
    }),
    (error) => error instanceof ProjectKnowledgeError &&
      error.code === "RUN_EVENT_EVIDENCE_NOT_FOUND",
  );
  const eventsPath = join(artifactDir, "events.jsonl");
  const event = JSON.parse(readFileSync(eventsPath, "utf8").trim().split(/\r?\n/)[0]);
  const added = addValidatedFact(root, {
    section: "Architecture",
    key: "Run policy",
    value: "event sourced",
    sourceType: "RUN_EVENT",
    sourceRef: `event:${event.eventId}`,
    runId: event.runId,
  });
  assert.equal(added.fact.status, "VALIDATED");
  assert.equal(added.fact.evidence[0].source_ref, `event:${event.runId}:${event.eventId}`);
  event.actor = "tampered";
  writeFileSync(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
  const audit = auditKnowledgeSources(root);
  assert.deepEqual(audit.stale.map((item) => item.factId), [added.fact.id]);
});

// N-18: an events.jsonl over the scan size limit used to be skipped
// silently, so a genuine "not found" was indistinguishable from "we didn't
// even look" — a legitimate event could be reported as missing with no signal.
test("findDurableRunEvent reports which oversized logs it skipped instead of silently returning not-found", () => {
  const root = temporaryProject();
  const artifactDir = runFixture(root, { slug: "huge-run", runId: "huge-run-id" });
  const eventsPath = join(artifactDir, "events.jsonl");
  // Pad the existing durable log past the 64MB scan limit.
  const padding = Buffer.alloc(64 * 1024 * 1024 + 1024, " ");
  writeFileSync(eventsPath, Buffer.concat([readFileSync(eventsPath), padding]));

  const { event, skippedOversized } = findDurableRunEvent(root, "event:anything", "huge-run-id");
  assert.equal(event, null);
  assert.equal(skippedOversized.length, 1);
  assert.equal(skippedOversized[0].path, eventsPath);
  assert.ok(skippedOversized[0].size > 64 * 1024 * 1024);

  assert.throws(
    () => addValidatedFact(root, {
      section: "Architecture",
      key: "Run policy",
      value: "event sourced",
      sourceType: "RUN_EVENT",
      sourceRef: "event:anything",
      runId: "huge-run-id",
    }),
    (error) => error instanceof ProjectKnowledgeError &&
      error.code === "RUN_EVENT_EVIDENCE_NOT_FOUND" &&
      /skipped and not searched/.test(error.message) &&
      /false negative/.test(error.message),
  );
});

test("conflicting facts are quarantined and excluded from always-on memory", () => {
  const root = temporaryProject();
  writeFileSync(join(root, "a.json"), "{}\n", "utf8");
  writeFileSync(join(root, "b.json"), "{}\n", "utf8");
  addValidatedFact(root, {
    section: "Conventions",
    key: "JSON casing",
    value: "camelCase",
    sourceType: "FILE",
    sourceRef: "a.json",
  });
  const conflict = addValidatedFact(root, {
    section: "Conventions",
    key: "JSON casing",
    value: "PascalCase",
    sourceType: "FILE",
    sourceRef: "b.json",
  });
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.fact.status, "CONFLICT");
  const memory = renderProjectMemory(root);
  const content = readFileSync(memory.path, "utf8");
  assert.match(content, /camelCase/);
  assert.doesNotMatch(content, /PascalCase/);
});

test("changed evidence makes a fact stale and removes it from the projection", () => {
  const root = temporaryProject();
  const source = join(root, "settings.json");
  writeFileSync(source, '{"port":7000}\n', "utf8");
  addValidatedFact(root, {
    section: "Conventions",
    key: "API port",
    value: 7000,
    sourceType: "FILE",
    sourceRef: "settings.json",
  });
  writeFileSync(source, '{"port":7100}\n', "utf8");
  const audit = auditKnowledgeSources(root);
  assert.equal(audit.stale.length, 1);
  assert.equal(listFacts(root, { status: "STALE" }).length, 1);
  const memory = renderProjectMemory(root);
  assert.doesNotMatch(readFileSync(memory.path, "utf8"), /API port/);
});

test("history projection is idempotent and FTS5 retrieves failures", () => {
  const root = temporaryProject();
  const artifactDir = runFixture(root, { runId: "nuget-run" });
  updateTaskStatus(artifactDir, "BE-01", "BLOCKED", {
    projectRoot: root,
    executor: "codex",
    reasonCode: "NU1301",
    reason: "NuGet network sandbox blocked dependency restore",
  });
  projectRunHistory(root, artifactDir);
  projectRunHistory(root, artifactDir);
  const result = searchHistory(root, "NU1301");
  assert.ok(result.count >= 1);
  assert.equal(result.results[0].run_id, "nuget-run");
  const status = historyStatus(root);
  assert.equal(status.counts.runs, 1);
  assert.equal(status.counts.tasks, 1);
  assert.equal(status.counts.failures, 1);
});

test("malformed GRAPH evidence is rejected before corroboration is even considered", () => {
  const root = temporaryProject();

  assert.throws(
    () => addValidatedFact(root, {
      section: "Architecture",
      key: "Graph missing fields",
      value: "demo",
      sourceType: "GRAPH",
      sourceRef: "graph:acme-web:search_graph",
      evidence: { projectId: "acme-web", tool: "search_graph" },
    }),
    (error) => error instanceof ProjectKnowledgeError &&
      error.code === "GRAPH_EVIDENCE_PAYLOAD_INVALID" &&
      error.details.missing.includes("queriedAt") &&
      error.details.missing.includes("resultDigest"),
  );

  assert.throws(
    () => addValidatedFact(root, {
      section: "Architecture",
      key: "Graph bad ref",
      value: "demo",
      sourceType: "GRAPH",
      sourceRef: "graph:acme-web:search_graph",
      evidence: {
        projectId: "other-project",
        tool: "search_graph",
        queriedAt: "2026-02-14T18:07:02Z",
        resultDigest: "abc123",
      },
    }),
    (error) => error instanceof ProjectKnowledgeError &&
      error.code === "GRAPH_EVIDENCE_SOURCE_REF_INVALID" &&
      error.details.expected === "graph:other-project:search_graph",
  );

  assert.deepEqual(listFacts(root), []);
});

test("a graph-sourced fact alone is rejected, and is accepted once corroborated", () => {
  const root = temporaryProject();
  writeFileSync(join(root, "package.json"), '{"name":"demo","type":"module"}\n', "utf8");

  const graphOnly = {
    section: "Architecture",
    key: "Graph fact",
    value: "demo service depends on postgres",
    sourceType: "GRAPH",
    sourceRef: "graph:acme-web:search_graph",
    evidence: {
      projectId: "acme-web",
      tool: "search_graph",
      queriedAt: "2026-02-14T18:07:02Z",
      resultDigest: "abc123",
    },
  };
  assert.throws(
    () => addValidatedFact(root, graphOnly),
    (error) => error instanceof ProjectKnowledgeError &&
      error.code === "GRAPH_EVIDENCE_REQUIRES_CORROBORATION" &&
      error.details.graphSourceRefs.includes("graph:acme-web:search_graph"),
  );
  assert.deepEqual(listFacts(root), []);

  const added = addValidatedFact(root, {
    ...graphOnly,
    corroboration: { sourceType: "FILE", sourceRef: "package.json" },
  });
  assert.equal(added.fact.status, "VALIDATED");
  const kinds = added.fact.evidence.map((entry) => entry.kind);
  assert.deepEqual(kinds.sort(), ["FILE", "GRAPH"]);
  const graphEvidence = added.fact.evidence.find((entry) => entry.kind === "GRAPH");
  assert.equal(graphEvidence.payload.projectId, "acme-web");
  assert.equal(graphEvidence.payload.queriedAt, "2026-02-14T18:07:02Z");
});

test("history can be fully rebuilt from durable run events", () => {
  const root = temporaryProject();
  runFixture(root, { slug: "first", runId: "first-run" });
  runFixture(root, { slug: "second", runId: "second-run" });
  const projected = projectAllHistory(root);
  assert.equal(projected.errors.length, 0);
  assert.equal(projected.projected.length, 2);
  const rebuilt = rebuildHistory(root, { failFast: true });
  assert.equal(rebuilt.projected.length, 2);
  assert.equal(historyStatus(root).counts.runs, 2);
});
