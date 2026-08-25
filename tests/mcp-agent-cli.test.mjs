import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_CLI_REASONS,
  detectAgentMcpServers,
  parseAgyMcpList,
  parseCodexMcpList,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/mcp-agent-cli.mjs";

/**
 * Fixtures captured from real `codex mcp list --json` (codex-cli 0.148.0) and
 * `agy mcp list` (agy 1.1.17) output, 2026-08-24. Both intentionally include a
 * server whose definition carries a raw API key, to prove the parsers never
 * forward it.
 */

const CODEX_JSON_FIXTURE = JSON.stringify([
  {
    name: "codebase-memory-mcp",
    enabled: true,
    disabled_reason: null,
    transport: {
      type: "stdio",
      command: "C:/Users/allan/AppData/Local/Programs/codebase-memory-mcp/codebase-memory-mcp.exe",
      args: [],
      env: null,
      env_vars: [],
      cwd: null,
    },
    startup_timeout_sec: null,
    tool_timeout_sec: null,
    auth_status: "unsupported",
  },
  {
    name: "context7",
    enabled: true,
    disabled_reason: null,
    transport: {
      type: "streamable_http",
      url: "https://mcp.context7.com/mcp",
      bearer_token_env_var: null,
      http_headers: { CONTEXT7_API_KEY: "ctx7sk-542fab17-6e04-4981-9041-61af468209ec" },
      env_http_headers: null,
      http_headers_helper: null,
    },
    startup_timeout_sec: null,
    tool_timeout_sec: null,
    auth_status: "not_logged_in",
  },
  {
    name: "disabled-example",
    enabled: false,
    disabled_reason: "manually disabled",
    transport: { type: "stdio", command: "npx", args: ["-y", "some-mcp"], env: null, env_vars: [], cwd: null },
    startup_timeout_sec: null,
    tool_timeout_sec: null,
    auth_status: "unsupported",
  },
]);

const AGY_TABLE_FIXTURE = [
  "NAME                 TYPE   STATUS   COMMAND/URL",
  "TestSprite           stdio  enabled  npx @testsprite/testsprite-mcp@latest",
  "codebase-memory-mcp  stdio  enabled  C:/Users/allan/AppData/Local/Programs/codebase-memory-mcp/codebase-memory-mcp.exe",
  "context7             stdio  enabled  npx -y @upstash/context7-mcp --api-key ctx7sk-40a1e2a9-2dc1-4062-9897-afa3a04e62a8",
  "disabled-example      http   disabled https://example.com/mcp?token=secret-value",
].join("\n");

test("parseCodexMcpList extrai name/enabled/type e descarta transport.url/headers/env", () => {
  const servers = parseCodexMcpList(CODEX_JSON_FIXTURE);
  assert.equal(servers.size, 3);
  assert.deepEqual(servers.get("codebase-memory-mcp"), { enabled: true, type: "stdio" });
  assert.deepEqual(servers.get("context7"), { enabled: true, type: "streamable_http" });
  assert.deepEqual(servers.get("disabled-example"), { enabled: false, type: "stdio" });

  const serialized = JSON.stringify([...servers.values()]);
  assert.ok(!serialized.includes("ctx7sk-"), "chave de API do context7 nao pode sobreviver ao parser");
  assert.ok(!serialized.includes("mcp.context7.com"), "URL nao deveria ser extraida");
});

test("parseCodexMcpList retorna null para JSON invalido ou nao-array", () => {
  assert.equal(parseCodexMcpList("nao e json"), null);
  assert.equal(parseCodexMcpList(JSON.stringify({ not: "an array" })), null);
});

test("parseAgyMcpList extrai name/enabled/type e descarta a coluna COMMAND/URL", () => {
  const servers = parseAgyMcpList(AGY_TABLE_FIXTURE);
  assert.equal(servers.size, 4);
  assert.deepEqual(servers.get("codebase-memory-mcp"), { enabled: true, type: "stdio" });
  assert.deepEqual(servers.get("context7"), { enabled: true, type: "stdio" });
  assert.deepEqual(servers.get("disabled-example"), { enabled: false, type: "http" });

  const serialized = JSON.stringify([...servers.values()]);
  assert.ok(!serialized.includes("ctx7sk-"), "chave de API embutida no comando nao pode sobreviver ao parser");
  assert.ok(!serialized.includes("secret-value"), "token de URL nao deveria ser extraido");
});

test("parseAgyMcpList retorna null quando a primeira linha nao e um cabecalho reconhecivel", () => {
  assert.equal(parseAgyMcpList("No MCP servers configured."), null);
  assert.equal(parseAgyMcpList(""), null);
});

