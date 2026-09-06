import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test, { after } from "node:test";

import fc from "fast-check";

import {
  CATEGORY_ROLE,
  EXECUTORS,
  TASK_CATEGORIES,
  resolveExecutorForCategory,
  writeProjectConfig,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/project-config.mjs";
import { arbProjectConfig, arbRoles } from "./helpers/project-config-arbitraries.mjs";
import {
  codexModelForRole,
  codexRoleForTask,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/codex-router.mjs";

/**
 * Testes de propriedade do roteamento derivado da Project_Config.
 *
 * Uma propriedade do design por teste, cada uma com o comentario de tag e o
 * minimo de 100 iteracoes. Novas propriedades de roteamento (Property 12, o
 * acordo entre validador e derivacao) sao adicionadas neste arquivo, na ordem do
 * design; os geradores especificos de roteamento ficam na secao abaixo para nao
 * disputar o helper compartilhado de configuracao.
 */

const NUM_RUNS = 200;

/* -------------------------------------------------------------------------- */
/* Geradores de roteamento                                                     */
/* -------------------------------------------------------------------------- */

/** Uma categoria de task reconhecida pelo roteamento. */
function arbTaskCategory() {
  return fc.constantFrom(...TASK_CATEGORIES);
}

/**
 * A mesma categoria, apresentada de forma equivalente: com espacos em volta e
 * em caixa arbitraria. A derivacao normaliza a categoria antes de decidir, entao
 * o Executor derivado nao pode depender dessa forma.
 */
function arbCategoryWithNoise() {
  return arbTaskCategory().chain((category) =>
    fc
      .record({
        before: fc.constantFrom("", " ", "  ", "\t"),
        after: fc.constantFrom("", " ", "\t"),
        casing: fc.constantFrom("as-is", "as-is", "lower", "upper"),
      })
      .map((noise) => {
        const cased =
          noise.casing === "lower"
            ? category.toLowerCase()
            : noise.casing === "upper"
              ? category.toUpperCase()
              : category;
        return { category, presented: `${noise.before}${cased}${noise.after}` };
      }),
  );
}

/* -------------------------------------------------------------------------- */
/* Propriedades                                                                */
/* -------------------------------------------------------------------------- */

// Feature: orchestrator-mcp-agent-config, Property 11: Executor derivado da categoria e da configuracao
// Para qualquer Project_Config e qualquer categoria de task, o Executor derivado e o papel
// correspondente da configuracao — `backendExecutor` para `BACKEND_ONLY` e `DATABASE_ONLY`,
// `frontendExecutor` para `FRONTEND_ONLY`, e o par (`backendExecutor`, `frontendExecutor`) para as
// fatias de `FULLSTACK` — e pertence sempre ao conjunto `codex`/`agy`/`claude-code`.
//
// **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
test("Property 11: executor derivado e o papel da configuracao para a categoria", () => {
  fc.assert(
    fc.property(arbProjectConfig(), arbCategoryWithNoise(), (config, { category, presented }) => {
      const derived = resolveExecutorForCategory(presented, config);

      // A derivacao e funcao da categoria normalizada, nao da forma apresentada.
      assert.equal(derived.category, category);

      if (category === "FULLSTACK") {
        // Fatia back-end e fatia front-end, cada uma com o seu papel (Req 7.4).
        assert.equal(derived.backend, config.backendExecutor);
        assert.equal(derived.frontend, config.frontendExecutor);
        assert.equal(derived.executor, undefined);
        for (const executor of [derived.backend, derived.frontend]) {
          assert.ok(
            EXECUTORS.includes(executor),
            `executor ${JSON.stringify(executor)} fora do conjunto permitido`,
          );
        }
        return;
      }

      // Categoria de um unico papel: o Executor e exatamente o valor desse papel
      // na configuracao vigente (Req 7.1, 7.2, 7.3).
      const role = CATEGORY_ROLE[category];
      assert.equal(derived.role, role);
      assert.equal(derived.executor, config[role]);
      assert.ok(
        EXECUTORS.includes(derived.executor),
        `executor ${JSON.stringify(derived.executor)} fora do conjunto permitido`,
      );
      assert.equal(derived.backend, undefined);
      assert.equal(derived.frontend, undefined);
    }),
    { numRuns: NUM_RUNS },
  );
});

/* -------------------------------------------------------------------------- */
/* Pool de artefatos de roteamento (Property 12)                               */
/* -------------------------------------------------------------------------- */

/**
 * O sujeito desta propriedade e o validador real (`validate-routing.mjs`), que
 * sai com codigo de processo. Para nao pagar um processo por iteracao, os
 * casos sao montados e rodados **uma vez** num pool pre-computado (mesmo
 * padrao de `tests/preflight-config.property.test.mjs`), e a propriedade
 * sorteia dentro desse pool.
 */
const VALIDATE_ROUTING = resolve(
  "skills/orchestrator-multi-agent-development/scripts/validate-routing.mjs",
);

const POOL_ROOTS = [];

after(() => {
  while (POOL_ROOTS.length > 0) rmSync(POOL_ROOTS.pop(), { recursive: true, force: true });
});

const SINGLE_ROLE_CATEGORIES = Object.freeze(
  TASK_CATEGORIES.filter((category) => category !== "FULLSTACK"),
);

function taskId(seed) {
  return `T${seed}`;
}

/** Linhas extras que uma escolha de executor exige para passar no validador. */
function requiredExtraLines(category, executor) {
  const lines = [];
  if (executor === "agy") {
    lines.push("- agyModel: `pro-low`");
    lines.push("- agyModelSource: `heuristic`");
  }
  if (executor === "codex") {
    // codexModel/codexModelSource sao exigidos sempre que o executor efetivo e
    // Codex, mesmo em categorias sem papel Codex conhecido (ex.: FRONTEND_ONLY
    // com frontendExecutor: codex — combinacao fora do fluxo normal de
    // AskUserQuestion, mas aceita pelo parser do Project_Config_File).
    const role = codexRoleForTask({ category }) ?? "implement";
    lines.push(`- codexModel: \`${codexModelForRole(role)}\``);
    lines.push("- codexModelSource: `heuristic`");
  }
  if (category === "REVIEW_ONLY" && executor === "codex") {
    lines.push("- assignedAgent: `codex:codex-rescue` --effort high");
  }
  if (category === "REVIEW_ONLY" && executor === "claude-code") {
    lines.push("- review record: review/review-final.md");
  }
  return lines;
}

function singleRoleBlock(id, category, executor, extra = []) {
  return [
    `## ${id} - fixture ${category}`,
    `- categoria: ${category}`,
    `- executor: ${executor}`,
    "- executorSource: project-config",
    ...requiredExtraLines(category, executor),
    ...extra,
  ].join("\n");
}

function fullstackBlock(id, config) {
  const { backend, frontend } = resolveExecutorForCategory("FULLSTACK", config);
  const lines = [
    `## ${id} - fixture FULLSTACK`,
    "- categoria: FULLSTACK",
    `- executor: ${backend}`,
  ];
  if (frontend !== backend) lines.push(`- executor: ${frontend}`);
  lines.push("- executorSource: project-config");
  if (backend === "agy" || frontend === "agy") {
    lines.push("- agyModel: `pro-low`");
    lines.push("- agyModelSource: `heuristic`");
  }
  if (backend === "codex" || frontend === "codex") {
    lines.push(`- codexModel: \`${codexModelForRole(codexRoleForTask({ category: "FULLSTACK" }))}\``);
    lines.push("- codexModelSource: `heuristic`");
  }
  return { text: lines.join("\n"), backend, frontend };
}

/**
 * Grava a Project_Config (quando informada), tasks-classification.md e
 * waves.md com o mesmo bloco, e roda o validador uma unica vez.
 *
 * O validador infere a raiz do projeto a partir de `<root>/.orchestration/<slug>`
 * (`inferProjectRoot`), entao gravar `.orchestrator/project-config.md` na mesma
 * raiz basta para o validador resolver a Project_Config sem flags extras.
 */
function runValidatorOnBlock(blockText, config) {
  const root = mkdtempSync(join(process.cwd(), ".tmp-routing-property-"));
  POOL_ROOTS.push(root);
  if (config) writeProjectConfig(root, config, { now: config.updatedAt ?? undefined });
  const artifactDir = join(root, ".orchestration", "run");
  mkdirSync(artifactDir, { recursive: true });
  const content = ["# Fixture", "", blockText, ""].join("\n");
  writeFileSync(join(artifactDir, "tasks-classification.md"), content, "utf8");
  writeFileSync(join(artifactDir, "waves.md"), content, "utf8");
  const result = spawnSync(process.execPath, [VALIDATE_ROUTING, artifactDir], {
    encoding: "utf8",
    windowsHide: true,
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

/**
 * Casos de teste da Property 12, um por combinacao de config/categoria
 * amostrada de cada um dos quatro "tipos" (valido, executor divergente,
 * executor fora do conjunto, parametro de AGY numa task `claude-code`) — o
 * pool cobre todas as categorias, inclusive `FULLSTACK`.
 */
function buildPoolCases() {
  const cases = [];
  let seed = 0;

  // Valido: artefato gerado a partir do Executor derivado, para toda
  // categoria (incluindo FULLSTACK), sobre uma amostra de configuracoes.
  for (const config of fc.sample(arbProjectConfig(), 12)) {
    for (const category of TASK_CATEGORIES) {
      seed += 1;
      const id = taskId(seed);
      const blockText = category === "FULLSTACK"
        ? fullstackBlock(id, config).text
        : singleRoleBlock(id, category, resolveExecutorForCategory(category, config).executor);
      cases.push({ kind: "valid", id, category, config, blockText });
    }
  }

  // Executor divergente: declara um executor permitido, mas diferente do
  // derivado para a categoria (Req 7.9).
  for (const config of fc.sample(arbProjectConfig(), 8)) {
    for (const category of SINGLE_ROLE_CATEGORIES) {
      seed += 1;
      const id = taskId(seed);
      const expected = resolveExecutorForCategory(category, config).executor;
      const wrong = EXECUTORS.find((executor) => executor !== expected);
      const blockText = singleRoleBlock(id, category, wrong);
      cases.push({ kind: "divergent", id, category, config, expected, wrong, blockText });
    }
  }

  // Executor fora do conjunto permitido (Req 7.8).
  for (const category of SINGLE_ROLE_CATEGORIES) {
    seed += 1;
    const id = taskId(seed);
    const blockText = [
      `## ${id} - fixture ${category}`,
      `- categoria: ${category}`,
      "- executor: gpt-5-turbo",
      "- executorSource: project-config",
    ].join("\n");
    cases.push({ kind: "unknown-executor", id, category, blockText });
  }

  // Parametro de AGY declarado numa task cujo Executor derivado e
  // `claude-code` (Req 7.8).
  for (const category of SINGLE_ROLE_CATEGORIES) {
    for (const roles of fc.sample(arbRoles(), 3)) {
      seed += 1;
      const id = taskId(seed);
      const role = CATEGORY_ROLE[category];
      const config = { ...roles, [role]: "claude-code" };
      const blockText = singleRoleBlock(id, category, "claude-code", [
        "- agyModel: `pro-low`",
      ]);
      cases.push({ kind: "agy-params-claude-code", id, category, config, blockText });
    }
  }

  return cases;
}

const ROUTING_POOL = buildPoolCases().map((testCase) => ({
  ...testCase,
  result: runValidatorOnBlock(testCase.blockText, testCase.config),
}));

function arbRoutingCase() {
  return fc.constantFrom(...ROUTING_POOL);
}

// Feature: orchestrator-mcp-agent-config, Property 12: Validador de roteamento concorda com a derivacao
// Para qualquer Project_Config e qualquer conjunto de tasks, os artefatos de plano gerados a partir do
// Executor derivado, com `executor` e `executorSource: project-config` por task, sao aprovados pelo
// validador; e o validador reprova artefato cujo `executor` divirja do derivado para a categoria, cujo
// `executor` esteja fora do conjunto permitido, ou que registre `agyModel`, `agyParallel` ou
// `agySubagentModel` numa task cujo Executor derivado e `claude-code`.
//
// **Validates: Requirements 7.5, 7.8, 7.9**
test("Property 12: validador de roteamento concorda com a derivacao", () => {
  fc.assert(
    fc.property(arbRoutingCase(), (testCase) => {
      const label = `${testCase.kind}/${testCase.category}/${testCase.id}`;

      if (testCase.kind === "valid") {
        assert.equal(testCase.result.status, 0, `${label}: ${testCase.result.output}`);
        return;
      }

      assert.equal(testCase.result.status, 1, `${label}: deveria reprovar — ${testCase.result.output}`);
      assert.ok(
        testCase.result.output.includes(testCase.id),
        `${label}: erro nao identifica a task — ${testCase.result.output}`,
      );

      if (testCase.kind === "divergent") {
        assert.match(testCase.result.output, /deriva/, `${label}: erro deveria explicar a divergencia`);
      }
      if (testCase.kind === "unknown-executor") {
        assert.match(
          testCase.result.output,
          /declara executor invalido/,
          `${label}: erro deveria nomear o executor invalido`,
        );
      }
      if (testCase.kind === "agy-params-claude-code") {
        assert.match(
          testCase.result.output,
          /Omita agyModel, agyParallel e agySubagentModel/,
          `${label}: erro deveria pedir a omissao dos parametros de AGY`,
        );
      }
    }),
    { numRuns: NUM_RUNS },
  );
});
