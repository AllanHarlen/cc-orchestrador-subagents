import {
  DEFAULT_PROJECT_CONFIG,
  REQUIRED_CLI_ORDER,
  ROLES,
  deriveRequiredCliSet,
} from "./project-config.mjs";

/**
 * Catalogo de dependencias ausentes do Dependency_Installer.
 *
 * Modulo **puro** e sem I/O: nenhuma funcao aqui executa processo, le arquivo,
 * abre socket ou toca stdout/stderr de instalador. A execucao dos comandos e a
 * confirmacao por `AskUserQuestion` ficam na camada de orquestracao
 * (`references/project-config.md`); este modulo apenas deriva, do relatorio de
 * preflight, **o que** esta ausente, **qual comando** instala aquilo no SO
 * detectado e **como registrar** a decisao do usuario sem vazar segredo.
 *
 * Duas responsabilidades:
 *
 * - `buildMissingDependencies(report, { platform })`: derivacao exata do
 *   relatorio de preflight. CBM_MCP ausente e Context7_MCP ausente primeiro
 *   (contexto antes de execucao), depois cada CLI do Required_CLI_Set com check
 *   reprovado, em ordem canonica (`codex` antes de `agy`), cada uma seguida
 *   imediatamente pelo plugin do Claude Code que a conecta (`openai-codex` para
 *   `codex`, `cc-antigravity-plugin` para `agy`) quando `checks.plugins` reprova
 *   esse plugin — a CLI resolve o processo externo, o plugin e o que da ao
 *   Claude Code os agentes/comandos para falar com ele, e as duas reprovacoes
 *   sao independentes (CLI instalada nao implica plugin instalado). Ordem
 *   estavel: a mesma entrada produz sempre a mesma lista.
 * - `summarizeInstallOutcome(item, outcome)`: registro allowlisted por
 *   dependencia, com exatamente as chaves `name`, `decision`, `command`,
 *   `exitCode` e `durationMs` (Req 4.14).
 *
 * Redacao (Req 4.14, Req 1.10): o registro nunca carrega stdout, stderr,
 * conteudo de arquivo de configuracao, cabecalho de autenticacao ou chave de
 * API. `summarizeInstallOutcome` **nao le** `outcome.stdout`, `outcome.stderr`
 * nem `outcome.output`, e o campo `command` vem sempre do catalogo do proprio
 * item — nunca de uma linha de comando reconstruida pelo chamador, que poderia
 * carregar variavel de ambiente ou token.
 *
 * O modulo nao importa `mcp-detect.mjs`: o insumo e o relatorio ja serializado,
 * o que mantem a derivacao testavel sem filesystem.
 */

/** Tipos de dependencia reconhecidos. */
export const DEPENDENCY_KINDS = Object.freeze(["mcp", "cli", "plugin"]);

/** Decisoes possiveis do usuario por dependencia (Req 4.2). */
export const INSTALL_DECISION_INSTALL = "instalar";
export const INSTALL_DECISION_SKIP = "seguir sem instalar";
export const INSTALL_DECISIONS = Object.freeze([INSTALL_DECISION_INSTALL, INSTALL_DECISION_SKIP]);

/** Chaves — exatamente estas — do registro por dependencia (Req 4.14). */
export const INSTALL_OUTCOME_FIELDS = Object.freeze([
  "name",
  "decision",
  "command",
  "exitCode",
  "durationMs",
]);

/** Chave dos checks de MCP no relatorio de preflight. */
export const MCP_CHECK_KEYS = Object.freeze(["codebase-memory", "context7"]);

export class DependencyPlanError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DependencyPlanError";
    this.code = code;
    this.details = details;
  }
}

/** Plataformas de comando suportadas pelo catalogo. */
const PLATFORM_WINDOWS = "win32";
const PLATFORM_DARWIN = "darwin";
const PLATFORM_LINUX = "linux";

const PLATFORM_ALIASES = new Map([
  ["win32", PLATFORM_WINDOWS],
  ["windows", PLATFORM_WINDOWS],
  ["win", PLATFORM_WINDOWS],
  ["darwin", PLATFORM_DARWIN],
  ["macos", PLATFORM_DARWIN],
  ["mac", PLATFORM_DARWIN],
  ["osx", PLATFORM_DARWIN],
  ["linux", PLATFORM_LINUX],
]);

