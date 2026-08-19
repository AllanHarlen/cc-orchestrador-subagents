import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

/**
 * Deteccao dos MCPs opcionais do orquestrador: o CBM_MCP (`codebase-memory-mcp`)
 * e o Context7_MCP (`context7`).
 *
 * Modulo puro no que importa para teste: nenhuma I/O de rede, nenhum processo
 * externo, nenhum shell. Toda dependencia de ambiente e injetavel —
 * `projectRoot`, `home`, `now`, `timeoutMs`, `pathLookup`, `platform` e `env` —
 * o que permite exercitar a deteccao por fixture de filesystem e relogio
 * injetado, inclusive o deadline de 15 s por MCP.
 *
 * O que a deteccao faz, para os dois MCPs:
 *
 * - Varre candidatos conhecidos (arquivos de configuracao MCP, diretorios de
 *   servidor, SKILL.md de skill correspondente) e procura o marcador do
 *   servidor no conteudo, registrando evidencia `{ type, path }`.
 * - Resolve o binario do servidor no `PATH` por leitura da propria variavel de
 *   ambiente, sem shell e sem executar nada.
 * - Tipos de evidencia: `mcp-config`, `mcp-config-unreadable`, `binary`,
 *   `skill`, `mcp-directory`.
 * - Arquivo ilegivel ou JSON invalido gera `mcp-config-unreadable` com `path` e
 *   `error` (primeira linha), e a varredura continua nos candidatos seguintes.
 * - `ok` e verdadeiro se e somente se existe ao menos uma evidencia de tipo
 *   diferente de `mcp-config-unreadable` — e o deadline nao estourou.
 * - Deadline por MCP: antes de cada candidato compara `now()` com o deadline; ao
 *   estourar, encerra com `ok: false` e `reason: "TIMEOUT"`, preservando as
 *   evidencias ja coletadas.
 * - MCP ausente ganha `install` com os comandos do SO detectado.
 *
 * Redacao (Req 1.10): entram no resultado apenas caminho de arquivo, nome de
 * servidor, nome de binario e tipo de evidencia. Nunca chave de API, nunca
 * cabecalho de autenticacao, nunca linha de configuracao — o conteudo lido e
 * usado somente como teste booleano de marcador e e descartado.
 *
 * O resultado de cada deteccao e o objeto que o preflight publica em
 * `checks.optional.mcp.<servidor>`, com `optional: true` sempre: MCP ausente e
 * aviso, nunca bloqueio.
 */

/** Deadline por MCP, em milissegundos (Req 1.9). */
export const MCP_DETECT_TIMEOUT_MS = 15_000;

/** Tipos de evidencia que a deteccao pode registrar. */
export const MCP_EVIDENCE_TYPES = Object.freeze([
  "mcp-config",
  "mcp-config-unreadable",
  "binary",
  "skill",
  "mcp-directory",
]);

/** Evidencia que nao conta para `ok`: o arquivo existe mas nao foi legivel. */
export const MCP_EVIDENCE_UNREADABLE = "mcp-config-unreadable";

export const CODEBASE_MEMORY_MCP = "codebase-memory";
export const CONTEXT7_MCP = "context7";

/** Nomes dos servidores na ordem canonica do relatorio. */
export const MCP_SERVER_NAMES = Object.freeze([CODEBASE_MEMORY_MCP, CONTEXT7_MCP]);

/** Motivos aceitos no array `warnings` do preflight para MCP. */
export const MCP_DETECT_REASONS = Object.freeze({
  NOT_DETECTED: "NOT_DETECTED",
  TIMEOUT: "TIMEOUT",
});

export const CODEBASE_MEMORY_MCP_BINARY = "codebase-memory-mcp";
export const CODEBASE_MEMORY_MCP_REPOSITORY = "https://github.com/DeusData/codebase-memory-mcp";
export const CONTEXT7_MCP_URL = "https://mcp.context7.com/mcp";

const CODEBASE_MEMORY_INSTALL_PS1 =
  "https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.ps1";
const CODEBASE_MEMORY_INSTALL_SH =
  "https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh";

const CODEBASE_MEMORY_USAGE =
  "Consultar index_status antes de usar grafo como evidencia; depois usar get_architecture, "
  + "search_graph, trace_path e detect_changes em vez de varredura arquivo-a-arquivo.";

const CONTEXT7_USAGE =
  "Ao delegar task que envolve biblioteca, framework, SDK, API ou servico de nuvem, instruir o "
  + "Executor a resolver o identificador da biblioteca e buscar a documentacao atual antes de "
  + "escrever codigo que use essa biblioteca.";

