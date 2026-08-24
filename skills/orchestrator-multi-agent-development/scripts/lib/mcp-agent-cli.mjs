import { execSync } from "node:child_process";

/**
 * Live introspection of MCP servers registered in the Codex and AGY CLIs
 * themselves — `codex mcp list --json` and `agy mcp list` — instead of
 * guessing from config-file conventions the way `mcp-detect.mjs` does.
 *
 * Why this exists: `mcp-detect.mjs` infers "is codebase-memory available to
 * Codex" by checking whether a marker string appears somewhere under
 * `~/.codex/config.toml`, and has no AGY-specific candidate path for
 * codebase-memory at all (only Context7 got AGY-specific candidates). Both
 * CLIs expose a real `mcp list` subcommand that reports exactly what that
 * specific CLI has registered and enabled — confirmed against live output
 * (2026-08-24, codex-cli 0.148.0, agy 1.1.17):
 *
 *   codex mcp list --json  -> JSON array with `name`, `enabled`, `transport.type`,
 *                              PLUS `transport.http_headers` / `transport.env`,
 *                              which CAN contain a raw API key.
 *   agy mcp list            -> fixed-width table NAME/TYPE/STATUS/COMMAND/URL,
 *                              whose COMMAND/URL column can equally embed a key
 *                              (observed: `npx -y @upstash/context7-mcp --api-key ctx7sk-...`).
 *
 * Redaction rule (same as `mcp-detect.mjs`'s Req 1.10): only `name`, `enabled`/
 * `status` and `transport.type` are ever extracted. Header, env, URL and
 * command-line content is discarded before it leaves the parser — never
 * forwarded, never logged.
 *
 * Pure in the same sense as `mcp-detect.mjs`: the actual `child_process` call
 * is isolated in `defaultExecFn`, and every exported detection function takes
 * an injectable `execFn`, so tests exercise real captured fixture strings
 * without spawning `codex`/`agy` and without depending on either being
 * installed on the machine running the suite.
 */

/** Deadline for a single `mcp list` invocation, in milliseconds. */
export const AGENT_CLI_TIMEOUT_MS = 10_000;

export const AGENT_MCP_LIST_COMMANDS = Object.freeze({
  codex: Object.freeze({ bin: "codex", args: Object.freeze(["mcp", "list", "--json"]) }),
  agy: Object.freeze({ bin: "agy", args: Object.freeze(["mcp", "list"]) }),
});

/** Reasons `detectAgentMcpServers` can report when it could not establish ground truth. */
export const AGENT_CLI_REASONS = Object.freeze({
  BINARY_MISSING: "BINARY_MISSING",
  TIMEOUT: "TIMEOUT",
  EXEC_ERROR: "EXEC_ERROR",
  UNPARSEABLE_OUTPUT: "UNPARSEABLE_OUTPUT",
});

/**
 * Parses `codex mcp list --json`.
 *
 * @returns {Map<string, {enabled: boolean, type: string|null}>|null} `null`
 *   when `jsonText` is not a JSON array (malformed output, unexpected CLI
 *   version).
 */
export function parseCodexMcpList(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const servers = new Map();
  for (const entry of parsed) {
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    if (name === "") continue;
    servers.set(name, {
      enabled: entry?.enabled === true,
      type: typeof entry?.transport?.type === "string" ? entry.transport.type : null,
    });
  }
  return servers;
}

/**
 * Parses the fixed-width table printed by `agy mcp list`
 * (`NAME  TYPE  STATUS  COMMAND/URL`). Column boundaries are derived from the
 * header row's own column positions, so it survives name-column width
 * changes across AGY versions; it does not survive a header rename.
 *
 * @returns {Map<string, {enabled: boolean, type: string|null}>|null} `null`
 *   when the first non-empty line is not a recognizable `NAME ... TYPE ...
 *   STATUS` header (empty-server-list messages, unexpected CLI version).
 */