/**
 * Normaliza o identificador de SO. Valores de `process.platform` e apelidos
 * comuns (`windows`, `macos`) sao aceitos; qualquer outro valor cai no caminho
 * POSIX, que e o que os instaladores publicam para "macOS/Linux" — assim
 * nenhuma plataforma produz item sem comando.
 */
export function resolvePlatform(platform) {
  const raw = String(platform ?? process.platform ?? "").trim().toLowerCase();
  return PLATFORM_ALIASES.get(raw) ?? (raw.startsWith("win") ? PLATFORM_WINDOWS : PLATFORM_LINUX);
}

function commandsFor(byPlatform, platform) {
  const commands = byPlatform[platform] ?? byPlatform.posix;
  return Object.freeze([...commands]);
}

const CBM_INSTALL_SCRIPT_BASE = "https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main";

/**
 * Catalogo estatico das dependencias que o Dependency_Installer sabe instalar.
 *
 * `command` e a sequencia documentada por SO (Req 4.5 a 4.9);
 * `interactiveFollowUp` e o passo que **o usuario** precisa rodar depois, porque
 * exige interacao (`codex login`, primeira execucao de `agy`) e por isso nunca
 * entra na sequencia automatica.
 */
const DEPENDENCY_SPECS = Object.freeze({
  "codebase-memory": {
    name: "codebase-memory-mcp",
    kind: "mcp",
    optional: true,
    benefit:
      "Consultas estruturais no grafo do repositorio (arquitetura, quem chama o que, impacto de diff) "
      + "com custo de tokens muito menor que exploracao arquivo-a-arquivo.",
    impact:
      "Sem ele, classificacao de tasks, expectedFiles/allowedPaths e raio de impacto do diff dependem "
      + "da varredura deterministica de scripts/intelligence/, mais lenta e mais caras em tokens.",
    commands: {
      // Sequencia documentada: baixar install.ps1, remover a marca de origem da
      // internet (Mark-of-the-Web) e executar o script (Req 4.5).
      [PLATFORM_WINDOWS]: [
        `Invoke-WebRequest -Uri ${CBM_INSTALL_SCRIPT_BASE}/install.ps1 -OutFile install.ps1`,
        "Unblock-File .\\install.ps1",
        ".\\install.ps1",
      ],
      // Instalador install.sh publicado no repositorio (Req 4.6).
      posix: [`curl -fsSL ${CBM_INSTALL_SCRIPT_BASE}/install.sh | bash`],
    },
    alternatives: Object.freeze([
      "Instalacao manual: baixar o pacote da release mais recente e rodar o install.sh/install.ps1 incluido.",
    ]),
    interactiveFollowUp: null,
    interactiveFollowUpNote:
      "Reiniciar o agente de codigo depois da instalacao para que o servidor MCP seja carregado.",
    docs: "https://github.com/DeusData/codebase-memory-mcp",
  },
  context7: {
    name: "context7",
    kind: "mcp",
    optional: true,
    benefit:
      "Documentacao atual e versionada das bibliotecas usadas pelo projeto, injetada no contexto do "
      + "subagente antes de escrever codigo que usa aquela biblioteca.",
    impact:
      "Sem ele, o subagente segue apenas os padroes ja presentes no projeto e a memoria do modelo, com "
      + "risco de usar API obsoleta ou inexistente.",
    commands: {
      // Mesmo comando em qualquer SO (Req 4.7).
      posix: ["npx ctx7 setup --claude"],
    },
    alternatives: Object.freeze([
      "Alternativa: registrar manualmente a URL https://mcp.context7.com/mcp como servidor MCP de transporte HTTP.",
    ]),
    interactiveFollowUp: null,
    interactiveFollowUpNote:
      "A chave de API do Context7, quando usada, e configurada pelo proprio usuario e nunca entra em "
      + "prompt, artefato da Run ou telemetria.",
    docs: "https://github.com/upstash/context7",
  },
  codex: {
    name: "codex",
    kind: "cli",
    optional: false,
    benefit:
      "CLI exigida pelos papeis da Project_Config configurados como codex: implementacao e review "
      + "delegados ao Codex.",
    impact:
      "Sem ela, as tasks desses papeis nao tem executor: e preciso trocar o papel para claude-code ou "
      + "encerrar o workflow.",
    commands: {
      // Req 4.8.
      posix: ["npm install -g @openai/codex"],
    },
    alternatives: Object.freeze([]),
    // Autenticacao interativa: o usuario roda, o orquestrador nao (Req 4.8).
    interactiveFollowUp: "codex login",
    interactiveFollowUpNote:
      "codex login exige uma execucao interativa do usuario; o orquestrador nao autentica no lugar dele.",
    docs: "https://github.com/openai/codex",
  },
  agy: {
    name: "agy",
    kind: "cli",
    optional: false,
    benefit:
      "CLI exigida pelos papeis da Project_Config configurados como agy: implementacao e review "
      + "delegados ao Antigravity.",
    impact:
      "Sem ela, as tasks desses papeis nao tem executor: e preciso trocar o papel para claude-code ou "
      + "encerrar o workflow.",
    commands: {
      // Instalador oficial do Antigravity por SO (Req 4.9).
      [PLATFORM_WINDOWS]: ["irm https://antigravity.google/cli/install.ps1 | iex"],
      posix: ["curl -fsSL https://antigravity.google/cli/install.sh | bash"],
    },
    alternatives: Object.freeze([]),
    // Primeira execucao de `agy` conclui a autenticacao (Req 4.9).
    interactiveFollowUp: "agy",
    interactiveFollowUpNote:
      "A autenticacao exige abrir `agy` uma vez, em execucao interativa do usuario.",
    docs: "https://antigravity.google/cli",
  },
  // As duas chaves abaixo usam o mesmo nome que `checks.plugins` do preflight
  // (preflight.mjs), para que o checkKey do item e a chave do check reprovado
  // sejam a mesma string sem tabela de traducao a parte.
  "openai-codex": {
    name: "codex-plugin-cc",
    kind: "plugin",
    optional: false,
    benefit:
      "Plugin do Claude Code que conecta o Claude Code a CLI codex: registra os agentes e comandos que "
      + "o Orquestrador invoca para delegar implementacao e review ao Codex.",
    impact:
      "Sem ele, a CLI codex instalada nao basta: o Claude Code nao tem como invocar o Codex pelos "
      + "agentes/comandos que o Orquestrador espera, mesmo com `codex login` ja feito.",
    commands: {
      // Comandos de plugin do Claude Code: mesma sequencia em qualquer SO, roda
      // dentro de uma sessao do Claude Code (nao em shell externo).
      posix: [
        "/plugin marketplace add openai/codex-plugin-cc",
        "/plugin install codex@openai-codex",
      ],
    },
    alternatives: Object.freeze([]),
    interactiveFollowUp: null,
    interactiveFollowUpNote:
      "Comando de plugin do Claude Code: roda dentro de uma sessao do Claude Code, nao em shell externo.",
    docs: "https://github.com/openai/codex-plugin-cc",
  },
  "cc-antigravity-plugin": {
    name: "cc-antigravity-plugin",
    kind: "plugin",
    optional: false,
    benefit:
      "Plugin do Claude Code que conecta o Claude Code a CLI agy: registra os agentes e comandos que o "
      + "Orquestrador invoca para delegar implementacao e review ao Antigravity.",
    impact:
      "Sem ele, a CLI agy instalada nao basta: o Claude Code nao tem como invocar o Antigravity pelos "
      + "agentes/comandos que o Orquestrador espera, mesmo com a autenticacao do `agy` ja feita.",
    commands: {
      posix: ["claude plugin install AllanHarlen/cc-antigravity-plugin"],
    },
    alternatives: Object.freeze([]),
    interactiveFollowUp: null,
    interactiveFollowUpNote:
      "Comando de plugin do Claude Code: roda dentro de uma sessao do Claude Code, nao em shell externo.",
    docs: "https://github.com/AllanHarlen/cc-antigravity-plugin",
  },
});

