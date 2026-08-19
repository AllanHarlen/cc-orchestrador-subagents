import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import fc from "fast-check";

import { MCP_SERVER_NAMES } from "../skills/orchestrator-multi-agent-development/scripts/lib/mcp-detect.mjs";
import {
  DEFAULT_PROJECT_CONFIG,
  PROJECT_CONFIG_RELATIVE_PATH,
  ROLES,
  deriveRequiredCliSet,
  writeProjectConfig,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/project-config.mjs";

/**
 * Testes de propriedade do preflight condicionado pela Project_Config.
 *
 * Uma propriedade do design por teste, cada uma com o comentario de tag e o
 * minimo de 100 iteracoes. As proximas propriedades deste arquivo (Property 9, a
 * obrigatoriedade condicional de CLI, e Property 10, o bloco `projectConfig` do
 * relatorio) reaproveitam os helpers da secao de fixtures e entram na secao de
 * propriedades, na ordem do design.
 *
 * O sujeito do teste e o **relatorio real** do preflight: `preflight.mjs` monta
 * o relatorio no topo do modulo e sai com codigo de processo, entao a unica
 * forma honesta de exercita-lo e rodar o script. Para nao pagar um processo por
 * iteracao, cada ambiente distinto e montado e rodado **uma vez** (pool de
 * fixtures pre-computado, `POOL`), e a propriedade sorteia dentro desse pool.
 *
 * O ambiente e isolado: `cwd` em diretorio temporario, `HOME`/`USERPROFILE`
 * apontando para um HOME temporario e `PATH` reduzido a um diretorio vazio. Com
 * isso a presenca ou ausencia de cada MCP e decidida somente pelos arquivos que
 * a fixture semeia, sem depender da maquina e sem I/O de rede.
 */

const NUM_RUNS = 200;

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PREFLIGHT = join(
  REPO_ROOT,
  "skills",
  "orchestrator-multi-agent-development",
  "scripts",
  "preflight.mjs",
);

/** Stack sem CLI externa: mantem todo item obrigatorio aprovado nesta maquina. */
const CLAUDE_CODE_ONLY = Object.freeze({
  backendExecutor: "claude-code",
  frontendExecutor: "claude-code",
  backendReviewer: "claude-code",
  frontendReviewer: "claude-code",
});

/** Marcador de servidor que a deteccao procura no conteudo da configuracao. */
const MCP_MARKER = Object.freeze({
  "codebase-memory": "codebase-memory",
  context7: "context7",
});

/**
 * Localizacoes de configuracao MCP usadas para semear presenca. Todas constam da
 * lista inspecionada pela deteccao (Req 1.3).
 */
const SEED_LOCATIONS = Object.freeze({
  project: ({ projectRoot }) => join(projectRoot, ".mcp.json"),
  "home-claude-json": ({ home }) => join(home, ".claude.json"),
  "home-claude-mcp": ({ home }) => join(home, ".claude", "mcp.json"),
});

/** Arquivo ilegivel (JSON invalido) com os dois marcadores: evidencia que nao conta. */
const UNREADABLE_LOCATION = ({ home }) => join(home, ".gemini", "config", "mcp_config.json");

/* -------------------------------------------------------------------------- */
/* Fixtures de ambiente                                                        */
/* -------------------------------------------------------------------------- */

const TEMP_ROOTS = [];

after(() => {
  for (const root of TEMP_ROOTS) rmSync(root, { recursive: true, force: true });
});

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}

/** Bloco `mcpServers` com um marcador por servidor semeado. */
function mcpServersBlock(servers) {
  return {
    mcpServers: Object.fromEntries(
      servers.map((server) => [MCP_MARKER[server], { command: MCP_MARKER[server] }]),
    ),
  };
}

/**
 * Monta um projeto isolado: raiz temporaria, HOME temporario, `PATH` vazio e
 * Project_Config_File gravado a partir de `roles`.
 *
 * `seed` recebe `{ projectRoot, home }` e semeia os arquivos da fixture.
 */
