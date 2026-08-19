import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  CODEBASE_MEMORY_MCP,
  CODEBASE_MEMORY_MCP_BINARY,
  CONTEXT7_MCP,
  CONTEXT7_MCP_URL,
  MCP_DETECT_REASONS,
  MCP_DETECT_TIMEOUT_MS,
  MCP_EVIDENCE_UNREADABLE,
  MCP_SERVER_NAMES,
  codebaseMemoryInstallCommands,
  context7InstallCommands,
  detectCodebaseMemoryMcp,
  detectContext7Mcp,
  detectMcpServers,
  mcpInstallCommands,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/mcp-detect.mjs";

/**
 * Testes unitarios da deteccao dos MCPs opcionais.
 *
 * Exemplos concretos por fixture de HOME e de projeto em diretorio temporario,
 * com `home`, `projectRoot`, `now`, `timeoutMs`, `env`, `platform` e
 * `pathLookup` injetados: nenhuma leitura do ambiente real da maquina, nenhuma
 * I/O de rede, nenhum processo externo.
 *
 * Cobre a remediacao exata do Context7 ausente (Req 1.6), o deadline por MCP
 * com relogio injetado produzindo `TIMEOUT` (Req 1.9) e a sequencia de
 * instalacao do CBM_MCP por sistema operacional (Req 4.5, 4.6).
 */

/** Chave semeada nas fixtures para provar que segredo nao entra no resultado. */
const SEEDED_API_KEY = "sk-nunca-deve-aparecer-no-relatorio";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** Cria `project/`, `home/` e `bin/` em diretorio temporario descartado no fim. */
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "mcp-detect-unit-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const projectRoot = join(root, "project");
  const home = join(root, "home");
  const binDir = join(root, "bin");
  for (const directory of [projectRoot, home, binDir]) mkdirSync(directory, { recursive: true });

  return { root, projectRoot, home, binDir };
}

function seedFile(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
  return path;
}

/** Configuracao MCP com os servidores pedidos, mais uma chave de API semeada. */
function mcpConfig(...servers) {
  return `${JSON.stringify(
    {
      mcpServers: Object.fromEntries(
        servers.map((name) => [
          name,
          { command: "npx", args: ["-y", name], env: { API_KEY: SEEDED_API_KEY } },
        ]),
      ),
    },
    null,
    2,
  )}\n`;
}

/**
 * Opcoes base da deteccao: relogio congelado (nenhum deadline estoura), `env`
 * vazio e `pathLookup` que nao encontra nada. Cada teste sobrepoe o que precisa.
 */
function options(paths, overrides = {}) {
  return {
    projectRoot: paths.projectRoot,
    home: paths.home,
    now: () => 1_000,
    timeoutMs: MCP_DETECT_TIMEOUT_MS,
    env: {},
    platform: "linux",
    pathLookup: () => null,
    ...overrides,
  };
}

/** Relogio injetado que avanca `step` ms a cada leitura. */
function steppingClock(step = 1) {
  let current = -step;
  return () => {
    current += step;
    return current;
  };
}

function evidenceOf(result, type, path) {
  return result.evidence.find((entry) => entry.type === type && entry.path === path);
}

/* -------------------------------------------------------------------------- */
/* Fixture de HOME e de projeto (Req 1.1 a 1.4, 1.8, 1.10)                    */
/* -------------------------------------------------------------------------- */

test("detecta o CBM_MCP no .mcp.json do projeto e o Context7 na configuracao do HOME", (t) => {
  const paths = fixture(t);
  const projectConfig = seedFile(
    join(paths.projectRoot, ".mcp.json"),
    mcpConfig("codebase-memory-mcp"),
  );
  const claudeConfig = seedFile(join(paths.home, ".claude.json"), mcpConfig("context7"));

  const results = detectMcpServers(options(paths));
  assert.deepEqual(Object.keys(results), [...MCP_SERVER_NAMES]);

  const cbm = results[CODEBASE_MEMORY_MCP];
  assert.equal(cbm.ok, true);
  assert.equal(cbm.optional, true);
  assert.ok(evidenceOf(cbm, "mcp-config", projectConfig), "CBM deveria vir do .mcp.json do projeto");
  assert.equal(cbm.install, undefined, "MCP detectado nao carrega comandos de instalacao");
  assert.match(cbm.usage, /index_status/);

  const context7 = results[CONTEXT7_MCP];
  assert.equal(context7.ok, true);
  assert.equal(context7.optional, true);
  assert.ok(evidenceOf(context7, "mcp-config", claudeConfig), "Context7 deveria vir de ~/.claude.json");
  assert.equal(context7.install, undefined);

  // Req 1.10: evidencia carrega apenas tipo e caminho; a chave de API semeada
  // no conteudo lido nao chega ao relatorio.
  for (const result of Object.values(results)) {
    for (const entry of result.evidence) {
      assert.deepEqual(Object.keys(entry).sort(), ["path", "type"]);
    }
  }
  assert.ok(
    !JSON.stringify(results).includes(SEEDED_API_KEY),
    "o resultado nao pode conter chave de API",
  );
});