/** CLIs que o catalogo sabe instalar, na ordem canonica do Required_CLI_Set. */
export const INSTALLABLE_CLIS = Object.freeze(
  REQUIRED_CLI_ORDER.filter((cli) => DEPENDENCY_SPECS[cli]?.kind === "cli"),
);

/**
 * Plugin do Claude Code que conecta cada CLI ao Claude Code, indexado pela
 * mesma chave de `REQUIRED_CLI_ORDER` e valendo a chave que `checks.plugins`
 * do preflight usa para aquele plugin (Req 5.2 a 5.5 do preflight).
 */
export const CLI_PLUGIN_KEY = Object.freeze({
  codex: "openai-codex",
  agy: "cc-antigravity-plugin",
});

/**
 * Monta um DependencyPlanItem do catalogo.
 *
 * @param {string} key Chave do catalogo (`codebase-memory`, `context7`, `codex`, `agy`,
 *   `openai-codex`, `cc-antigravity-plugin`).
 * @param {{ platform?: string, affectedRoles?: string[] }} [options]
 * @returns {Readonly<object>} Item congelado.
 */
export function buildDependencyPlanItem(key, options = {}) {
  const spec = DEPENDENCY_SPECS[key];
  if (!spec) {
    throw new DependencyPlanError(
      "DEPENDENCY_PLAN_UNKNOWN_DEPENDENCY",
      `Unknown dependency ${JSON.stringify(String(key))}; accepted: ${Object.keys(DEPENDENCY_SPECS).join(", ")}`,
      { received: key, accepted: Object.keys(DEPENDENCY_SPECS) },
    );
  }
  const platform = resolvePlatform(options.platform);
  const affectedRoles = ROLES.filter((role) => (options.affectedRoles ?? []).includes(role));
  return Object.freeze({
    name: spec.name,
    checkKey: key,
    kind: spec.kind,
    optional: spec.optional,
    benefit: spec.benefit,
    impact: spec.impact,
    platform,
    command: commandsFor(spec.commands, platform),
    alternatives: spec.alternatives,
    interactiveFollowUp: spec.interactiveFollowUp,
    interactiveFollowUpNote: spec.interactiveFollowUpNote,
    affectedRoles: Object.freeze(affectedRoles),
    docs: spec.docs,
  });
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/** `true` quando o check do relatorio nao aprovou (ausente ou `ok !== true`). */
function checkFailed(check) {
  const record = plainObject(check);
  return record === null || record.ok !== true;
}

/**
 * Resolve o Required_CLI_Set e os papeis por CLI a partir do relatorio.
 *
 * Ordem de precedencia: `options.projectConfig` (papeis explicitos), depois
 * `report.projectConfig.roles`, depois `report.projectConfig.requiredCliSet`
 * (relatorio que traz so a lista derivada), depois a configuracao padrao — que
 * e a mesma regra do preflight para projeto sem Project_Config_File (Req 5.6).
 *
 * Quando ha papeis, a derivacao vem de `deriveRequiredCliSet`: este modulo nao
 * reimplementa a regra de obrigatoriedade.
 */
function resolveRequiredClis(report, options) {
  // Papeis aceitos tanto no formato da Project_Config (papeis na raiz) quanto no
  // formato do bloco `projectConfig` do relatorio (papeis em `.roles`).
  const reportBlock = plainObject(plainObject(report)?.projectConfig);
  const candidates = [
    plainObject(options.projectConfig),
    plainObject(plainObject(options.projectConfig)?.roles),
    reportBlock,
    plainObject(reportBlock?.roles),
  ];
  const roles = candidates.find(
    (candidate) =>
      candidate !== null
      && candidate !== undefined
      && ROLES.every((role) => typeof candidate[role] === "string" && candidate[role].trim() !== ""),
  );
  if (roles) {
    const derived = deriveRequiredCliSet(roles);
    return { clis: derived.clis, rolesByCli: derived.rolesByCli };
  }

  const declared = reportBlock?.requiredCliSet;
  if (Array.isArray(declared)) {
    const selected = new Set(declared.map((cli) => String(cli ?? "").trim().toLowerCase()));
    const rolesByCli = {};
    for (const cli of REQUIRED_CLI_ORDER) rolesByCli[cli] = [];
    return { clis: REQUIRED_CLI_ORDER.filter((cli) => selected.has(cli)), rolesByCli };
  }

  const derived = deriveRequiredCliSet(DEFAULT_PROJECT_CONFIG);
  return { clis: derived.clis, rolesByCli: derived.rolesByCli };
}

/** Nomes de CLI reprovados segundo `checks.cli` e o array `failed`. */
function failedCliNames(report) {
  const failed = new Set();

  const cliChecks = plainObject(plainObject(plainObject(report)?.checks)?.cli);
  if (cliChecks) {
    for (const [name, check] of Object.entries(cliChecks)) {
      if (checkFailed(check)) failed.add(name);
    }
  }

  // Relatorio antigo ou parcial pode trazer a reprovacao so no array `failed`.
  const failures = plainObject(report)?.failed;
  if (Array.isArray(failures)) {
    for (const failure of failures) {
      const record = plainObject(failure);
      if (record?.category === "cli" && typeof record.name === "string") failed.add(record.name);
    }
  }

  return failed;
}

/** Nomes de plugin reprovados segundo `checks.plugins` e o array `failed`. */
function failedPluginNames(report) {
  const failed = new Set();

  const pluginChecks = plainObject(plainObject(plainObject(report)?.checks)?.plugins);
  if (pluginChecks) {
    for (const [name, check] of Object.entries(pluginChecks)) {
      if (checkFailed(check)) failed.add(name);
    }
  }

  const failures = plainObject(report)?.failed;
  if (Array.isArray(failures)) {
    for (const failure of failures) {
      const record = plainObject(failure);
      if (record?.category === "plugin" && typeof record.name === "string") failed.add(record.name);
    }
  }

  return failed;
}

/**
 * Deriva a lista de dependencias ausentes do relatorio de preflight (Req 4.1).
 *
 * Composicao, em ordem estavel:
 *
 * 1. `codebase-memory-mcp`, quando `checks.optional.mcp.codebase-memory.ok` nao
 *    e `true` (check ausente conta como ausente).
 * 2. `context7`, quando `checks.optional.mcp.context7.ok` nao e `true`.
 * 3. Para cada CLI do Required_CLI_Set, na ordem canonica (`codex`, depois
 *    `agy`): a CLI, quando seu check `cli.*` esta reprovado, seguida
 *    imediatamente pelo plugin do Claude Code que a conecta (`openai-codex`
 *    para `codex`, `cc-antigravity-plugin` para `agy`), quando o check
 *    `plugins.*` correspondente esta reprovado. As duas reprovacoes sao
 *    independentes: uma CLI ja instalada e autenticada pode ter o plugin
 *    ausente, e o inverso tambem e possivel — o plano oferece exatamente o que
 *    esta faltando, sem assumir que uma reprovacao implica a outra.
 *
 * Tanto a CLI quanto seu plugin so entram no plano quando a CLI pertence ao
 * Required_CLI_Set (algum papel da Project_Config a exige); a mesma condicao
 * que o preflight usa para `plugins.*` em `REQUIRED_BY_CHECK`.
 *
 * MCP vem antes de CLI/plugin porque contexto de codigo e documentacao valem
 * para qualquer executor, e porque a decisao de CLI pode mudar a Project_Config
 * (Req 4.13). Item de MCP e `optional: true`; item de CLI e de plugin do
 * Required_CLI_Set sao `optional: false`.
 *
 * @param {object} report Relatorio de preflight ja serializado.
 * @param {{ platform?: string, projectConfig?: object }} [options] `platform`
 *   default `process.platform`; `projectConfig` sobrepoe os papeis do relatorio.
 * @returns {ReadonlyArray<Readonly<object>>} Itens congelados, possivelmente vazio.
 */
export function buildMissingDependencies(report, options = {}) {
  const platform = resolvePlatform(options.platform);
  const items = [];

  const mcpChecks = plainObject(
    plainObject(plainObject(plainObject(report)?.checks)?.optional)?.mcp,
  );
  for (const key of MCP_CHECK_KEYS) {
    if (checkFailed(mcpChecks?.[key])) items.push(buildDependencyPlanItem(key, { platform }));
  }

  const { clis, rolesByCli } = resolveRequiredClis(report, options);
  const failed = failedCliNames(report);
  const failedPlugins = failedPluginNames(report);
  for (const cli of clis) {
    const affectedRoles = rolesByCli[cli] ?? [];
    if (failed.has(cli) && DEPENDENCY_SPECS[cli]) {
      items.push(buildDependencyPlanItem(cli, { platform, affectedRoles }));
    }
    const pluginKey = CLI_PLUGIN_KEY[cli];
    if (pluginKey && DEPENDENCY_SPECS[pluginKey] && failedPlugins.has(pluginKey)) {
      items.push(buildDependencyPlanItem(pluginKey, { platform, affectedRoles }));
    }
  }

  return Object.freeze(items);
}

function normalizeDecision(decision) {
  const raw = String(decision ?? "").trim().toLowerCase();
  if (raw === INSTALL_DECISION_INSTALL || raw === "install") return INSTALL_DECISION_INSTALL;
  if (
    raw === INSTALL_DECISION_SKIP
    || raw === "seguir-sem-instalar"
    || raw === "seguir sem instalar"
    || raw === "skip"
  ) {
    return INSTALL_DECISION_SKIP;
  }
  throw new DependencyPlanError(
    "DEPENDENCY_PLAN_INVALID_DECISION",
    `Invalid install decision ${JSON.stringify(String(decision ?? ""))}; accepted: ${INSTALL_DECISIONS.join(", ")}`,
    { received: decision ?? null, accepted: [...INSTALL_DECISIONS] },
  );
}

function normalizeExitCode(outcome) {
  const raw = outcome.exitCode ?? outcome.code ?? outcome.status ?? null;
  if (raw === null || raw === undefined || raw === "") return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new DependencyPlanError(
      "DEPENDENCY_PLAN_INVALID_EXIT_CODE",
      `Invalid install exit code ${JSON.stringify(String(raw))}; expected an integer or null`,
      { received: raw },
    );
  }
  return parsed;
}