function createIsolatedProject({ roles = CLAUDE_CODE_ONLY, seed = () => {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "preflight-config-"));
  TEMP_ROOTS.push(root);

  const projectRoot = join(root, "project");
  const home = join(root, "home");
  const emptyPath = join(root, "empty-path");
  for (const directory of [projectRoot, home, emptyPath]) {
    mkdirSync(directory, { recursive: true });
  }

  if (roles !== null) {
    writeProjectConfig(projectRoot, roles, { now: "2026-02-14T18:05:31Z" });
  }
  seed({ projectRoot, home });

  return { root, projectRoot, home, emptyPath };
}

/** Roda o preflight no ambiente isolado e devolve `{ report, exitCode }`. */
function runPreflight(environment) {
  const result = spawnSync(process.execPath, [PREFLIGHT], {
    cwd: environment.projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: environment.home,
      USERPROFILE: environment.home,
      PATH: environment.emptyPath,
      Path: environment.emptyPath,
    },
  });

  assert.equal(
    typeof result.stdout,
    "string",
    `preflight nao produziu stdout: ${result.error?.message ?? "sem erro"}`,
  );

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `relatorio de preflight nao e JSON (${error.message}): ${result.stdout.slice(0, 400)}`,
    );
  }

  return { report, exitCode: result.status };
}

/* -------------------------------------------------------------------------- */
/* Pool de cenarios de MCP                                                     */
/* -------------------------------------------------------------------------- */

/** Subconjuntos dos dois MCPs, do vazio ao completo. */
const PRESENT_SUBSETS = Object.freeze([
  [],
  ["codebase-memory"],
  ["context7"],
  ["codebase-memory", "context7"],
]);

const LOCATION_KEYS = Object.freeze(Object.keys(SEED_LOCATIONS));

/**
 * Cenario de MCP: quais servidores estao presentes, em que localizacao o
 * marcador foi semeado e se existe um arquivo de configuracao ilegivel.
 *
 * A chave dedupe cenarios equivalentes — sem servidor presente a localizacao nao
 * tem efeito.
 */
function mcpScenarios() {
  const scenarios = new Map();

  for (const present of PRESENT_SUBSETS) {
    for (const location of LOCATION_KEYS) {
      for (const unreadable of [false, true]) {
        const effectiveLocation = present.length === 0 ? "none" : location;
        const key = `${present.join("+") || "none"}|${effectiveLocation}|${unreadable ? "unreadable" : "clean"}`;
        if (scenarios.has(key)) continue;
        scenarios.set(key, { key, present, location: effectiveLocation, unreadable });
      }
    }
  }

  return [...scenarios.values()];
}

/** Semeia o cenario e roda o preflight uma unica vez. */
function buildScenarioFixture(scenario) {
  const environment = createIsolatedProject({
    seed: ({ projectRoot, home }) => {
      if (scenario.present.length > 0) {
        const path = SEED_LOCATIONS[scenario.location]({ projectRoot, home });
        writeJson(path, mcpServersBlock(scenario.present));
      }
      if (scenario.unreadable) {
        const path = UNREADABLE_LOCATION({ projectRoot, home });
        // JSON truncado de proposito: os marcadores estao la, mas o arquivo e
        // ilegivel, entao nao vale como evidencia de presenca (Req 1.8).
        writeText(path, '{ "mcpServers": { "codebase-memory": {}, "context7": {\n');
      }
    },
  });

  const { report, exitCode } = runPreflight(environment);
  const configPath = join(environment.projectRoot, ".orchestrator", "project-config.md");

  return {
    scenario,
    report,
    exitCode,
    absent: MCP_SERVER_NAMES.filter((name) => !scenario.present.includes(name)),
    configContent: existsSync(configPath) ? readFileSync(configPath, "utf8") : null,
  };
}

/**
 * Pool pre-computado: um preflight real por ambiente distinto. A propriedade
 * sorteia dentro do pool, de modo que o numero de processos fica limitado ao
 * numero de cenarios, nao ao numero de iteracoes.
 */
const POOL = mcpScenarios().map(buildScenarioFixture);

/* -------------------------------------------------------------------------- */
/* Geradores                                                                   */
/* -------------------------------------------------------------------------- */

/** Um cenario de MCP do pool, com o relatorio real que ele produziu. */
function arbMcpFixture() {
  return fc.constantFrom(...POOL);
}

/* -------------------------------------------------------------------------- */
/* Propriedades                                                                */
/* -------------------------------------------------------------------------- */