test("configuracao ilegivel gera mcp-config-unreadable e a varredura continua", (t) => {
  const paths = fixture(t);
  const broken = seedFile(join(paths.projectRoot, ".mcp.json"), '{ "mcpServers": ');
  const codex = seedFile(
    join(paths.home, ".codex", "config.toml"),
    '[mcp_servers."codebase-memory-mcp"]\ncommand = "npx"\n',
  );

  const result = detectCodebaseMemoryMcp(options(paths));

  const unreadable = evidenceOf(result, MCP_EVIDENCE_UNREADABLE, broken);
  assert.ok(unreadable, "JSON invalido deveria gerar evidencia mcp-config-unreadable");
  assert.equal(typeof unreadable.error, "string");
  assert.notEqual(unreadable.error.trim(), "");

  assert.ok(evidenceOf(result, "mcp-config", codex), "a varredura deveria seguir para ~/.codex");
  assert.equal(result.ok, true, "evidencia utilizavel posterior mantem ok verdadeiro");
});

test("binario resolvido no PATH conta como evidencia, sem shell e sem executar nada", (t) => {
  const paths = fixture(t);
  const binary = seedFile(join(paths.binDir, CODEBASE_MEMORY_MCP_BINARY), "#!/bin/sh\n");

  const result = detectCodebaseMemoryMcp(
    options(paths, { env: { PATH: paths.binDir }, pathLookup: undefined }),
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.evidence, [{ type: "binary", path: binary }]);
});

/* -------------------------------------------------------------------------- */
/* Remediacao do Context7 ausente (Req 1.6)                                   */
/* -------------------------------------------------------------------------- */

test("Context7 ausente devolve exatamente a remediacao documentada", (t) => {
  const paths = fixture(t);
  const expected = ["npx ctx7 setup --claude", `ou registrar manualmente a URL ${CONTEXT7_MCP_URL}`];

  const result = detectContext7Mcp(options(paths));

  assert.equal(result.ok, false);
  assert.equal(result.optional, true);
  assert.deepEqual(result.evidence, []);
  assert.equal(result.reason, MCP_DETECT_REASONS.NOT_DETECTED);
  assert.match(result.error, /Context7 MCP not detected/);
  assert.deepEqual(result.install, expected);
  assert.equal(CONTEXT7_MCP_URL, "https://mcp.context7.com/mcp");

  // A remediacao do Context7 nao depende do SO e nao carrega credencial.
  for (const platform of ["win32", "darwin", "linux"]) {
    assert.deepEqual(detectContext7Mcp(options(paths, { platform })).install, expected);
    assert.deepEqual(mcpInstallCommands(CONTEXT7_MCP, platform), expected);
  }
  assert.deepEqual(context7InstallCommands(), expected);
  for (const command of expected) {
    assert.doesNotMatch(command, /api[-_ ]?key|authorization|bearer|token/i);
  }
});

/* -------------------------------------------------------------------------- */
/* Comandos do CBM_MCP por sistema operacional (Req 4.5, 4.6)                 */
/* -------------------------------------------------------------------------- */

test("CBM_MCP em Windows usa download do install.ps1, Unblock-File e execucao", () => {
  const commands = codebaseMemoryInstallCommands("win32");

  assert.equal(commands.length, 3);
  for (const command of commands) assert.match(command, /^powershell -NoProfile/);
  assert.match(commands[0], /Invoke-WebRequest -Uri \S+\/install\.ps1 -OutFile/);
  assert.match(commands[1], /Unblock-File -Path/);
  assert.match(commands[2], /-Command "& \(Join-Path \$env:TEMP 'install-codebase-memory-mcp\.ps1'\)"/);
  for (const command of commands) assert.match(command, /install-codebase-memory-mcp\.ps1/);

  assert.deepEqual(mcpInstallCommands(CODEBASE_MEMORY_MCP, "win32"), commands);
});

