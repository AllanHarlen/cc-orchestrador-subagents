import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import fc from "fast-check";

import {
  CORROBORATING_SOURCE_TYPES,
  GRAPH_EVIDENCE_FIELDS,
  ProjectKnowledgeError,
  addValidatedFact,
  listFacts,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/project-knowledge.mjs";

/**
 * Teste de propriedade da corroboracao de fato de grafo (Property 20 do design).
 *
 * O modulo sob teste grava em `.orchestrator/knowledge.db` via `node:sqlite`, entao cada
 * propriedade roda sobre um projeto temporario semeado com os artefatos que as demais fontes
 * de evidencia exigem: arquivos para `FILE`/`CONTRACT` e um `events.jsonl` durável para
 * `RUN_EVENT`. Sem mocks: o insumo e o estado real do store.
 *
 * Os geradores ficam neste arquivo porque descrevem evidencia de grafo, um insumo que nenhum
 * outro teste consome.
 */

const NUM_RUNS = 150;

const roots = [];

/** Ferramentas de grafo do CBM_MCP que podem originar um fato de projeto. */
const GRAPH_TOOLS = Object.freeze([
  "search_graph",
  "trace_path",
  "get_architecture",
  "get_graph_schema",
  "get_code_snippet",
  "detect_changes",
  "query_graph",
]);

/** Arquivos semeados no projeto, usados como evidencia `FILE` e `CONTRACT`. */
const FILE_FIXTURES = Object.freeze(["package.json", "src/app.mjs"]);
const CONTRACT_FIXTURES = Object.freeze(["contracts/be-01.md", "contracts/fe-01.md"]);

/** Eventos duráveis semeados em `.orchestration/<slug>/events.jsonl`. */
const RUN_EVENT_FIXTURES = Object.freeze([
  { runId: "demo-run", eventId: "ev-0001" },
  { runId: "demo-run", eventId: "ev-0002" },
]);

/** Status que o store aceita como teste aprovado. */
const PASSING_TEST_STATUSES = Object.freeze(["PASS", "PASSED", "SUCCESS", "OK"]);

let factSequence = 0;

/**
 * Projeto temporario com os artefatos de evidencia. Um projeto por propriedade: as chaves de
 * fato sao unicas por iteracao, entao nenhuma iteracao corrobora a fingerprint de outra.
 */
function temporaryProject() {
  const root = mkdtempSync(join(process.cwd(), ".tmp-knowledge-graph-"));
  roots.push(root);
  writeFileSync(join(root, "package.json"), '{"name":"demo","type":"module"}\n', "utf8");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.mjs"), "export const app = () => 'demo';\n", "utf8");
  mkdirSync(join(root, "contracts"), { recursive: true });
  for (const path of CONTRACT_FIXTURES) {
    writeFileSync(join(root, path), `# Contract ${path}\n\n- status: draft\n`, "utf8");
  }
  const runDir = join(root, ".orchestration", "demo");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "events.jsonl"),
    `${RUN_EVENT_FIXTURES.map((event) =>
      JSON.stringify({ ...event, type: "TASK_COMPLETED", taskId: "BE-01", at: "2026-02-14T18:07:02Z" }),
    ).join("\n")}\n`,
    "utf8",
  );
  return root;
}

test.afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */
/* Geradores                                                                   */
/* -------------------------------------------------------------------------- */

/** Identificador do projeto indexado, incluindo as formas com dois-pontos. */
function arbProjectId() {
  return fc.oneof(
    fc.stringMatching(/^[a-z0-9][a-z0-9._-]{0,15}$/),
    fc.constantFrom("acme:web", "org:team:service"),
  );
}

/** Timestamp da consulta ao grafo: ISO 8601 UTC ou a forma HTTP, ambas parseaveis. */
function arbQueriedAt() {
  return fc
    .record({
      instant: fc.date({
        min: new Date("2020-01-01T00:00:00Z"),
        max: new Date("2030-12-31T23:59:59Z"),
        noInvalidDate: true,
      }),
      format: fc.constantFrom("iso", "http"),
    })
    .map(({ instant, format }) =>
      format === "iso" ? instant.toISOString() : instant.toUTCString(),
    );
}

/** Evidencia `GRAPH` bem formada: `graph:<projectId>:<tool>` com os quatro campos do payload. */
function arbGraphEvidence() {
  return fc
    .record({
      projectId: arbProjectId(),
      tool: fc.constantFrom(...GRAPH_TOOLS),
      queriedAt: arbQueriedAt(),
      resultDigest: fc.stringMatching(/^[0-9a-f]{8,64}$/),
    })
    .map((graph) => ({
      ...graph,
      sourceType: "GRAPH",
      sourceRef: `graph:${graph.projectId}:${graph.tool}`,
      evidence: {
        projectId: graph.projectId,
        tool: graph.tool,
        queriedAt: graph.queriedAt,
        resultDigest: graph.resultDigest,
      },
    }));
}

/**
 * Evidencia corroborativa: `FILE`, `CONTRACT`, `TEST` aprovado ou `RUN_EVENT`, cada uma
 * apontando para um artefato real do projeto temporario.
 */