// Feature: orchestrator-mcp-agent-config, Property 7: MCP ausente e aviso, nunca bloqueio
// Para qualquer relatorio de preflight em que todos os itens obrigatorios estao aprovados e qualquer
// subconjunto dos dois MCPs esta ausente, `status` e `ok`, cada MCP ausente aparece em `warnings` e
// nenhum MCP aparece em `failed`.
//
// **Validates: Requirements 1.7**
test("Property 7: MCP ausente e aviso, nunca bloqueio", () => {
  fc.assert(
    fc.property(arbMcpFixture(), (fixture) => {
      const { report, scenario } = fixture;
      const mcpChecks = report.checks.optional.mcp;

      // Premissa da propriedade: nenhum item obrigatorio reprovado.
      assert.deepEqual(report.failed, [], `${scenario.key}: item obrigatorio reprovado`);

      // A fixture realmente exercita ausencia: presenca vem so dos arquivos semeados.
      for (const name of MCP_SERVER_NAMES) {
        assert.equal(
          mcpChecks[name].ok,
          scenario.present.includes(name),
          `${scenario.key}: presenca inesperada de ${name}`,
        );
        assert.equal(mcpChecks[name].optional, true, `${scenario.key}: ${name} nao e opcional`);
        assert.notEqual(mcpChecks[name].required, true, `${scenario.key}: ${name} marcado obrigatorio`);
      }

      // Ausencia de MCP nao muda o veredito do preflight nem o codigo de saida.
      assert.equal(report.status, "ok", `${scenario.key}: status diferente de ok`);
      assert.equal(fixture.exitCode, 0, `${scenario.key}: exit code diferente de 0`);
      assert.ok(report.warnings.length > 0, `${scenario.key}: relatorio sem aviso`);
      assert.equal(report.remediation, null, `${scenario.key}: remediacao para relatorio aprovado`);

      const mcpWarnings = report.warnings.filter((warning) => warning.category === "mcp");
      assert.deepEqual(
        mcpWarnings.map((warning) => warning.name).sort(),
        [...fixture.absent].sort(),
        `${scenario.key}: avisos de MCP nao correspondem aos MCPs ausentes`,
      );

      for (const warning of mcpWarnings) {
        assert.equal(warning.required, false, `${scenario.key}: aviso de MCP marcado obrigatorio`);
        assert.ok(
          ["NOT_DETECTED", "TIMEOUT"].includes(warning.reason),
          `${scenario.key}: motivo inesperado ${warning.reason}`,
        );
      }

      // Nenhum MCP atravessa para `failed`, por nome ou por categoria.
      for (const failure of report.failed) {
        assert.notEqual(failure.category, "mcp", `${scenario.key}: MCP em failed`);
        assert.ok(
          !MCP_SERVER_NAMES.includes(failure.name),
          `${scenario.key}: ${failure.name} em failed`,
        );
      }
    }),
    { numRuns: NUM_RUNS },
  );
});

/* -------------------------------------------------------------------------- */
/* Pool de cenarios de papeis (Property 9 e Property 10)                       */
/* -------------------------------------------------------------------------- */

/**
 * Configuracoes de papeis representativas, cobrindo os quatro quadrantes de
 * `{ codexRequired, agyRequired }` — inclusive por papeis diferentes do
 * executor (Property 9 nao depende de qual papel exige a CLI, so de que algum
 * papel exige) — mais a ausencia de arquivo (Req 5.6, fallback ao default).
 *
 * `roles: null` significa "nao gravar Project_Config_File".
 */
