import assert from "node:assert/strict";
import test from "node:test";

import {
  agentMcpInstallCommand,
  CODEBASE_MEMORY_BINARY,
  CONTEXT7_MCP_URL,
  installAgentMcp,
  removeAgentMcp,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/mcp-agent-install.mjs";

test("agentMcpInstallCommand renderiza o argv real confirmado ao vivo, por agente/servidor", () => {
  assert.equal(agentMcpInstallCommand("codex", "context7"), `codex mcp add context7 --url ${CONTEXT7_MCP_URL}`);
  assert.equal(
    agentMcpInstallCommand("codex", "codebase-memory"),
    `codex mcp add ${CODEBASE_MEMORY_BINARY} -- ${CODEBASE_MEMORY_BINARY}`,
  );
  assert.equal(agentMcpInstallCommand("agy", "context7"), `agy mcp add context7 ${CONTEXT7_MCP_URL}`);
  assert.equal(
    agentMcpInstallCommand("agy", "codebase-memory"),
    `agy mcp add ${CODEBASE_MEMORY_BINARY} ${CODEBASE_MEMORY_BINARY}`,
  );
});

test("agentMcpInstallCommand retorna null para par agente/servidor desconhecido", () => {
  assert.equal(agentMcpInstallCommand("kiro", "context7"), null);
  assert.equal(agentMcpInstallCommand("codex", "playwright"), null);
});

test("nenhum comando de instalacao carrega chave de API embutida", () => {
  for (const agent of ["codex", "agy"]) {
    for (const server of ["context7", "codebase-memory"]) {
      const command = agentMcpInstallCommand(agent, server);
      assert.ok(!/api[-_]?key/i.test(command), `${agent}/${server}: comando nao deveria mencionar api key`);
      assert.ok(!/ctx7sk-/i.test(command), `${agent}/${server}: comando nao deveria carregar uma chave real`);
    }
  }
});

test("installAgentMcp roda o comando via execFn injetado e reporta sucesso", () => {
  const calls = [];
  const execFn = (bin, args) => {
    calls.push({ bin, args });
    return "";
  };
  const result = installAgentMcp("codex", "context7", { execFn });
  assert.deepEqual(result, { ok: true, error: null });
  assert.deepEqual(calls, [{ bin: "codex", args: ["mcp", "add", "context7", "--url", CONTEXT7_MCP_URL] }]);
});

test("installAgentMcp reporta falha sem lancar quando o execFn falha", () => {
  const execFn = () => {
    const error = new Error("Command failed");
    error.stderr = "codex: server already exists\n";
    throw error;
  };
  const result = installAgentMcp("codex", "context7", { execFn });
  assert.equal(result.ok, false);
  assert.match(result.error, /already exists/);
});

test("installAgentMcp: par agente/servidor desconhecido -> ok false sem chamar execFn", () => {
  let called = false;
  const execFn = () => {
    called = true;
    return "";
  };
  const result = installAgentMcp("kiro", "context7", { execFn });
  assert.equal(result.ok, false);
  assert.match(result.error, /unknown agent\/server pair/);
  assert.equal(called, false);
});

test("removeAgentMcp roda mcp remove <name> via execFn injetado", () => {
  const calls = [];
  const execFn = (bin, args) => {
    calls.push({ bin, args });
    return "";
  };
  const result = removeAgentMcp("agy", "test-throwaway-server", { execFn });
  assert.deepEqual(result, { ok: true, error: null });
  assert.deepEqual(calls, [{ bin: "agy", args: ["mcp", "remove", "test-throwaway-server"] }]);
});

test("removeAgentMcp reporta falha sem lancar quando o execFn falha", () => {
  const execFn = () => {
    const error = new Error("Command failed");
    error.stderr = "no such server: test-throwaway-server\n";
    throw error;
  };
  const result = removeAgentMcp("agy", "test-throwaway-server", { execFn });
  assert.equal(result.ok, false);
  assert.match(result.error, /no such server/);
});
