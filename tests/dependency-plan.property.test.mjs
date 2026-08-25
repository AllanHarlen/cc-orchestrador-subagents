import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import fc from "fast-check";

import {
  CLI_PLUGIN_KEY,
  MCP_CHECK_KEYS,
  buildDependencyPlanItem,
  buildMissingDependencies,
  resolvePlatform,
  summarizeInstallOutcome,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/dependency-plan.mjs";
import {
  detectMcpServers,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/mcp-detect.mjs";
import {
  DEFAULT_PROJECT_CONFIG,
  EXECUTORS,
  ROLES,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/project-config.mjs";
import {
  TelemetryError,
  readTelemetry,
  recordTelemetry,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/telemetry.mjs";

/**
 * Testes de propriedade do plano de dependencias ausentes.
 *
 * Uma propriedade do design por teste, cada uma com o comentario de tag e o
 * minimo de 100 iteracoes. Propriedades futuras deste modulo (Property 8, a
 * redacao de segredos) entram neste mesmo arquivo, na ordem do design; os
 * geradores ficam na secao abaixo para poderem ser reaproveitados.
 *
 * Nenhum I/O: o insumo do modulo e o relatorio de preflight ja serializado,
 * gerado aqui em memoria.
 */

const NUM_RUNS = 200;

/** Nome publicado por cada check de MCP do relatorio. */
const MCP_ITEM_NAME = Object.freeze({
  "codebase-memory": "codebase-memory-mcp",
  context7: "context7",
});

/** CLIs instalaveis, na ordem canonica em que o plano as apresenta. */
const CANONICAL_CLI_ORDER = Object.freeze(["codex", "agy"]);

/** CLIs reprovadas que o plano deve ignorar por nao pertencerem ao catalogo. */
const NON_INSTALLABLE_CLIS = Object.freeze(["node", "git", "gh", "npm"]);

/** Chave de `checks.plugins` que conecta cada CLI instalavel, na ordem canonica. */
const PLUGIN_KEYS = Object.freeze(CANONICAL_CLI_ORDER.map((cli) => CLI_PLUGIN_KEY[cli]));

/** Nome publicado pelo item de plugin, indexado pela CLI que ele conecta. */
const PLUGIN_ITEM_NAME = Object.freeze({ codex: "codex-plugin-cc", agy: "cc-antigravity-plugin" });

/* -------------------------------------------------------------------------- */
/* Geradores                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Estado de um check no relatorio, incluindo as formas degradadas que um
 * relatorio parcial pode trazer. Tudo que nao e `ok: true` conta como ausente.
 */
function arbCheckState() {
  return fc.constantFrom("ok", "failed", "absent", "malformed");
}

function renderCheck(state, { optional }) {
  if (state === "ok") return { ok: true, optional, evidence: [] };
  if (state === "failed") return { ok: false, optional, error: "NOT_DETECTED" };
  if (state === "malformed") return null;
  return undefined; // "absent": a chave nem existe no relatorio
}

function assignCheck(target, key, state, options) {
  const rendered = renderCheck(state, options);
  if (rendered !== undefined) target[key] = rendered;
}

/** SO detectado: valores de `process.platform` e apelidos comuns. */
function arbPlatform() {
  return fc.constantFrom("win32", "windows", "darwin", "macos", "osx", "linux", "freebsd");
}

/** Os quatro papeis da Project_Config, cada um sobre os executores permitidos. */
function arbRoles() {
  return fc.record(Object.fromEntries(ROLES.map((role) => [role, fc.constantFrom(...EXECUTORS)])));
}

/**
 * Relatorio de preflight arbitrario.
 *
 * Varia: presenca e estado dos dois checks de MCP, estado dos checks de `cli`
 * das CLIs instalaveis, CLIs reprovadas fora do catalogo, entradas do array
 * `failed` (que um relatorio parcial pode usar em vez de `checks.cli`), e a
 * forma como a Project_Config chega ao modulo:
 *
 * - `options`: papeis passados em `options.projectConfig`;
 * - `report-roles`: papeis em `report.projectConfig.roles`;
 * - `report-flat`: papeis na raiz de `report.projectConfig`;
 * - `required-clis`: relatorio que traz so a lista derivada, sem papeis;
 * - `absent`: sem bloco `projectConfig`, o que aplica a configuracao padrao.
 *
 * Devolve `{ report, options, roles, declaredClis, configSource }`, em que
 * `roles` e `null` quando o relatorio nao permite conhecer os papeis.
 */
function arbPreflightReport() {
  return fc
    .record({
      roles: arbRoles(),
      configSource: fc.constantFrom(
        "options",
        "report-roles",
        "report-flat",
        "required-clis",
        "absent",
      ),
      declaredClis: fc.subarray([...CANONICAL_CLI_ORDER]),
      mcpStates: fc.record(
        Object.fromEntries(MCP_CHECK_KEYS.map((key) => [key, arbCheckState()])),
      ),
      cliStates: fc.record(
        Object.fromEntries(CANONICAL_CLI_ORDER.map((cli) => [cli, arbCheckState()])),
      ),
      pluginStates: fc.record(
        Object.fromEntries(PLUGIN_KEYS.map((key) => [key, arbCheckState()])),
      ),
      extraFailedClis: fc.subarray([...NON_INSTALLABLE_CLIS]),
      failedArrayClis: fc.subarray([...CANONICAL_CLI_ORDER]),
      failedArrayPlugins: fc.subarray([...PLUGIN_KEYS]),
      failedArrayNoise: fc.subarray(["runtime", "permissions"]),
      includeMcpBranch: fc.boolean(),
      includePluginsBranch: fc.boolean(),
      platform: arbPlatform(),
    })
    .map((seed) => {
      const mcp = {};
      for (const key of MCP_CHECK_KEYS) {
        assignCheck(mcp, key, seed.mcpStates[key], { optional: true });
      }

      const cli = {};
      for (const name of CANONICAL_CLI_ORDER) {
        assignCheck(cli, name, seed.cliStates[name], { optional: false });
      }
      for (const name of seed.extraFailedClis) {
        cli[name] = { ok: false, optional: false, error: "NOT_FOUND" };
      }

      const plugins = {};
      for (const key of PLUGIN_KEYS) {
        assignCheck(plugins, key, seed.pluginStates[key], { optional: false });
      }

      const failed = [
        ...seed.failedArrayClis.map((name) => ({ category: "cli", name, reason: "NOT_FOUND" })),
        ...seed.failedArrayPlugins.map((name) => ({ category: "plugin", name, reason: "NOT_FOUND" })),
        ...seed.failedArrayNoise.map((category) => ({ category, name: `${category}-item` })),
      ];

      const report = {
        status: "failed",
        checks: {
          cli,
          ...(seed.includePluginsBranch ? { plugins } : {}),
          ...(seed.includeMcpBranch ? { optional: { mcp } } : {}),
        },
        failed,
        warnings: [],
      };
      if (!seed.includeMcpBranch) {
        // Sem o ramo `checks.optional.mcp` os dois MCPs contam como ausentes.
        report.checks.optional = {};
      }

      const options = { platform: seed.platform };
      let roles = null;
      let declaredClis = null;

      if (seed.configSource === "options") {
        options.projectConfig = { ...seed.roles };
        roles = seed.roles;
      } else if (seed.configSource === "report-roles") {
        report.projectConfig = { source: "file", roles: { ...seed.roles } };
        roles = seed.roles;
      } else if (seed.configSource === "report-flat") {
        report.projectConfig = { source: "file", ...seed.roles };
        roles = seed.roles;
      } else if (seed.configSource === "required-clis") {
        report.projectConfig = { source: "file", requiredCliSet: [...seed.declaredClis] };
        declaredClis = seed.declaredClis;
      } else {
        roles = DEFAULT_PROJECT_CONFIG;
      }

      return { report, options, roles, declaredClis, configSource: seed.configSource };
    });
}

/* -------------------------------------------------------------------------- */
/* Derivacao esperada, independente do modulo                                  */
/* -------------------------------------------------------------------------- */

/** Papeis que exigem uma CLI: os que declaram aquele executor. */
function expectedAffectedRoles(roles, cli) {
  if (roles === null) return [];
  return ROLES.filter((role) => roles[role] === cli);
}

/** Required_CLI_Set esperado: CLI exigida por ao menos um papel. */
function expectedRequiredClis({ roles, declaredClis }) {
  if (roles !== null) {
    return CANONICAL_CLI_ORDER.filter((cli) => expectedAffectedRoles(roles, cli).length > 0);
  }
  return CANONICAL_CLI_ORDER.filter((cli) => (declaredClis ?? []).includes(cli));
}

/** CLIs reprovadas no relatorio: check nao aprovado ou entrada em `failed`. */
function reportFailedClis(report) {
  const failed = new Set();
  for (const [name, check] of Object.entries(report.checks.cli ?? {})) {
    if (check === null || typeof check !== "object" || check.ok !== true) failed.add(name);
  }
  for (const entry of report.failed ?? []) {
    if (entry.category === "cli") failed.add(entry.name);
  }
  return failed;
}

/** MCP ausente: check inexistente, malformado ou com `ok` diferente de `true`. */
function mcpMissing(report, key) {
  const check = report.checks?.optional?.mcp?.[key];
  return check === null || typeof check !== "object" || check.ok !== true;
}

/** Chaves de plugin reprovadas no relatorio: check nao aprovado ou entrada em `failed`. */
function reportFailedPlugins(report) {
  const failed = new Set();
  for (const [name, check] of Object.entries(report.checks.plugins ?? {})) {
    if (check === null || typeof check !== "object" || check.ok !== true) failed.add(name);
  }
  for (const entry of report.failed ?? []) {
    if (entry.category === "plugin") failed.add(entry.name);
  }
  return failed;
}

/** Nomes esperados do plano, na ordem esperada. */
function expectedPlanNames(fixture) {
  const names = [];
  for (const key of MCP_CHECK_KEYS) {
    if (mcpMissing(fixture.report, key)) names.push(MCP_ITEM_NAME[key]);
  }
  const required = expectedRequiredClis(fixture);
  const failed = reportFailedClis(fixture.report);
  const failedPlugins = reportFailedPlugins(fixture.report);
  for (const cli of CANONICAL_CLI_ORDER) {
    if (!required.includes(cli)) continue;
    if (failed.has(cli)) names.push(cli);
    if (failedPlugins.has(CLI_PLUGIN_KEY[cli])) names.push(PLUGIN_ITEM_NAME[cli]);
  }
  return names;
}

/* -------------------------------------------------------------------------- */
/* Propriedades                                                                */
/* -------------------------------------------------------------------------- */

// Feature: orchestrator-mcp-agent-config, Property 16: Plano de dependencias ausentes e derivacao exata do preflight
// Para qualquer relatorio de preflight e qualquer sistema operacional detectado, a lista de
// dependencias ausentes e exatamente o CBM_MCP quando ausente, o Context7_MCP quando ausente e cada
// CLI do Required_CLI_Set reprovada, em ordem estavel; cada item traz nome, beneficio, impacto e
// comando nao vazios; e cada item de CLI traz `affectedRoles` igual ao conjunto de papeis que exigem
// aquela CLI.
//
// **Validates: Requirements 4.1, 4.3, 4.13**
//
// Extensao pos-spec (nao coberta pelo texto original da Property 16 nem por um requirement
// numerado): o catalogo passou a incluir o plugin do Claude Code que conecta cada CLI
// (`openai-codex` para `codex`, `cc-antigravity-plugin` para `agy`), porque a CLI sozinha nao
// basta — e o plugin que da ao Claude Code os agentes/comandos para falar com ela. O gerador
// abaixo tambem sorteia o estado de `checks.plugins`, e a propriedade verifica que cada plugin
// reprovado entra no plano logo apos a CLI que ele conecta, com os mesmos `affectedRoles`,
// independente da CLI estar ou nao reprovada (as duas reprovacoes sao independentes).
test("Property 16: plano de dependencias ausentes e derivacao exata do preflight", () => {
  fc.assert(
    fc.property(arbPreflightReport(), (fixture) => {
      const items = buildMissingDependencies(fixture.report, fixture.options);
      const platform = resolvePlatform(fixture.options.platform);

      // Composicao e ordem: MCPs ausentes primeiro, depois as CLIs reprovadas do
      // Required_CLI_Set em ordem canonica (Req 4.1).
      assert.deepEqual(
        items.map((item) => item.name),
        expectedPlanNames(fixture),
      );

      // Ordem estavel: a mesma entrada produz sempre a mesma lista.
      assert.deepEqual(
        buildMissingDependencies(fixture.report, fixture.options).map((item) => item.name),
        items.map((item) => item.name),
      );

      const seen = new Set();
      for (const item of items) {
        assert.ok(!seen.has(item.name), `dependencia repetida no plano: ${item.name}`);
        seen.add(item.name);

        // Cada item explica a dependencia e o comando que sera executado (Req 4.3).
        for (const field of ["name", "benefit", "impact"]) {
          assert.equal(typeof item[field], "string");
          assert.ok(item[field].trim() !== "", `${item.name}.${field} vazio`);
        }
        assert.ok(Array.isArray(item.command) && item.command.length > 0, `${item.name} sem comando`);
        for (const command of item.command) {
          assert.equal(typeof command, "string");
          assert.ok(command.trim() !== "", `${item.name} com comando vazio`);
        }
        assert.equal(item.platform, platform);

        if (MCP_CHECK_KEYS.includes(item.checkKey)) {
          // MCP nunca bloqueia: item opcional.
          assert.equal(item.kind, "mcp");
          assert.equal(item.optional, true);
          continue;
        }

        if (PLUGIN_KEYS.includes(item.checkKey)) {
          // Plugin do Claude Code que conecta a CLI: bloqueante como a propria
          // CLI, com os mesmos papeis afetados (Req 4.13) — a reprovacao do
          // plugin e independente da reprovacao da CLI, mas o papel que exige a
          // CLI e o mesmo que precisa do plugin para falar com ela.
          const owningCli = CANONICAL_CLI_ORDER.find((cli) => CLI_PLUGIN_KEY[cli] === item.checkKey);
          assert.equal(item.kind, "plugin");
          assert.equal(item.optional, false);
          assert.deepEqual([...item.affectedRoles], expectedAffectedRoles(fixture.roles, owningCli));
          continue;
        }

        // CLI do Required_CLI_Set: bloqueante, com os papeis afetados que
        // sustentam a oferta de trocar o papel para claude-code (Req 4.13).
        assert.equal(item.kind, "cli");
        assert.equal(item.optional, false);
        assert.deepEqual([...item.affectedRoles], expectedAffectedRoles(fixture.roles, item.name));
      }
    }),
    { numRuns: NUM_RUNS },
  );
});

/* -------------------------------------------------------------------------- */
/* Property 8: redacao de segredos                                             */
/* -------------------------------------------------------------------------- */

const roots = [];

test.afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

/** Segredo com formato plausivel de chave de API, token ou cabecalho. */
function arbSecret() {
  return fc
    .tuple(
      fc.constantFrom("sk-live", "ghp", "Bearer", "Authorization: Bearer", "api_key", "x-api-key"),
      fc.stringMatching(/^[A-Za-z0-9]{16,40}$/),
    )
    .map(([prefix, token]) => `${prefix}-${token}-ZZSECRETZZ`);
}

/** Projeto temporario com um `.mcp.json` de projeto e um HOME temporario, ambos com o segredo. */
function seedMcpFixture(secret) {
  const projectRoot = mkdtempSync(join(tmpdir(), "dep-plan-secret-project-"));
  const home = mkdtempSync(join(tmpdir(), "dep-plan-secret-home-"));
  roots.push(projectRoot, home);

  writeFileSync(
    join(projectRoot, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        "codebase-memory-mcp": {
          command: "codebase-memory-mcp",
          env: { CODEBASE_MEMORY_API_KEY: secret },
        },
      },
    }),
    "utf8",
  );

  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(
    join(home, ".claude", "mcp.json"),
    JSON.stringify({
      mcpServers: {
        context7: {
          url: "https://mcp.context7.com/mcp",
          headers: { Authorization: `Bearer ${secret}` },
        },
      },
    }),
    "utf8",
  );

  return { projectRoot, home };
}

// Feature: orchestrator-mcp-agent-config, Property 8: Segredos nao atravessam relatorio, registro nem telemetria
// Para qualquer segredo - chave de API, token ou cabecalho de autenticacao - presente em arquivo de
// configuracao MCP inspecionado ou na saida de um comando de instalacao, esse segredo nao aparece no
// relatorio de preflight serializado, no registro por dependencia do Dependency_Installer nem no
// evento de telemetria; e o registro por dependencia tem exatamente as chaves `name`, `decision`,
// `command`, `exitCode` e `durationMs`, com `exitCode` preservado para qualquer codigo de saida
// diferente de zero.
//
// **Validates: Requirements 1.10, 4.11, 4.14, 9.6**
//
// A deteccao de MCP (mcp-detect.mjs) e o insumo do bloco `checks.optional.mcp` que o preflight
// publica sem outra transformacao (ver docstring do modulo); testar `detectMcpServers` diretamente
// sobre um projeto/HOME fixture e portanto equivalente a testar o relatorio de preflight serializado,
// sem pagar o custo de um processo `preflight.mjs` por iteracao. `dependency-plan.mjs` nao tem
// dataflow para telemetria (nenhum modulo de producao chama `recordTelemetry` com dados de instalacao
// ou de deteccao de MCP - ver `preflight.mjs` e o proprio `dependency-plan.mjs`, ambos sem import de
// `telemetry.mjs`); a garantia testada no lado de telemetria e o contrato allowlist de
// `sanitizeEvent`, que barra por nome qualquer campo fora do conjunto fixo antes de gravar, o que
// fecha o unico caminho por onde uma saida de instalacao bruta (`stdout`/`stderr`/`output`) poderia
// chegar ao evento.
test("Property 8: segredo nao atravessa relatorio de MCP, registro de dependencia nem evento de telemetria", () => {
  fc.assert(
    fc.property(
      arbSecret(),
      fc.constantFrom("codex", "agy"),
      fc.integer({ min: 1, max: 255 }),
      fc.constantFrom("stdout", "stderr", "output", "rawOutput"),
      (secret, cliName, exitCode, forbiddenKey) => {
        // (a) Segredo em arquivo de configuracao MCP inspecionado: a deteccao so
        // registra tipo de evidencia e caminho, nunca o conteudo lido (Req 1.10).
        const { projectRoot, home } = seedMcpFixture(secret);
        const detected = detectMcpServers({ projectRoot, home, pathLookup: () => null });
        const serializedMcp = JSON.stringify(detected);
        assert.ok(
          !serializedMcp.includes(secret),
          "segredo vazou na deteccao de MCP / bloco checks.optional.mcp do relatorio",
        );
        // A evidencia so pode carregar path, tipo, o nome do servidor registrado
        // (para `mcp-config` casado por estrutura) e (quando ilegivel) a primeira
        // linha de um erro de parsing - nunca uma chave literal do JSON, nunca o
        // conteudo lido.
        const ALLOWED_EVIDENCE_KEYS = new Set(["type", "path", "server", "error"]);
        for (const server of Object.values(detected)) {
          for (const item of server.evidence ?? []) {
            for (const key of Object.keys(item)) assert.ok(ALLOWED_EVIDENCE_KEYS.has(key), key);
          }
        }

        // (b) Segredo na saida de um comando de instalacao: o registro por
        // dependencia nao le stdout/stderr/output e traz exatamente as 5 chaves
        // allowlisted (Req 4.14).
        const item = buildDependencyPlanItem(cliName, { platform: "linux" });
        const outcome = {
          decision: "instalar",
          exitCode,
          durationMs: 42,
          stdout: `token issued: ${secret}`,
          stderr: `Authorization: Bearer ${secret}`,
          output: secret,
          command: [`curl -H 'Authorization: Bearer ${secret}' https://exemplo`],
        };
        const record = summarizeInstallOutcome(item, outcome);
        assert.deepEqual(Object.keys(record).sort(), ["command", "decision", "durationMs", "exitCode", "name"]);
        assert.equal(record.exitCode, exitCode, "exitCode diferente de zero deve ser preservado");
        assert.ok(
          !JSON.stringify(record).includes(secret),
          "segredo vazou no registro por dependencia do Dependency_Installer",
        );
        // O comando registrado vem sempre do catalogo, nunca da linha reconstruida
        // pelo chamador (que trazia o segredo).
        assert.deepEqual(record.command, [...item.command]);

        // (c) Segredo tentando entrar no evento de telemetria por um campo fora do
        // allowlist (o unico jeito de uma saida bruta de instalacao chegaria la):
        // rejeitado por nome de campo, nada persistido (Req 9.6).
        const telemetryProjectRoot = mkdtempSync(join(tmpdir(), "dep-plan-secret-telemetry-"));
        roots.push(telemetryProjectRoot);
        assert.throws(
          () =>
            recordTelemetry(telemetryProjectRoot, {
              eventId: `evt-${cliName}-${exitCode}`,
              eventType: "task_outcome",
              occurredAt: "2026-02-14T18:07:02Z",
              runId: "run-secret",
              [forbiddenKey]: secret,
            }),
          (error) => error instanceof TelemetryError && error.code === "TELEMETRY_FIELD_FORBIDDEN",
        );
        assert.deepEqual(readTelemetry(telemetryProjectRoot), []);

        // Mesmo um evento valido, sem o campo proibido, nunca carrega o segredo:
        // nenhum campo aceito pelo allowlist e alimentado por saida de instalacao.
        const { created } = recordTelemetry(telemetryProjectRoot, {
          eventId: `evt-ok-${cliName}-${exitCode}`,
          eventType: "task_outcome",
          occurredAt: "2026-02-14T18:07:02Z",
          runId: "run-secret",
          executor: cliName,
          reasonCode: "INSTALL_COMPLETED",
        });
        assert.equal(created, true);
        const stored = readTelemetry(telemetryProjectRoot);
        assert.ok(!JSON.stringify(stored).includes(secret), "segredo vazou no evento de telemetria");
      },
    ),
    { numRuns: NUM_RUNS },
  );
});
