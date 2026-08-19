import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  CLI_PLUGIN_KEY,
  DEPENDENCY_KINDS,
  INSTALL_DECISION_INSTALL,
  INSTALL_DECISION_SKIP,
  INSTALL_OUTCOME_FIELDS,
  INSTALLABLE_CLIS,
  DependencyPlanError,
  buildDependencyPlanItem,
  buildMissingDependencies,
  summarizeInstallOutcome,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/dependency-plan.mjs";

/**
 * Testes unitarios do catalogo de dependencias ausentes.
 *
 * Exemplos concretos, complementares ao teste de propriedade da derivacao
 * (Property 16, em `dependency-plan.property.test.mjs`): o comando exato e o
 * follow-up interativo de `codex` (Req 4.8) e de `agy` por SO (Req 4.9), o
 * comando do Context7_MCP (Req 4.7), e o contrato de registro que sustenta
 * "instalar somente apos confirmacao" (Req 4.4).
 *
 * Nenhuma instalacao acontece aqui: o modulo e puro, e o ultimo teste prova
 * isso lendo o proprio fonte.
 */

/** Caminho do modulo sob teste, usado pelo teste estrutural. */
const MODULE_PATH = fileURLToPath(
  new URL(
    "../skills/orchestrator-multi-agent-development/scripts/lib/dependency-plan.mjs",
    import.meta.url,
  ),
);

/** Plataformas que o catalogo precisa cobrir, incluindo apelidos comuns. */
const POSIX_PLATFORMS = Object.freeze(["darwin", "macos", "linux"]);
const WINDOWS_PLATFORMS = Object.freeze(["win32", "windows"]);

/** Segredo semeado no outcome para provar que ele nao chega ao registro. */
const SEEDED_SECRET = "sk-token-que-nunca-deve-ser-registrado";

/**
 * Remove comentarios do fonte para que o teste estrutural avalie codigo, e nao
 * a documentacao do modulo — que menciona de proposito o que ele nao faz.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

/* -------------------------------------------------------------------------- */
/* Catalogo: CLI codex (Req 4.8)                                              */
/* -------------------------------------------------------------------------- */

test("codex instala por npm e delega `codex login` ao usuario em qualquer SO", () => {
  for (const platform of [...WINDOWS_PLATFORMS, ...POSIX_PLATFORMS]) {
    const item = buildDependencyPlanItem("codex", { platform });

    // Req 4.8: comando de instalacao unico e igual em todo SO.
    assert.deepEqual([...item.command], ["npm install -g @openai/codex"]);

    // Req 4.8: a autenticacao e um passo interativo do usuario, fora da
    // sequencia automatica do instalador.
    assert.equal(item.interactiveFollowUp, "codex login");
    assert.match(item.interactiveFollowUpNote, /interativa/i);
    assert.ok(!item.command.some((command) => command.includes("codex login")));

    assert.equal(item.kind, "cli");
    assert.ok(DEPENDENCY_KINDS.includes(item.kind));
    assert.equal(item.optional, false);
    assert.equal(item.checkKey, "codex");
    assert.equal(item.name, "codex");
  }
});

test("codex leva os papeis afetados, restritos aos papeis conhecidos", () => {
  const item = buildDependencyPlanItem("codex", {
    platform: "linux",
    affectedRoles: ["backendExecutor", "papelInexistente", "backendReviewer"],
  });

  assert.deepEqual([...item.affectedRoles], ["backendExecutor", "backendReviewer"]);
});

/* -------------------------------------------------------------------------- */
/* Catalogo: CLI agy (Req 4.9)                                                */
/* -------------------------------------------------------------------------- */

test("agy usa o instalador oficial do SO detectado e pede a primeira execucao interativa", () => {
  for (const platform of WINDOWS_PLATFORMS) {
    const item = buildDependencyPlanItem("agy", { platform });
    // Req 4.9: instalador PowerShell do Antigravity no Windows.
    assert.deepEqual([...item.command], ["irm https://antigravity.google/cli/install.ps1 | iex"]);
    assert.equal(item.platform, "win32");
  }

  for (const platform of POSIX_PLATFORMS) {
    const item = buildDependencyPlanItem("agy", { platform });
    // Req 4.9: instalador shell do Antigravity em macOS e Linux.
    assert.deepEqual([...item.command], [
      "curl -fsSL https://antigravity.google/cli/install.sh | bash",
    ]);
  }

  const item = buildDependencyPlanItem("agy", { platform: "linux" });
  // Req 4.9: a autenticacao exige abrir `agy` uma vez, o que o orquestrador
  // nao faz pelo usuario.
  assert.equal(item.interactiveFollowUp, "agy");
  assert.match(item.interactiveFollowUpNote, /interativa/i);
  assert.equal(item.kind, "cli");
  assert.equal(item.optional, false);
});

test("INSTALLABLE_CLIS traz codex antes de agy", () => {
  assert.deepEqual([...INSTALLABLE_CLIS], ["codex", "agy"]);
});

