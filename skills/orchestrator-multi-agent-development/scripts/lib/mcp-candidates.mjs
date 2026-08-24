import { join } from "node:path";

/**
 * Canonical candidate locations probed by preflight detection for the two
 * MCP servers shared across the workflow chain (cc-pensador ->
 * cc-orchestrador-subagents -> cc-executor-subagents): Codebase Memory and
 * Context7 (both optional here — see `mcp-detect.mjs`'s own docstring for
 * how each is used in the Orchestrator's phases).
 *
 * This is the union of every location any of the three plugins' own
 * preflight has ever probed. It exists because, before this file, the three
 * preflights disagreed on where to look — a server registered only in
 * `.kiro/settings/mcp.json` was "available" to Pensador but "absent" here,
 * and a server registered only in `~/.codex/config.toml` was the reverse.
 * `cc-pensador/test/mcp-detection-parity.test.js` asserts the sibling copies
 * of this list (this file, `cc-pensador/scripts/lib/mcp-candidates.mjs`, and
 * `cc-executor-subagents/.../scripts/lib/mcp-candidates.mjs`) stay in sync
 * when checked out side by side in this combined workspace.
 *
 * Each config candidate is `{ base: "cwd" | "home", segments: string[], format }`.
 * `format` is `"json"` for every file except `~/.codex/config.toml`, which is
 * TOML: `mcp-detect.mjs`'s `inspectConfig()` matches it with a raw marker
 * test, never a structured parse — writing a TOML parser for a single
 * candidate is not worth the maintenance cost. Every `"json"` candidate is
 * parsed and matched by structure (`matchServerMaps`/`extractServerMaps` in
 * `mcp-detect.mjs`), which excludes servers listed in
 * `disabledMcpjsonServers`.
 */

export const CODEBASE_MEMORY_CONFIG_CANDIDATES = [
  { base: "cwd", segments: [".mcp.json"], format: "json" },
  { base: "cwd", segments: [".kiro", "settings", "mcp.json"], format: "json" },
  { base: "home", segments: [".claude.json"], format: "json" },
  { base: "home", segments: [".claude", ".mcp.json"], format: "json" },
  { base: "home", segments: [".claude", "mcp.json"], format: "json" },
  { base: "home", segments: [".claude", "settings", "mcp.json"], format: "json" },
  { base: "home", segments: [".config", "claude", "mcp.json"], format: "json" },
  { base: "home", segments: [".codex", "config.toml"], format: "toml" },
  { base: "home", segments: [".gemini", "config", "mcp_config.json"], format: "json" },
];

export const CODEBASE_MEMORY_SKILL_CANDIDATES = [
  { base: "home", segments: [".claude", "skills", "codebase-memory", "SKILL.md"] },
  { base: "home", segments: [".claude", "skills", "codebase-memory-mcp", "SKILL.md"] },
];

export const CONTEXT7_CONFIG_CANDIDATES = [
  { base: "cwd", segments: [".mcp.json"], format: "json" },
  { base: "cwd", segments: [".kiro", "settings", "mcp.json"], format: "json" },
  { base: "home", segments: [".claude.json"], format: "json" },
  { base: "home", segments: [".claude", ".mcp.json"], format: "json" },
  { base: "home", segments: [".claude", "mcp.json"], format: "json" },
  { base: "home", segments: [".claude", "settings", "mcp.json"], format: "json" },
  { base: "home", segments: [".config", "claude", "mcp.json"], format: "json" },
  { base: "home", segments: [".codex", "config.toml"], format: "toml" },
  { base: "home", segments: [".gemini", "config", "mcp_config.json"], format: "json" },
  { base: "home", segments: [".gemini", "settings.json"], format: "json" },
  { base: "home", segments: [".gemini", "mcp.json"], format: "json" },
  { base: "home", segments: [".gemini", "antigravity-cli", "settings.json"], format: "json" },
  { base: "home", segments: [".gemini", "antigravity-cli", "import_manifest.json"], format: "json" },
  {
    base: "home",
    segments: [".gemini", "antigravity-cli", "plugins", "context7", "mcp_config.json"],
    format: "json",
  },
];

/** Directory-existence evidence (no content to parse) — the AGY/Gemini CLI bundles Context7 under these. */
export const CONTEXT7_MCP_DIRECTORY_CANDIDATES = [
  { base: "home", segments: [".gemini", "antigravity-cli", "mcp", "context7"] },
  { base: "home", segments: [".gemini", "antigravity-cli", "plugins", "context7"] },
];

export const CONTEXT7_SKILL_CANDIDATES = [
  { base: "home", segments: [".claude", "skills", "context7", "SKILL.md"] },
  { base: "home", segments: [".claude", "skills", "context7-mcp", "SKILL.md"] },
];

/** Resolves a `{ base, segments }` candidate to an absolute path given `{ home, cwd }`. */
export function resolveCandidate({ base, segments }, { home, cwd }) {
  const root = base === "cwd" ? cwd : home;
  return join(root, ...segments);
}