function normalizeDurationMs(outcome) {
  const raw = outcome.durationMs ?? outcome.duration ?? null;
  if (raw === null || raw === undefined || raw === "") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new DependencyPlanError(
      "DEPENDENCY_PLAN_INVALID_DURATION",
      `Invalid install duration ${JSON.stringify(String(raw))}; expected a non-negative number or null`,
      { received: raw },
    );
  }
  return Math.round(parsed);
}

/**
 * Registro allowlisted de uma decisao de instalacao (Req 4.14).
 *
 * Devolve **exatamente** `{ name, decision, command, exitCode, durationMs }`.
 * `command` e sempre a sequencia do catalogo do item: o modulo nao aceita linha
 * de comando reconstruida pelo chamador, e nao le `stdout`, `stderr`, `output`
 * nem qualquer campo de conteudo do processo. Assim, credencial, cabecalho de
 * autenticacao e conteudo de arquivo de configuracao nao tem caminho para o
 * registro, mesmo que o instalador os tenha impresso.
 *
 * `exitCode` diferente de zero e preservado como veio (e o insumo do Req 4.11);
 * decisao `seguir sem instalar` sem execucao produz `exitCode: null` e
 * `durationMs: null`.
 *
 * @param {object} item DependencyPlanItem de `buildMissingDependencies`.
 * @param {{ decision: string, exitCode?: number|null, durationMs?: number|null }} outcome
 * @returns {{ name: string, decision: string, command: string[], exitCode: number|null, durationMs: number|null }}
 */
export function summarizeInstallOutcome(item, outcome = {}) {
  const record = plainObject(item);
  if (record === null || typeof record.name !== "string" || record.name.trim() === "") {
    throw new DependencyPlanError(
      "DEPENDENCY_PLAN_INVALID_ITEM",
      "summarizeInstallOutcome requires a DependencyPlanItem with a name",
      { received: record === null ? typeof item : Object.keys(record) },
    );
  }
  const outcomeRecord = plainObject(outcome);
  if (outcomeRecord === null) {
    throw new DependencyPlanError(
      "DEPENDENCY_PLAN_INVALID_OUTCOME",
      "summarizeInstallOutcome requires an outcome object with a decision",
      { received: typeof outcome },
    );
  }

  return {
    name: record.name,
    decision: normalizeDecision(outcomeRecord.decision),
    command: Array.isArray(record.command) ? [...record.command] : [],
    exitCode: normalizeExitCode(outcomeRecord),
    durationMs: normalizeDurationMs(outcomeRecord),
  };
}