const CODEBASE_MEMORY_NOT_DETECTED =
  "Codebase Memory MCP not detected in known project/Claude/Codex/Gemini config locations or on PATH.";

const CONTEXT7_NOT_DETECTED =
  "Context7 MCP not detected in known Claude/Codex/Antigravity/project config locations.";

function timeoutError(name, timeoutMs) {
  return `${name} MCP detection exceeded the ${timeoutMs} ms deadline; partial evidence preserved.`;
}

/**
 * Sequencia de instalacao do CBM_MCP para o SO detectado (Req 1.5, 4.5, 4.6).
 *
 * Windows usa a sequencia documentada de download do `install.ps1`,
 * `Unblock-File` e execucao do script; macOS e Linux usam o `install.sh`
 * publicado no repositorio.
 */
export function codebaseMemoryInstallCommands(platform = process.platform) {
  if (platform === "win32") {
    // `Join-Path` evita aspas aninhadas no `-Command` e cobre TEMP com espaco.
    const script = "(Join-Path $env:TEMP 'install-codebase-memory-mcp.ps1')";
    return [
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri ${CODEBASE_MEMORY_INSTALL_PS1} -OutFile ${script}"`,
      `powershell -NoProfile -Command "Unblock-File -Path ${script}"`,
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "& ${script}"`,
    ];
  }
  return [
    `curl -fsSL ${CODEBASE_MEMORY_INSTALL_SH} -o /tmp/install-codebase-memory-mcp.sh`,
    "bash /tmp/install-codebase-memory-mcp.sh",
  ];
}

/**
 * Remediacao do Context7_MCP ausente (Req 1.6, 4.7): a CLI oficial mais a
 * alternativa de registro manual da URL do servidor. Nenhuma variante inclui
 * chave de API ou cabecalho de autenticacao.
 */
export function context7InstallCommands() {
  return ["npx ctx7 setup --claude", `ou registrar manualmente a URL ${CONTEXT7_MCP_URL}`];
}

/** Comandos de instalacao por servidor e SO. */
export function mcpInstallCommands(server, platform = process.platform) {
  if (server === CODEBASE_MEMORY_MCP) return codebaseMemoryInstallCommands(platform);
  if (server === CONTEXT7_MCP) return context7InstallCommands();
  return [];
}

/**
 * Candidatos do CBM_MCP.
 *
 * As localizacoes exigidas pelo Req 1.3 vem primeiro (as cinco configuracoes
 * conhecidas e o binario no `PATH`), porque sao elas que precisam ser
 * inspecionadas antes de o deadline ter chance de estourar. Skill instalada
 * entra depois, como evidencia adicional.
 */
function codebaseMemorySpec({ home, projectRoot }) {
  return {
    name: CODEBASE_MEMORY_MCP,
    marker: /codebase[-_]memory/i,
    usage: CODEBASE_MEMORY_USAGE,
    notDetected: CODEBASE_MEMORY_NOT_DETECTED,
    label: "Codebase Memory",
    steps: [
      {
        kind: "config",
        paths: [
          join(projectRoot, ".mcp.json"),
          join(home, ".claude.json"),
          join(home, ".claude", "mcp.json"),
          join(home, ".codex", "config.toml"),
          join(home, ".gemini", "config", "mcp_config.json"),
        ],
      },
      { kind: "binary", names: [CODEBASE_MEMORY_MCP_BINARY] },
      {
        kind: "skill",
        paths: [
          join(home, ".claude", "skills", "codebase-memory", "SKILL.md"),
          join(home, ".claude", "skills", "codebase-memory-mcp", "SKILL.md"),
        ],
      },
    ],
  };
}

/**
 * Candidatos do Context7_MCP.
 *
 * Preserva a lista que o preflight ja inspecionava inline (skill, diretorio de
 * servidor do Antigravity e as configuracoes de Claude/Codex/Gemini/projeto) e
 * acrescenta a resolucao da CLI `ctx7` no `PATH`.
 */
function context7Spec({ home, projectRoot }) {
  return {
    name: CONTEXT7_MCP,
    marker: /\bcontext7\b|@upstash\/context7-mcp|mcp\.context7\.com|ctx7/i,
    usage: CONTEXT7_USAGE,
    notDetected: CONTEXT7_NOT_DETECTED,
    label: "Context7",
    steps: [
      {
        kind: "skill",
        paths: [
          join(home, ".claude", "skills", "context7", "SKILL.md"),
          join(home, ".claude", "skills", "context7-mcp", "SKILL.md"),
        ],
      },
      {
        kind: "mcp-directory",
        paths: [
          join(home, ".gemini", "antigravity-cli", "mcp", "context7"),
          join(home, ".gemini", "antigravity-cli", "plugins", "context7"),
        ],
      },
      {
        kind: "config",
        paths: [
          join(projectRoot, ".mcp.json"),
          join(home, ".claude.json"),
          join(home, ".claude", "mcp.json"),
          join(home, ".config", "claude", "mcp.json"),
          join(home, ".codex", "config.toml"),
          join(home, ".gemini", "config", "mcp_config.json"),
          join(home, ".gemini", "settings.json"),
          join(home, ".gemini", "mcp.json"),
          join(home, ".gemini", "antigravity-cli", "settings.json"),
          join(home, ".gemini", "antigravity-cli", "import_manifest.json"),
          join(home, ".gemini", "antigravity-cli", "plugins", "context7", "mcp_config.json"),
        ],
      },
      { kind: "binary", names: ["ctx7"] },
    ],
  };
}

function normalizeOptions(options = {}) {
  const timeout = Number(options.timeoutMs);
  return {
    home: options.home ?? homedir(),
    projectRoot: resolve(options.projectRoot ?? process.cwd()),
    now: typeof options.now === "function" ? options.now : Date.now,
    timeoutMs: Number.isFinite(timeout) && timeout >= 0 ? timeout : MCP_DETECT_TIMEOUT_MS,
    platform: options.platform ?? process.platform,
    env: options.env ?? process.env,
    pathLookup: typeof options.pathLookup === "function" ? options.pathLookup : null,
  };
}

function firstLine(message, fallback) {
  const text = String(message ?? "").split(/\r?\n/)[0].trim();
  return text === "" ? fallback : text;
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function isRegularFile(path) {
  const stats = statSync(path, { throwIfNoEntry: false });
  return stats !== undefined && stats.isFile();
}

/**
 * Resolve um nome de binario no `PATH` sem shell e sem executar o binario.
 *
 * Le a propria variavel de ambiente (`PATH`, ou `Path`/`PATHEXT` no Windows) e
 * testa a existencia de arquivo regular em cada diretorio. `pathLookup`
 * injetado tem precedencia e pode devolver um caminho, uma lista de caminhos ou
 * um valor falsy para "nao encontrado".
 *
 * @returns {string[]} caminhos encontrados (no maximo um por nome).
 */
function lookupBinary(name, { pathLookup, env, platform }) {
  if (pathLookup !== null) {
    const found = pathLookup(name, { env, platform });
    const list = Array.isArray(found) ? found : [found];
    return list.filter((entry) => typeof entry === "string" && entry.trim() !== "");
  }

  const rawPath = env.PATH ?? env.Path ?? env.path ?? "";
  const directories = String(rawPath)
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
    .filter((entry) => entry !== "");

  const extensions =
    platform === "win32"
      ? [
          "",
          ...String(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
            .split(";")
            .map((entry) => entry.trim())
            .filter((entry) => entry !== ""),
        ]
      : [""];

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`);
      try {
        if (isRegularFile(candidate)) return [candidate];
      } catch {
        // Diretorio inacessivel no PATH nao e evidencia nem erro de MCP: segue
        // para o candidato seguinte.
      }
    }
  }
  return [];
}