function arbCorroboration() {
  return fc.oneof(
    fc.record({
      sourceType: fc.constant("FILE"),
      sourceRef: fc.constantFrom(...FILE_FIXTURES),
    }),
    fc.record({
      sourceType: fc.constant("CONTRACT"),
      sourceRef: fc.constantFrom(...CONTRACT_FIXTURES),
    }),
    fc.record({
      sourceType: fc.constant("TEST"),
      sourceRef: fc.constantFrom("node --test tests/knowledge-history.test.mjs", "dotnet test"),
      sourceStatus: fc.constantFrom(...PASSING_TEST_STATUSES),
    }),
    fc
      .constantFrom(...RUN_EVENT_FIXTURES)
      .map((event) => ({
        sourceType: "RUN_EVENT",
        sourceRef: `event:${event.runId}:${event.eventId}`,
      })),
  );
}

/** Valor do fato: texto curto ou objeto estruturado derivado do grafo. */
function arbFactValue() {
  return fc.oneof(
    fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,30}$/),
    fc.record({
      module: fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/),
      symbols: fc.array(fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,10}$/), {
        minLength: 1,
        maxLength: 3,
      }),
    }),
  );
}

/**
 * Fato candidato: identidade unica por iteracao, evidencia de grafo e, quando
 * `corroboration` nao e `null`, uma evidencia corroborativa na mesma chamada.
 */
function arbGraphFact() {
  return fc
    .record({
      section: fc.constantFrom("Architecture", "Modules", "Dependencies", "Impact"),
      value: arbFactValue(),
      graph: arbGraphEvidence(),
      corroboration: fc.option(arbCorroboration(), { nil: null }),
    })
    .map((seed) => ({ ...seed, key: `graph-fact-${(factSequence += 1)}` }));
}

/* -------------------------------------------------------------------------- */
/* Propriedades                                                                */
/* -------------------------------------------------------------------------- */

// Feature: orchestrator-mcp-agent-config, Property 20: Fato de grafo exige corroboracao
//
// Para qualquer fato candidato a Project Memory cuja unica evidencia tenha fonte `GRAPH`, o
// registro e rejeitado; e para qualquer fato com evidencia `GRAPH` acompanhada de evidencia
// `FILE`, `CONTRACT`, `TEST` aprovado ou `RUN_EVENT`, o registro e aceito preservando `projectId`
// e o timestamp da consulta na evidencia de grafo.
//
// **Validates: Requirements 8.6, 8.11**
test("Property 20: fato de grafo exige corroboracao", () => {
  const root = temporaryProject();

  fc.assert(
    fc.property(arbGraphFact(), (candidate) => {
      const input = {
        section: candidate.section,
        key: candidate.key,
        value: candidate.value,
        sourceType: candidate.graph.sourceType,
        sourceRef: candidate.graph.sourceRef,
        evidence: candidate.graph.evidence,
        ...(candidate.corroboration ? { corroboration: candidate.corroboration } : {}),
      };

      if (candidate.corroboration === null) {
        // Grafo sozinho nao valida fato (Req 8.11).
        assert.throws(
          () => addValidatedFact(root, input),
          (error) => {
            assert.ok(error instanceof ProjectKnowledgeError);
            assert.equal(error.code, "GRAPH_EVIDENCE_REQUIRES_CORROBORATION");
            assert.deepEqual(error.details.accepted, [...CORROBORATING_SOURCE_TYPES]);
            assert.deepEqual(error.details.graphSourceRefs, [candidate.graph.sourceRef]);
            return true;
          },
        );

        // A rejeicao nao deixa fato persistido.
        const persisted = listFacts(root).filter((fact) => fact.fact_key === candidate.key);
        assert.deepEqual(persisted, []);
        return;
      }

      const result = addValidatedFact(root, input);
      assert.equal(result.created, true);
      assert.equal(result.conflict, false);
      assert.equal(result.fact.status, "VALIDATED");

      // A evidencia corroborativa entra no fato junto da evidencia de grafo.
      const kinds = result.fact.evidence.map((entry) => entry.kind);
      assert.ok(kinds.includes("GRAPH"), `fato sem evidencia GRAPH: ${kinds.join(", ")}`);
      assert.ok(
        kinds.includes(candidate.corroboration.sourceType),
        `fato sem evidencia ${candidate.corroboration.sourceType}: ${kinds.join(", ")}`,
      );

      // `projectId` e o timestamp da consulta sobrevivem na evidencia de grafo (Req 8.6),
      // tanto no retorno quanto na releitura do store.
      const stored = listFacts(root, { status: "VALIDATED" })
        .find((fact) => fact.fact_key === candidate.key);
      assert.ok(stored, `fato aceito nao encontrado no store: ${candidate.key}`);

      for (const fact of [result.fact, stored]) {
        const graph = fact.evidence.find((entry) => entry.kind === "GRAPH");
        assert.equal(graph.source_ref, candidate.graph.sourceRef);
        for (const field of GRAPH_EVIDENCE_FIELDS) {
          assert.equal(graph.payload[field], candidate.graph.evidence[field]);
        }
      }
    }),
    { numRuns: NUM_RUNS },
  );
});