const ROLE_SCENARIOS = Object.freeze([
  {
    name: "todos claude-code",
    roles: {
      backendExecutor: "claude-code",
      frontendExecutor: "claude-code",
      backendReviewer: "claude-code",
      frontendReviewer: "claude-code",
    },
  },
  {
    name: "codex via backendExecutor",
    roles: {
      backendExecutor: "codex",
      frontendExecutor: "claude-code",
      backendReviewer: "claude-code",
      frontendReviewer: "claude-code",
    },
  },
  {
    name: "codex via backendReviewer apenas",
    roles: {
      backendExecutor: "claude-code",
      frontendExecutor: "claude-code",
      backendReviewer: "codex",
      frontendReviewer: "claude-code",
    },
  },
  {
    name: "agy via frontendExecutor",
    roles: {
      backendExecutor: "claude-code",
      frontendExecutor: "agy",
      backendReviewer: "claude-code",
      frontendReviewer: "claude-code",
    },
  },
  {
    name: "agy via frontendReviewer apenas",
    roles: {
      backendExecutor: "claude-code",
      frontendExecutor: "claude-code",
      backendReviewer: "claude-code",
      frontendReviewer: "agy",
    },
  },
  {
    name: "stack padrao (codex e agy)",
    roles: { ...DEFAULT_PROJECT_CONFIG },
  },
  {
    name: "mistura invertida",
    roles: {
      backendExecutor: "claude-code",
      frontendExecutor: "claude-code",
      backendReviewer: "agy",
      frontendReviewer: "codex",
    },
  },
  {
    name: "arquivo ausente",
    roles: null,
  },
]);

/** Monta o cenario de papeis e roda o preflight uma unica vez. */
function buildRoleFixture(scenario) {
  const environment = createIsolatedProject({ roles: scenario.roles });
  const { report, exitCode } = runPreflight(environment);
  const effectiveRoles = scenario.roles ?? DEFAULT_PROJECT_CONFIG;
  return {
    scenario,
    report,
    exitCode,
    requiredCliSet: deriveRequiredCliSet(effectiveRoles),
    effectiveRoles,
  };
}

const ROLE_POOL = ROLE_SCENARIOS.map(buildRoleFixture);

/** Um cenario de papeis do pool, com o relatorio real que ele produziu. */
function arbRoleFixture() {
  return fc.constantFrom(...ROLE_POOL);
}

/** Localiza um check no relatorio, dentro de `checks.<group>`. */
function findCheck(report, group, name) {
  return report.checks[group][name];
}

/** Localiza a entrada de `failed`/`warnings` para `category:name`, se existir. */
function findEntry(list, category, name) {
  return list.find((entry) => entry.category === category && entry.name === name);
}

/* -------------------------------------------------------------------------- */
/* Propriedades (continuacao)                                                  */
/* -------------------------------------------------------------------------- */

