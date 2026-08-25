import { execSync } from "node:child_process";

/**
 * Registers Context7 or Codebase Memory into the Codex/AGY CLI's own MCP
 * config — the write-side counterpart to `mcp-agent-cli.mjs`'s read-only
 * introspection.
 *
 * Commands confirmed against real CLI output (2026-08-24, codex-cli 0.148.0,
 * agy 1.1.17):
 *   codex mcp add <name> --url <url>            (streamable_http transport)
 *   agy   mcp add <name> <url>                  (http auto-detected from the URL)
 *   codex mcp add <name> -- <command> [args...] (stdio transport)
 *   agy   mcp add <name> <command> [args...]    (stdio, default type)
 *
 * Both servers register over the plain HTTP/stdio-by-name form — no API key
 * baked in. Context7 uses its public unauthenticated endpoint (works with
 * lower rate limits; the same URL `mcp-detect.mjs`'s file-based fallback
 * already points users at). Codebase Memory registers by binary name, not a
 * resolved absolute path, so it keeps working if the binary moves — it only
 * needs to already be on PATH (installed separately; see
 * `codebaseMemoryInstallCommands` in `mcp-detect.mjs` for that step).
 *
 * Posture (same as `cc-pensador`'s Open Design installer): this module is
 * never invoked automatically. It only runs after a human has explicitly
 * approved the specific agent + server via `AskUserQuestion` — see
 * `references/mcp-context.md`, "Oferta de instalacao". Every exported
 * function takes an injectable `execFn`, mirroring `mcp-agent-cli.mjs`, so
 * tests never spawn a real process.
 */

export const CONTEXT7_MCP_URL = "https://mcp.context7.com/mcp";
export const CODEBASE_MEMORY_BINARY = "codebase-memory-mcp";

/** Timeout for a single `mcp add`/`mcp remove` invocation, in milliseconds. */
export const AGENT_MCP_WRITE_TIMEOUT_MS = 15_000;

/** `{ bin, args }` per agent, per server — the exact argv `mcp add` runs. */
export const AGENT_MCP_ADD_COMMANDS = Object.freeze({
  codex: Object.freeze({
    context7: Object.freeze({ bin: "codex", args: Object.freeze(["mcp", "add", "context7", "--url", CONTEXT7_MCP_URL]) }),
    "codebase-memory": Object.freeze({
      bin: "codex",
      args: Object.freeze(["mcp", "add", CODEBASE_MEMORY_BINARY, "--", CODEBASE_MEMORY_BINARY]),
    }),
  }),
  agy: Object.freeze({
    context7: Object.freeze({ bin: "agy", args: Object.freeze(["mcp", "add", "context7", CONTEXT7_MCP_URL]) }),
    "codebase-memory": Object.freeze({
      bin: "agy",
      args: Object.freeze(["mcp", "add", CODEBASE_MEMORY_BINARY, CODEBASE_MEMORY_BINARY]),
    }),
  }),
});

/** `{ bin, args }` per agent — `mcp remove <name>`, for cleanup and tests. */
export const AGENT_MCP_REMOVE_COMMAND = Object.freeze({
  codex: (name) => ({ bin: "codex", args: ["mcp", "remove", name] }),
  agy: (name) => ({ bin: "agy", args: ["mcp", "remove", name] }),
});

/**
 * Renders the argv for `mcp add` as a display string, for the `AskUserQuestion`
 * prompt and for the workflow log — never executes it.
 *
 * @param {"codex"|"agy"} agent
 * @param {"context7"|"codebase-memory"} server
 * @returns {string|null} `null` when the agent/server pair is unknown.
 */
export function agentMcpInstallCommand(agent, server) {
  const entry = AGENT_MCP_ADD_COMMANDS[agent]?.[server];
  if (!entry) return null;
  return [entry.bin, ...entry.args].join(" ");
}

function defaultExecFn(bin, args, { timeoutMs }) {
  return execSync([bin, ...args].join(" "), {
    timeout: timeoutMs,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function normalizeExecOptions(options) {
  const execFn = typeof options.execFn === "function" ? options.execFn : defaultExecFn;
  const timeoutMsRaw = Number(options.timeoutMs);
  const timeoutMs =
    Number.isFinite(timeoutMsRaw) && timeoutMsRaw >= 0 ? timeoutMsRaw : AGENT_MCP_WRITE_TIMEOUT_MS;
  return { execFn, timeoutMs };
}

function firstLine(message, fallback) {
  const text = String(message ?? "").split(/\r?\n/)[0].trim();
  return text === "" ? fallback : text;
}

/**
 * Registers `server` in `agent`'s own MCP config via `mcp add`. Only call
 * this after explicit human approval (see module docstring) — it is the one
 * function in this pair of modules that mutates the agent's real, global CLI
 * configuration.
 *
 * @param {"codex"|"agy"} agent
 * @param {"context7"|"codebase-memory"} server
 * @param {{ execFn?: Function, timeoutMs?: number }} [options]
 * @returns {{ ok: boolean, error: string|null }}
 */
export function installAgentMcp(agent, server, options = {}) {
  const entry = AGENT_MCP_ADD_COMMANDS[agent]?.[server];
  if (!entry) {
    return { ok: false, error: `unknown agent/server pair: ${agent}/${server}` };
  }
  const { execFn, timeoutMs } = normalizeExecOptions(options);
  try {
    execFn(entry.bin, entry.args, { timeoutMs });
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: firstLine(error?.stderr ?? error?.message, "mcp add failed") };
  }
}

/**
 * Removes `name` from `agent`'s own MCP config via `mcp remove`. Used for
 * cleanup after a rejected/superseded install and by the test suite's live
 * add/remove cycle — never applied to a server the human did not ask to
 * remove.
 *
 * @param {"codex"|"agy"} agent
 * @param {string} name
 * @param {{ execFn?: Function, timeoutMs?: number }} [options]
 * @returns {{ ok: boolean, error: string|null }}
 */
export function removeAgentMcp(agent, name, options = {}) {
  const build = AGENT_MCP_REMOVE_COMMAND[agent];
  if (!build) {
    return { ok: false, error: `unknown agent: ${agent}` };
  }
  const { execFn, timeoutMs } = normalizeExecOptions(options);
  const { bin, args } = build(name);
  try {
    execFn(bin, args, { timeoutMs });
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: firstLine(error?.stderr ?? error?.message, "mcp remove failed") };
  }
}