function pushEvidence(evidence, seen, item) {
  const key = `${item.type}\u0000${item.path}`;
  if (seen.has(key)) return;
  seen.add(key);
  evidence.push(item);
}

/**
 * Inspeciona um arquivo de configuracao MCP.
 *
 * Arquivo ausente nao gera evidencia. Arquivo ilegivel — ou JSON invalido, no
 * caso de candidato `.json` — gera `mcp-config-unreadable` com a primeira linha
 * do erro. Somente o resultado booleano do teste de marcador entra no
 * resultado; o conteudo lido nunca e copiado para a evidencia.
 */
function inspectConfig(path, spec, evidence, seen) {
  if (!existsSync(path)) return;

  let contents;
  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    pushEvidence(evidence, seen, {
      type: MCP_EVIDENCE_UNREADABLE,
      path,
      error: firstLine(error?.message, "cannot read file"),
    });
    return;
  }

  if (path.toLowerCase().endsWith(".json")) {
    try {
      JSON.parse(stripBom(contents));
    } catch (error) {
      pushEvidence(evidence, seen, {
        type: MCP_EVIDENCE_UNREADABLE,
        path,
        error: firstLine(error?.message, "invalid JSON"),
      });
      return;
    }
  }

  if (spec.marker.test(contents)) {
    pushEvidence(evidence, seen, { type: "mcp-config", path });
  }
}