// Feature: orchestrator-mcp-agent-config, Property 9: CLI obrigatoria se e somente se algum papel a exige
// Para qualquer Project_Config, a verificacao `cli.codex` e `plugins.openai-codex` e obrigatoria se e
// somente se ao menos um dos quatro papeis e `codex`; `cli.agy` e `plugins.cc-antigravity-plugin` sao
// obrigatorias se e somente se ao menos um papel e `agy`; `runtime.node-sqlite-fts5` e obrigatoria em
// toda configuracao; item reprovado e obrigatorio aparece em `failed`, e item reprovado e nao
// obrigatorio aparece em `warnings` com motivo `NOT_REQUIRED_BY_PROJECT_CONFIG`.
//
// **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.8**
test("Property 9: CLI obrigatoria se e somente se algum papel a exige", () => {
  fc.assert(
    fc.property(arbRoleFixture(), (fixture) => {
      const { report, scenario, requiredCliSet } = fixture;
      const label = scenario.name;

      // `runtime.node-sqlite-fts5` e obrigatorio em qualquer configuracao (Req 5.8),
      // e como o ambiente de teste roda o proprio Node que hospeda os testes, o
      // check e aprovado e nunca aparece em `failed`.
      const runtimeCheck = findCheck(report, "runtime", "node-sqlite-fts5");
      assert.equal(runtimeCheck.required, true, `${label}: runtime deveria ser obrigatorio`);
      assert.equal(
        findEntry(report.failed, "runtime", "node-sqlite-fts5"),
        undefined,
        `${label}: runtime reprovado inesperadamente`,
      );

      for (const [cliName, pluginName, requiredFlag] of [
        ["codex", "openai-codex", requiredCliSet.codex],
        ["agy", "cc-antigravity-plugin", requiredCliSet.agy],
      ]) {
        const cliCheck = findCheck(report, "cli", cliName);
        const pluginCheck = findCheck(report, "plugins", pluginName);

        // A obrigatoriedade anunciada no relatorio e exatamente a derivacao
        // (Req 5.1 a 5.5): nenhuma logica paralela decide isso no script.
        assert.equal(cliCheck.required, requiredFlag, `${label}: cli.${cliName}.required`);
        assert.equal(
          pluginCheck.required,
          requiredFlag,
          `${label}: plugins.${pluginName}.required`,
        );

        // PATH vazio e nenhum cache de plugin: os dois checks reprovam nesta
        // maquina isolada, entao a obrigatoriedade decide sozinha o destino.
        assert.equal(cliCheck.ok, false, `${label}: cli.${cliName} deveria reprovar no ambiente isolado`);
        assert.equal(
          pluginCheck.ok,
          false,
          `${label}: plugins.${pluginName} deveria reprovar no ambiente isolado`,
        );

        if (requiredFlag) {
          assert.ok(
            findEntry(report.failed, "cli", cliName),
            `${label}: cli.${cliName} obrigatorio deveria estar em failed`,
          );
          assert.ok(
            findEntry(report.failed, "plugin", pluginName),
            `${label}: plugins.${pluginName} obrigatorio deveria estar em failed`,
          );
          assert.equal(report.status, "failed", `${label}: status deveria ser failed`);
          assert.notEqual(fixture.exitCode, 0, `${label}: exit code deveria ser diferente de 0`);
        } else {
          const cliWarning = findEntry(report.warnings, "cli", cliName);
          const pluginWarning = findEntry(report.warnings, "plugin", pluginName);
          assert.ok(cliWarning, `${label}: cli.${cliName} nao obrigatorio deveria estar em warnings`);
          assert.ok(
            pluginWarning,
            `${label}: plugins.${pluginName} nao obrigatorio deveria estar em warnings`,
          );
          assert.equal(cliWarning.reason, "NOT_REQUIRED_BY_PROJECT_CONFIG", `${label}: motivo de cli.${cliName}`);
          assert.equal(
            pluginWarning.reason,
            "NOT_REQUIRED_BY_PROJECT_CONFIG",
            `${label}: motivo de plugins.${pluginName}`,
          );
          assert.equal(
            findEntry(report.failed, "cli", cliName),
            undefined,
            `${label}: cli.${cliName} nao deveria estar em failed`,
          );
          assert.equal(
            findEntry(report.failed, "plugin", pluginName),
            undefined,
            `${label}: plugins.${pluginName} nao deveria estar em failed`,
          );
        }
      }
    }),
    { numRuns: NUM_RUNS },
  );
});

// Feature: orchestrator-mcp-agent-config, Property 10: Bloco `projectConfig` do relatorio reflete o arquivo e a origem
// Para qualquer Project_Config gravada no Project_Config_File, o bloco `projectConfig` do relatorio de
// preflight traz os quatro papeis iguais aos do arquivo e `source` igual a `file`; na ausencia do
// arquivo, traz os papeis `codex`/`agy`/`codex`/`agy` e `source` igual a `default`.
//
// **Validates: Requirements 5.6, 5.9**
test("Property 10: bloco projectConfig reflete o arquivo e a origem", () => {
  fc.assert(
    fc.property(arbRoleFixture(), (fixture) => {
      const { report, scenario, effectiveRoles, requiredCliSet } = fixture;
      const label = scenario.name;
      const block = report.projectConfig;

      assert.equal(block.path, PROJECT_CONFIG_RELATIVE_PATH, `${label}: path`);
      assert.equal(block.source, scenario.roles === null ? "default" : "file", `${label}: source`);

      for (const role of ROLES) {
        assert.equal(block.roles[role], effectiveRoles[role], `${label}: papel ${role}`);
      }

      assert.deepEqual(
        [...block.requiredCliSet].sort(),
        [...requiredCliSet.clis].sort(),
        `${label}: requiredCliSet do bloco projectConfig`,
      );

      if (scenario.roles === null) {
        assert.deepEqual(block.roles, DEFAULT_PROJECT_CONFIG, `${label}: default sem arquivo`);
        assert.equal(block.updatedAt, null, `${label}: updatedAt sem arquivo`);
      } else {
        assert.notEqual(block.updatedAt, null, `${label}: updatedAt deveria vir do arquivo`);
      }
    }),
    { numRuns: NUM_RUNS },
  );
});