/* -------------------------------------------------------------------------- */
/* Catalogo: Context7_MCP (Req 4.7)                                           */
/* -------------------------------------------------------------------------- */

test("context7 instala por `npx ctx7 setup --claude` em qualquer SO, sem follow-up interativo", () => {
  for (const platform of [...WINDOWS_PLATFORMS, ...POSIX_PLATFORMS]) {
    const item = buildDependencyPlanItem("context7", { platform });

    // Req 4.7: comando unico, independente do SO.
    assert.deepEqual([...item.command], ["npx ctx7 setup --claude"]);
    assert.equal(item.interactiveFollowUp, null);

    // MCP nunca bloqueia o workflow.
    assert.equal(item.kind, "mcp");
    assert.equal(item.optional, true);
    assert.deepEqual([...item.affectedRoles], []);
  }

  const item = buildDependencyPlanItem("context7", { platform: "linux" });
  // Alternativa documentada ao comando automatico.
  assert.ok(
    item.alternatives.some((alternative) => alternative.includes("https://mcp.context7.com/mcp")),
    "context7 deve oferecer o registro manual da URL do servidor MCP",
  );
});

test("dependencia fora do catalogo falha nomeando o conjunto aceito", () => {
  assert.throws(
    () => buildDependencyPlanItem("context8"),
    (error) => {
      assert.ok(error instanceof DependencyPlanError);
      assert.equal(error.code, "DEPENDENCY_PLAN_UNKNOWN_DEPENDENCY");
      assert.deepEqual(error.details.accepted, [
        "codebase-memory",
        "context7",
        "codex",
        "agy",
        "openai-codex",
        "cc-antigravity-plugin",
      ]);
      return true;
    },
  );
});

/* -------------------------------------------------------------------------- */
/* Catalogo: plugins do Claude Code que conectam cada CLI                     */
/* -------------------------------------------------------------------------- */

test("CLI_PLUGIN_KEY mapeia codex e agy para a mesma chave que checks.plugins do preflight usa", () => {
  assert.deepEqual(CLI_PLUGIN_KEY, { codex: "openai-codex", agy: "cc-antigravity-plugin" });
});

test("openai-codex instala o plugin do Codex por comando de plugin do Claude Code, sem follow-up interativo", () => {
  for (const platform of [...WINDOWS_PLATFORMS, ...POSIX_PLATFORMS]) {
    const item = buildDependencyPlanItem("openai-codex", { platform });

    assert.deepEqual([...item.command], [
      "/plugin marketplace add openai/codex-plugin-cc",
      "/plugin install codex@openai-codex",
    ]);
    assert.equal(item.interactiveFollowUp, null);
    assert.equal(item.kind, "plugin");
    assert.equal(item.optional, false);
    assert.equal(item.checkKey, "openai-codex");
    assert.equal(item.name, "codex-plugin-cc");
    assert.equal(item.docs, "https://github.com/openai/codex-plugin-cc");
  }
});

test("cc-antigravity-plugin instala o plugin do Antigravity por comando de plugin do Claude Code", () => {
  for (const platform of [...WINDOWS_PLATFORMS, ...POSIX_PLATFORMS]) {
    const item = buildDependencyPlanItem("cc-antigravity-plugin", { platform });

    assert.deepEqual([...item.command], ["claude plugin install AllanHarlen/cc-antigravity-plugin"]);
    assert.equal(item.interactiveFollowUp, null);
    assert.equal(item.kind, "plugin");
    assert.equal(item.optional, false);
    assert.equal(item.checkKey, "cc-antigravity-plugin");
    assert.equal(item.name, "cc-antigravity-plugin");
    assert.equal(item.docs, "https://github.com/AllanHarlen/cc-antigravity-plugin");
  }
});

test("o plano pareia CLI e plugin de forma independente: cada reprovacao entra so quando ocorre", () => {
  const baseReport = (cliOk, pluginOk) => ({
    status: "failed",
    checks: {
      cli: { codex: { ok: cliOk, optional: false }, agy: { ok: true, optional: false } },
      plugins: {
        "openai-codex": { ok: pluginOk, optional: false },
        "cc-antigravity-plugin": { ok: true, optional: false },
      },
      optional: { mcp: { "codebase-memory": { ok: true }, context7: { ok: true } } },
    },
    projectConfig: {
      source: "file",
      roles: {
        backendExecutor: "codex",
        frontendExecutor: "claude-code",
        backendReviewer: "codex",
        frontendReviewer: "claude-code",
      },
    },
    failed: [],
    warnings: [],
  });

  // CLI reprovada, plugin aprovado: so o item de CLI entra.
  assert.deepEqual(
    buildMissingDependencies(baseReport(false, true), { platform: "linux" }).map((item) => item.name),
    ["codex"],
  );

  // CLI aprovada, plugin reprovado: so o item de plugin entra — CLI instalada
  // nao implica plugin instalado.
  assert.deepEqual(
    buildMissingDependencies(baseReport(true, false), { platform: "linux" }).map((item) => item.name),
    ["codex-plugin-cc"],
  );

  // Ambos reprovados: CLI antes do plugin que a conecta.
  assert.deepEqual(
    buildMissingDependencies(baseReport(false, false), { platform: "linux" }).map((item) => item.name),
    ["codex", "codex-plugin-cc"],
  );
  const both = buildMissingDependencies(baseReport(false, false), { platform: "linux" });
  assert.deepEqual([...both[1].affectedRoles], ["backendExecutor", "backendReviewer"]);

  // Ambos aprovados: nada entra.
  assert.deepEqual(buildMissingDependencies(baseReport(true, true), { platform: "linux" }), []);
});