/**
 * Executa a varredura de um servidor respeitando o deadline.
 *
 * Antes de cada candidato compara `now()` com o deadline. Ao estourar, para a
 * varredura e devolve `timedOut: true` com as evidencias ja coletadas.
 */
function scan(spec, context) {
  const { now, timeoutMs } = context;
  const start = now();
  const deadline = start + timeoutMs;
  const evidence = [];
  const seen = new Set();
  let timedOut = false;

  const expired = () => now() >= deadline;

  for (const step of spec.steps) {
    if (expired()) {
      timedOut = true;
      break;
    }

    if (step.kind === "binary") {
      for (const name of step.names) {
        if (expired()) {
          timedOut = true;
          break;
        }
        for (const path of lookupBinary(name, context)) {
          pushEvidence(evidence, seen, { type: "binary", path });
        }
      }
    } else {
      for (const path of step.paths) {
        if (expired()) {
          timedOut = true;
          break;
        }
        if (step.kind === "config") {
          inspectConfig(path, spec, evidence, seen);
          continue;
        }
        if (existsSync(path)) {
          pushEvidence(evidence, seen, { type: step.kind, path });
        }
      }
    }

    if (timedOut) break;
  }

  return { evidence, timedOut, elapsedMs: Math.max(0, now() - start) };
}

/**
 * Deteccao de um servidor MCP a partir da sua especificacao de candidatos.
 *
 * @returns {{
 *   ok: boolean,
 *   optional: true,
 *   evidence: Array<{ type: string, path: string, error?: string }>,
 *   elapsedMs: number,
 *   usage?: string,
 *   error?: string,
 *   reason?: string,
 *   install?: string[],
 * }}
 */
function detectServer(spec, context) {
  const { evidence, timedOut, elapsedMs } = scan(spec, context);
  const detected = evidence.some((item) => item.type !== MCP_EVIDENCE_UNREADABLE);

  if (detected && !timedOut) {
    return { ok: true, optional: true, evidence, usage: spec.usage, elapsedMs };
  }

  return {
    ok: false,
    optional: true,
    evidence,
    error: timedOut ? timeoutError(spec.label, context.timeoutMs) : spec.notDetected,
    reason: timedOut ? MCP_DETECT_REASONS.TIMEOUT : MCP_DETECT_REASONS.NOT_DETECTED,
    install: mcpInstallCommands(spec.name, context.platform),
    elapsedMs,
  };
}

/**
 * Detecta o CBM_MCP (`codebase-memory-mcp`).
 *
 * Inspeciona `.mcp.json` do projeto, `~/.claude.json`, `~/.claude/mcp.json`,
 * `~/.codex/config.toml`, `~/.gemini/config/mcp_config.json`, o binario
 * `codebase-memory-mcp` no `PATH` e a skill correspondente, nessa ordem
 * (Req 1.3, 1.4). Ausente devolve `install` com a sequencia do SO detectado
 * (Req 1.5).
 *
 * @param {{
 *   projectRoot?: string,
 *   home?: string,
 *   now?: () => number,
 *   timeoutMs?: number,
 *   pathLookup?: (name: string, context: object) => string | string[] | null,
 *   platform?: string,
 *   env?: Record<string, string | undefined>,
 * }} [options]
 */
export function detectCodebaseMemoryMcp(options = {}) {
  const context = normalizeOptions(options);
  return detectServer(codebaseMemorySpec(context), context);
}

/**
 * Detecta o Context7_MCP (`context7`).
 *
 * Ausente devolve `install` com `npx ctx7 setup --claude` e a alternativa de
 * registro manual da URL do servidor (Req 1.6), sem chave de API e sem
 * cabecalho de autenticacao.
 *
 * @param {Parameters<typeof detectCodebaseMemoryMcp>[0]} [options]
 */
export function detectContext7Mcp(options = {}) {
  const context = normalizeOptions(options);
  return detectServer(context7Spec(context), context);
}

/**
 * Detecta os dois MCPs opcionais, cada um com o seu proprio deadline.
 *
 * O resultado e exatamente o bloco `checks.optional.mcp` do relatorio de
 * preflight (Req 1.1, 1.2).
 *
 * @param {Parameters<typeof detectCodebaseMemoryMcp>[0]} [options]
 * @returns {{ "codebase-memory": object, context7: object }}
 */
export function detectMcpServers(options = {}) {
  return {
    [CODEBASE_MEMORY_MCP]: detectCodebaseMemoryMcp(options),
    [CONTEXT7_MCP]: detectContext7Mcp(options),
  };
}