test("detectAgentMcpServers(codex): server presente e habilitado -> ok true, matched", () => {
  const execFn = () => CODEX_JSON_FIXTURE;
  const result = detectAgentMcpServers("codex", ["codebase-memory-mcp", "codebase-memory"], { execFn });
  assert.deepEqual(result, { checked: true, reason: null, matched: "codebase-memory-mcp", ok: true });
});

test("detectAgentMcpServers(codex): server presente mas desabilitado -> ok false", () => {
  const execFn = () => CODEX_JSON_FIXTURE;
  const result = detectAgentMcpServers("codex", ["disabled-example"], { execFn });
  assert.deepEqual(result, { checked: true, reason: null, matched: "disabled-example", ok: false });
});

test("detectAgentMcpServers(codex): server ausente -> checked true, ok false, matched null", () => {
  const execFn = () => CODEX_JSON_FIXTURE;
  const result = detectAgentMcpServers("codex", ["nunca-registrado"], { execFn });
  assert.deepEqual(result, { checked: true, reason: null, matched: null, ok: false });
});

test("detectAgentMcpServers(agy): server presente e habilitado -> ok true", () => {
  const execFn = () => AGY_TABLE_FIXTURE;
  const result = detectAgentMcpServers("agy", ["context7", "context7-mcp"], { execFn });
  assert.deepEqual(result, { checked: true, reason: null, matched: "context7", ok: true });
});

test("detectAgentMcpServers: binario ausente via ENOENT (execFn sem shell) -> checked false, reason BINARY_MISSING", () => {
  const execFn = () => {
    const error = new Error("spawn codex ENOENT");
    error.code = "ENOENT";
    throw error;
  };
  const result = detectAgentMcpServers("codex", ["context7"], { execFn });
  assert.equal(result.checked, false);
  assert.equal(result.reason, AGENT_CLI_REASONS.BINARY_MISSING);
  assert.equal(result.ok, false);
});

test("detectAgentMcpServers: binario ausente via shell (cmd.exe 'nao e reconhecido') -> reason BINARY_MISSING", () => {
  const execFn = () => {
    const error = new Error("Command failed: codex mcp list --json");
    error.status = 1;
    error.stderr = "'codex' is not recognized as an internal or external command,\r\noperable program or batch file.\r\n";
    throw error;
  };
  const result = detectAgentMcpServers("codex", ["context7"], { execFn });
  assert.equal(result.checked, false);
  assert.equal(result.reason, AGENT_CLI_REASONS.BINARY_MISSING);
});

test("detectAgentMcpServers: binario ausente via shell POSIX ('command not found') -> reason BINARY_MISSING", () => {
  const execFn = () => {
    const error = new Error("Command failed: agy mcp list");
    error.status = 127;
    error.stderr = "/bin/sh: agy: command not found\n";
    throw error;
  };
  const result = detectAgentMcpServers("agy", ["context7"], { execFn });
  assert.equal(result.checked, false);
  assert.equal(result.reason, AGENT_CLI_REASONS.BINARY_MISSING);
});

test("detectAgentMcpServers: timeout -> checked false, reason TIMEOUT", () => {
  const execFn = () => {
    const error = new Error("etimedout");
    error.killed = true;
    error.signal = "SIGTERM";
    throw error;
  };
  const result = detectAgentMcpServers("codex", ["context7"], { execFn });
  assert.equal(result.checked, false);
  assert.equal(result.reason, AGENT_CLI_REASONS.TIMEOUT);
});

test("detectAgentMcpServers: saida nao parseavel -> checked false, reason UNPARSEABLE_OUTPUT", () => {
  const execFn = () => "algo inesperado, nao e json nem tabela";
  const result = detectAgentMcpServers("codex", ["context7"], { execFn });
  assert.equal(result.checked, false);
  assert.equal(result.reason, AGENT_CLI_REASONS.UNPARSEABLE_OUTPUT);
});

test("detectAgentMcpServers: agente desconhecido lanca erro descritivo", () => {
  assert.throws(() => detectAgentMcpServers("kiro", ["x"], { execFn: () => "" }), /unknown agent "kiro"/);
});

test("detectAgentMcpServers passa o comando e argumentos corretos por agente ao execFn injetado", () => {
  const calls = [];
  const execFn = (bin, args) => {
    calls.push({ bin, args });
    return bin === "codex" ? CODEX_JSON_FIXTURE : AGY_TABLE_FIXTURE;
  };
  detectAgentMcpServers("codex", ["context7"], { execFn });
  detectAgentMcpServers("agy", ["context7"], { execFn });
  assert.deepEqual(calls, [
    { bin: "codex", args: ["mcp", "list", "--json"] },
    { bin: "agy", args: ["mcp", "list"] },
  ]);
});