/* -------------------------------------------------------------------------- */
/* Registro da decisao (Req 4.4, Req 4.14)                                    */
/* -------------------------------------------------------------------------- */

test("`seguir sem instalar` registra a decisao sem execucao", () => {
  const item = buildDependencyPlanItem("codex", { platform: "linux" });
  const record = summarizeInstallOutcome(item, { decision: INSTALL_DECISION_SKIP });

  // Req 4.4: sem `instalar` nao houve comando executado, logo nao ha codigo de
  // saida nem duracao — mas o comando ofertado continua registrado.
  assert.deepEqual(record, {
    name: "codex",
    decision: INSTALL_DECISION_SKIP,
    command: ["npm install -g @openai/codex"],
    exitCode: null,
    durationMs: null,
  });
});

test("`instalar` registra apenas os campos allowlisted, ignorando saida do processo", () => {
  const item = buildDependencyPlanItem("agy", { platform: "win32" });
  const record = summarizeInstallOutcome(item, {
    decision: INSTALL_DECISION_INSTALL,
    exitCode: 1,
    durationMs: 1234.6,
    stdout: SEEDED_SECRET,
    stderr: `Authorization: Bearer ${SEEDED_SECRET}`,
    output: SEEDED_SECRET,
    command: ["curl -H 'Authorization: Bearer x' https://exemplo"],
  });

  assert.deepEqual(Object.keys(record), [...INSTALL_OUTCOME_FIELDS]);
  assert.equal(record.decision, INSTALL_DECISION_INSTALL);
  // Codigo de saida diferente de zero preservado como veio (insumo do Req 4.11).
  assert.equal(record.exitCode, 1);
  assert.equal(record.durationMs, 1235);
  // O comando vem do catalogo, nunca da linha reconstruida pelo chamador.
  assert.deepEqual(record.command, ["irm https://antigravity.google/cli/install.ps1 | iex"]);
  assert.ok(!JSON.stringify(record).includes(SEEDED_SECRET));
});

test("decisao fora de `instalar`/`seguir sem instalar` e recusada", () => {
  const item = buildDependencyPlanItem("context7", { platform: "linux" });

  assert.throws(
    () => summarizeInstallOutcome(item, { decision: "talvez" }),
    (error) => {
      assert.ok(error instanceof DependencyPlanError);
      assert.equal(error.code, "DEPENDENCY_PLAN_INVALID_DECISION");
      return true;
    },
  );
  assert.throws(
    () => summarizeInstallOutcome(item, {}),
    /DEPENDENCY_PLAN_INVALID_DECISION|Invalid install decision/,
  );
});

/* -------------------------------------------------------------------------- */
/* Teste estrutural: o modulo nao executa processo (Req 4.4)                   */
/* -------------------------------------------------------------------------- */

test("o modulo nao tem caminho para executar processo", () => {
  const source = stripComments(readFileSync(MODULE_PATH, "utf8"));

  // Nenhum import de builtin do Node: o modulo so depende da Project_Config.
  const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(specifiers.length > 0, "o modulo deveria importar a fonte da verdade da Project_Config");
  for (const specifier of specifiers) {
    assert.ok(
      specifier.startsWith("."),
      `import nao relativo em dependency-plan.mjs: ${specifier}`,
    );
  }
  assert.ok(!source.includes("child_process"), "dependency-plan.mjs nao pode importar child_process");
  assert.ok(!/\brequire\s*\(/.test(source), "dependency-plan.mjs nao pode usar require dinamico");
  assert.ok(!/\bimport\s*\(/.test(source), "dependency-plan.mjs nao pode usar import dinamico");

  // Nenhuma chamada de execucao de comando.
  for (const pattern of [
    /\bexec\s*\(/,
    /\bexecSync\b/,
    /\bexecFile(Sync)?\b/,
    /\bspawn(Sync)?\b/,
  ]) {
    assert.ok(!pattern.test(source), `dependency-plan.mjs referencia execucao de processo: ${pattern}`);
  }

  // O registro por dependencia nao le nenhum campo de saida de processo.
  for (const field of ["stdout", "stderr", "output"]) {
    assert.ok(
      !source.includes(`outcomeRecord.${field}`) && !source.includes(`outcome.${field}`),
      `summarizeInstallOutcome nao pode ler outcome.${field}`,
    );
  }
});
