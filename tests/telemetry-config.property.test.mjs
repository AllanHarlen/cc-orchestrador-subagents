import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import fc from "fast-check";

import { EXECUTORS } from "../skills/orchestrator-multi-agent-development/scripts/lib/project-config.mjs";
import {
  initRun,
  updateTaskStatus,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/orchestration-state.mjs";
import {
  projectRunTelemetry,
  readTelemetry,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/telemetry.mjs";

/**
 * Teste de propriedade da projecao de telemetria (Property 19 do design).
 *
 * O sujeito e o `state.json` real (via `orchestration-state.mjs`) e a
 * projecao real de `telemetry.mjs`: nenhum mock. A Run e construida sobre um
 * diretorio temporario, uma task e despachada e concluida com um Executor e
 * uma `executorSource` arbitrarios, e a propriedade compara o evento
 * persistido em `telemetry.jsonl` tanto contra a forma esperada quanto contra
 * o schema publicado em `assets/telemetry-event.schema.json`.
 *
 * O checador de schema aqui e deliberadamente minimo (sem `ajv`, que nao e
 * dependencia do plugin): cobre exatamente as construcoes que o schema usa —
 * `type` (inclusive array com `"null"`), `const`, `enum`, `required`,
 * `properties`/`additionalProperties: false` em um nivel de aninhamento — o
 * suficiente para provar conformidade estrutural real, nao textual.
 */

const NUM_RUNS = 60;

const SCHEMA_PATH = fileURLToPath(
  new URL(
    "../skills/orchestrator-multi-agent-development/assets/telemetry-event.schema.json",
    import.meta.url,
  ),
);
const TELEMETRY_SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));

/** Checador minimo o suficiente para o formato flat de `telemetry-event.schema.json`. */
function matchesType(value, type) {
  if (type === "null") return value === null;
  if (type === "string") return typeof value === "string";
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  return false;
}

function assertMatchesSchema(value, schema, path) {
  assert.equal(typeof value, "object", `${path}: evento deveria ser objeto`);
  assert.ok(value !== null && !Array.isArray(value), `${path}: evento deveria ser objeto`);

  for (const key of schema.required ?? []) {
    assert.ok(Object.prototype.hasOwnProperty.call(value, key), `${path}: campo obrigatorio ausente: ${key}`);
  }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(schema.properties ?? {}, key),
        `${path}: campo fora do schema: ${key}`,
      );
    }
  }

  for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const propertyValue = value[key];
    const propertyPath = `${path}.${key}`;

    if (propertySchema.const !== undefined) {
      assert.equal(propertyValue, propertySchema.const, `${propertyPath}: esperava const ${propertySchema.const}`);
      continue;
    }
    if (propertySchema.enum !== undefined) {
      assert.ok(propertySchema.enum.includes(propertyValue), `${propertyPath}: fora do enum`);
      continue;
    }

    const types = Array.isArray(propertySchema.type) ? propertySchema.type : [propertySchema.type];
    assert.ok(
      types.some((type) => matchesType(propertyValue, type)),
      `${propertyPath}: tipo ${typeof propertyValue} nao bate com ${types.join("|")}`,
    );

    if (propertySchema.properties && propertyValue !== null) {
      assertMatchesSchema(propertyValue, propertySchema, propertyPath);
    }
  }
}

const roots = [];

function temporaryProject() {
  const root = mkdtempSync(join(process.cwd(), ".tmp-telemetry-config-"));
  roots.push(root);
  return root;
}

test.afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */
/* Geradores                                                                   */
/* -------------------------------------------------------------------------- */

/** Origens de roteamento plausiveis, incluindo a ausencia de origem registrada. */
function arbExecutorSource() {
  return fc.constantFrom("project-config", "manual-dispatch", null);
}

function arbExecutorAndSource() {
  return fc.record({
    executor: fc.constantFrom(...EXECUTORS),
    executorSource: arbExecutorSource(),
  });
}

/* -------------------------------------------------------------------------- */
/* Fixture: Run real com uma task concluida sob o Executor sorteado            */
/* -------------------------------------------------------------------------- */

let runSequence = 0;

function buildCompletedRun({ executor, executorSource }) {
  const root = temporaryProject();
  const slug = `demo-${(runSequence += 1)}`;
  const artifactDir = join(root, ".orchestration", slug);
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(
    join(artifactDir, "tasks-classification.md"),
    ["# Tasks", "", "## BE-01 - Endpoint", "- category: BACKEND_ONLY"].join("\n"),
    "utf8",
  );
  writeFileSync(join(artifactDir, "waves.md"), "# Waves\n\n## Wave 1\n- BE-01\n", "utf8");

  initRun({ projectRoot: root, artifactDir, slug, runId: `${slug}-run` });
  updateTaskStatus(artifactDir, "BE-01", "RUNNING", {
    projectRoot: root,
    executor,
    executorSource,
    sessionId: `${executor}-session`,
  });
  updateTaskStatus(artifactDir, "BE-01", "DONE", {
    projectRoot: root,
    executor,
    executorSource,
    evidence: ["executor:BE-01:DONE"],
    reviewResult: "PASS",
  });

  return { root, artifactDir };
}

/* -------------------------------------------------------------------------- */
/* Propriedade                                                                 */
/* -------------------------------------------------------------------------- */

// Feature: orchestrator-mcp-agent-config, Property 19: Telemetria projeta executor e origem do roteamento
// Para qualquer task concluida, o evento de telemetria projetado valida contra o schema de telemetria e
// traz `executor` igual ao Executor efetivo da task e `metadata.executorSource` igual a origem da
// decisao de roteamento.
//
// **Validates: Requirements 10.6**
test("Property 19: evento de telemetria projeta executor e executorSource, e valida contra o schema", () => {
  fc.assert(
    fc.property(arbExecutorAndSource(), ({ executor, executorSource }) => {
      const { root, artifactDir } = buildCompletedRun({ executor, executorSource });

      const projection = projectRunTelemetry(root, artifactDir);
      assert.ok(projection.created >= 1, "projecao deveria ter criado ao menos um evento");

      const events = readTelemetry(root).filter((event) => event.taskId === "BE-01");
      assert.ok(events.length >= 1, "nenhum evento de telemetria encontrado para BE-01");

      for (const event of events) {
        assertMatchesSchema(event, TELEMETRY_SCHEMA, `evento ${event.eventType}`);
        assert.equal(event.executor, executor, `${event.eventType}: executor projetado`);
        assert.equal(
          event.metadata?.executorSource ?? null,
          executorSource,
          `${event.eventType}: metadata.executorSource projetado`,
        );
      }

      // A projecao e idempotente: rodar de novo nao duplica nem diverge dos eventos existentes.
      const second = projectRunTelemetry(root, artifactDir);
      assert.equal(second.created, 0, "segunda projecao nao deveria criar eventos novos");
      const eventsAfter = readTelemetry(root).filter((event) => event.taskId === "BE-01");
      assert.equal(eventsAfter.length, events.length);
    }),
    { numRuns: NUM_RUNS },
  );
});