test("CBM_MCP em macOS e Linux usa o install.sh publicado no repositorio", () => {
  const expected = [
    "curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh"
      + " -o /tmp/install-codebase-memory-mcp.sh",
    "bash /tmp/install-codebase-memory-mcp.sh",
  ];

  for (const platform of ["darwin", "linux"]) {
    assert.deepEqual(codebaseMemoryInstallCommands(platform), expected);
    assert.deepEqual(mcpInstallCommands(CODEBASE_MEMORY_MCP, platform), expected);
  }
  assert.deepEqual(mcpInstallCommands("servidor-desconhecido", "linux"), []);
});

test("CBM_MCP ausente carrega NOT_DETECTED e a sequencia do SO detectado", (t) => {
  const paths = fixture(t);

  for (const platform of ["win32", "darwin", "linux"]) {
    const result = detectCodebaseMemoryMcp(options(paths, { platform }));

    assert.equal(result.ok, false);
    assert.equal(result.optional, true);
    assert.equal(result.reason, MCP_DETECT_REASONS.NOT_DETECTED);
    assert.match(result.error, /Codebase Memory MCP not detected/);
    assert.deepEqual(result.install, codebaseMemoryInstallCommands(platform));
  }
});

/* -------------------------------------------------------------------------- */
/* Deadline por MCP com relogio injetado (Req 1.9)                            */
/* -------------------------------------------------------------------------- */

test("deadline estourado encerra com TIMEOUT preservando a evidencia coletada", (t) => {
  const paths = fixture(t);
  const projectConfig = seedFile(
    join(paths.projectRoot, ".mcp.json"),
    mcpConfig("codebase-memory-mcp"),
  );

  // Relogio de 1 ms por leitura com deadline de 3 ms: o primeiro candidato e
  // inspecionado, o segundo ja encontra o deadline estourado.
  const result = detectCodebaseMemoryMcp(
    options(paths, { now: steppingClock(1), timeoutMs: 3 }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.optional, true);
  assert.equal(result.reason, MCP_DETECT_REASONS.TIMEOUT);
  assert.match(result.error, /Codebase Memory MCP detection exceeded the 3 ms deadline/);
  assert.deepEqual(result.evidence, [{ type: "mcp-config", path: projectConfig }]);
  assert.deepEqual(result.install, codebaseMemoryInstallCommands("linux"));
  assert.ok(result.elapsedMs >= 3, `elapsedMs deveria refletir o relogio injetado: ${result.elapsedMs}`);
});

test("o deadline padrao e de 15 s por MCP e produz TIMEOUT quando o relogio o ultrapassa", (t) => {
  const paths = fixture(t);
  seedFile(join(paths.projectRoot, ".mcp.json"), mcpConfig("codebase-memory-mcp", "context7"));

  assert.equal(MCP_DETECT_TIMEOUT_MS, 15_000);

  // Sem `timeoutMs` explicito: o modulo aplica o deadline de 15 s. O relogio
  // salta 20 s depois do inicio, antes do primeiro candidato.
  const now = steppingClock(20_000);
  const results = detectMcpServers(options(paths, { now, timeoutMs: undefined }));

  for (const server of MCP_SERVER_NAMES) {
    const result = results[server];
    assert.equal(result.ok, false, `${server}: deadline estourado nao pode reportar ok`);
    assert.equal(result.reason, MCP_DETECT_REASONS.TIMEOUT);
    assert.match(result.error, /exceeded the 15000 ms deadline/);
    assert.deepEqual(result.evidence, [], "nenhum candidato foi inspecionado");
  }
});

test("cada MCP recebe o seu proprio deadline, nao um deadline compartilhado", (t) => {
  const paths = fixture(t);
  const projectConfig = seedFile(
    join(paths.projectRoot, ".mcp.json"),
    mcpConfig("codebase-memory-mcp"),
  );
  const skill = seedFile(
    join(paths.home, ".claude", "skills", "context7", "SKILL.md"),
    "# context7\n",
  );

  // Relogio unico e monotonico para as duas deteccoes: o segundo MCP ainda
  // inspeciona o seu primeiro candidato, prova de que o deadline reinicia.
  const results = detectMcpServers(options(paths, { now: steppingClock(1), timeoutMs: 3 }));

  assert.equal(results[CODEBASE_MEMORY_MCP].reason, MCP_DETECT_REASONS.TIMEOUT);
  assert.deepEqual(results[CODEBASE_MEMORY_MCP].evidence, [
    { type: "mcp-config", path: projectConfig },
  ]);

  assert.equal(results[CONTEXT7_MCP].reason, MCP_DETECT_REASONS.TIMEOUT);
  assert.deepEqual(results[CONTEXT7_MCP].evidence, [{ type: "skill", path: skill }]);
  assert.deepEqual(results[CONTEXT7_MCP].install, context7InstallCommands());
});