export function parseAgyMcpList(tableText) {
  const lines = String(tableText ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  if (lines.length === 0) return null;

  const header = lines[0];
  const nameStart = header.indexOf("NAME");
  const typeStart = header.indexOf("TYPE");
  const statusStart = header.indexOf("STATUS");
  const commandStart = header.indexOf("COMMAND/URL");
  if (nameStart !== 0 || typeStart < 0 || statusStart < 0 || statusStart < typeStart) return null;

  const servers = new Map();
  for (const line of lines.slice(1)) {
    const name = line.slice(nameStart, typeStart).trim();
    if (name === "") continue;
    const type = line.slice(typeStart, statusStart).trim();
    const statusEnd = commandStart > statusStart ? commandStart : undefined;
    const status = line.slice(statusStart, statusEnd).trim();
    servers.set(name, { enabled: status.toLowerCase() === "enabled", type: type || null });
  }
  return servers;
}

const PARSERS = Object.freeze({
  codex: parseCodexMcpList,
  agy: parseAgyMcpList,
});

/**
 * Matches the shell's own "command not found" message. `defaultExecFn` runs
 * through a shell (`execSync`, not `execFileSync` — see its docstring), so a
 * missing binary never surfaces as a Node-level `ENOENT`: cmd.exe exits 1 with
 * "'codex' is not recognized..." on stderr (confirmed live on Windows),
 * POSIX shells print "command not found" or "<bin>: not found". `error.code
 * === "ENOENT"` is kept as a fallback for an injected `execFn` that bypasses
 * the shell.
 */
const BINARY_MISSING_PATTERN = /is not recognized as|command not found|:\s*not found\b/i;

function classifyExecError(error) {
  if (error?.killed === true || error?.signal === "SIGTERM" || error?.code === "ETIMEDOUT") {
    return AGENT_CLI_REASONS.TIMEOUT;
  }
  if (error?.code === "ENOENT") return AGENT_CLI_REASONS.BINARY_MISSING;
  const stderr = String(error?.stderr ?? error?.message ?? "");
  if (BINARY_MISSING_PATTERN.test(stderr)) return AGENT_CLI_REASONS.BINARY_MISSING;
  return AGENT_CLI_REASONS.EXEC_ERROR;
}

/**
 * Default `execFn`: runs the real CLI. Never invoked by tests — they inject a
 * fixture-backed fn.
 *
 * Uses `execSync` (shell) rather than `execFileSync`, mirroring
 * `preflight.mjs`'s own `checkCli()` convention: on Windows, `codex`/`agy`
 * installed via npm/the vendor installer resolve to a `.cmd`/`.ps1` shim, and
 * `execFileSync` without `shell: true` cannot invoke those — it fails with
 * `ENOENT` even though the binary is genuinely on PATH (confirmed live:
 * `execFileSync("codex", ...)` reports `BINARY_MISSING` on a machine where
 * `codex --version` works fine from any shell). `bin` and `args` here are
 * always literal constants from `AGENT_MCP_LIST_COMMANDS`, never
 * caller-supplied content, so string interpolation carries no injection risk.
 */
function defaultExecFn(bin, args, { timeoutMs }) {
  return execSync([bin, ...args].join(" "), {
    timeout: timeoutMs,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/**
 * Asks the given agent's own CLI which MCP servers it has registered, and
 * whether each of `serverNames` is among them and enabled.
 *
 * `serverNames` matches by exact registered name (case-sensitive, mirroring
 * how `codex mcp add <name>`/`agy mcp add <name>` name servers) — pass every
 * alias you'd accept (e.g. `["codebase-memory-mcp", "codebase-memory"]`).
 *
 * @param {"codex"|"agy"} agent
 * @param {string[]} serverNames
 * @param {{
 *   execFn?: (bin: string, args: string[], opts: {timeoutMs: number}) => string,
 *   timeoutMs?: number,
 * }} [options]
 * @returns {{
 *   checked: boolean,
 *   reason: string|null,
 *   matched: string|null,
 *   ok: boolean,
 * }} `checked: false` means ground truth could not be established (binary
 *   missing, timeout, non-zero exit, unparseable output) — callers should
 *   fall back to file-based detection, not treat this as "absent".
 */
export function detectAgentMcpServers(agent, serverNames, options = {}) {
  const command = AGENT_MCP_LIST_COMMANDS[agent];
  if (!command) {
    throw new Error(`detectAgentMcpServers: unknown agent "${agent}" (expected "codex" or "agy")`);
  }

  const execFn = typeof options.execFn === "function" ? options.execFn : defaultExecFn;
  const timeoutMsRaw = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw >= 0 ? timeoutMsRaw : AGENT_CLI_TIMEOUT_MS;

  let stdout;
  try {
    stdout = execFn(command.bin, command.args, { timeoutMs });
  } catch (error) {
    return { checked: false, reason: classifyExecError(error), matched: null, ok: false };
  }

  const parsed = PARSERS[agent](stdout);
  if (parsed === null) {
    return { checked: false, reason: AGENT_CLI_REASONS.UNPARSEABLE_OUTPUT, matched: null, ok: false };
  }

  const names = Array.isArray(serverNames) ? serverNames : [serverNames];
  for (const name of names) {
    const entry = parsed.get(name);
    if (entry) {
      return { checked: true, reason: null, matched: name, ok: entry.enabled === true };
    }
  }
  return { checked: true, reason: null, matched: null, ok: false };
}
