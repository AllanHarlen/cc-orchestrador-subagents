#!/usr/bin/env node
/**
 * Preflight check for cc-orchestrador-subagents.
 *
 * Validates that every dependency the orchestrator needs is present:
 *  - CLIs on PATH: gemini, codex, openspec
 *  - Claude Code plugins: cc-gemini-plugin, openai-codex
 *  - OpenSpec skills under ~/.claude/skills/openspec-*
 *  - Optional Context7 MCP configuration (reported, never blocking)
 *
 * Outputs a JSON report to stdout and exits with code 0 if every required
 * dependency is OK; exits with code 1 otherwise. The orchestrator parses the
 * JSON and decides whether to cancel.
 *
 * Usage:
 *   node scripts/preflight.mjs [--json] [--silent]
 *
 * Flags:
 *   --json    force JSON-only output (default)
 *   --silent  suppress remediation hints (still prints JSON)
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const PLUGINS_CACHE = join(HOME, ".claude", "plugins", "cache");
const SKILLS_DIR = join(HOME, ".claude", "skills");

// ---------------------------------------------------------------------------
// Check helpers
// ---------------------------------------------------------------------------

/**
 * Try to run `<cli> --version` and capture its stdout.
 * Returns { ok: true, version } on success, { ok: false, error } on failure.
 */
function checkCli(cli) {
  try {
    const out = execSync(`${cli} --version`, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    })
      .toString()
      .trim();
    return { ok: true, version: out.split(/\r?\n/)[0] };
  } catch (err) {
    return { ok: false, error: err.message?.split(/\r?\n/)[0] ?? "not found" };
  }
}

/**
 * Check whether a Claude Code plugin is installed under ~/.claude/plugins/cache.
 * The folder layout is plugins/cache/<marketplace>/<plugin>/<version>/.
 * We accept any version >= 0.0.0; the orchestrator can warn separately if
 * it wants a specific minimum.
 */
function checkPlugin(marketplace, pluginName) {
  const dir = join(PLUGINS_CACHE, marketplace, pluginName);
  if (!existsSync(dir)) {
    return { ok: false, error: `missing ${dir}` };
  }
  let versions = [];
  try {
    versions = readdirSync(dir);
  } catch {
    return { ok: false, error: `cannot read ${dir}` };
  }
  if (versions.length === 0) {
    return { ok: false, error: `no versions installed in ${dir}` };
  }
  versions.sort();
  return { ok: true, version: versions[versions.length - 1], path: dir };
}

/**
 * Check whether the openspec-* skills are present under ~/.claude/skills/.
 * Returns an aggregated result.
 */
function checkOpenSpecSkills() {
  const required = [
    "openspec-new-change",
    "openspec-ff-change",
    "openspec-apply-change",
    "openspec-verify-change",
    "openspec-archive-change",
    "openspec-sync-specs",
  ];
  const missing = required.filter(
    (name) => !existsSync(join(SKILLS_DIR, name, "SKILL.md")),
  );
  if (missing.length === 0) {
    return { ok: true, found: required };
  }
  return {
    ok: false,
    error: `missing skill folders: ${missing.join(", ")}`,
    missing,
  };
}

/**
 * Optional Context7 MCP detection.
 *
 * Context7 improves agent accuracy for library/framework/API work, but it is
 * not required for the orchestrator to run. We look for common Claude Code,
 * Codex, Gemini and project MCP configuration files, plus the Context7 skill
 * installed by `npx ctx7 setup --claude`.
 */
function checkContext7Mcp() {
  const evidence = [];

  const skillCandidates = [
    join(SKILLS_DIR, "context7", "SKILL.md"),
    join(SKILLS_DIR, "context7-mcp", "SKILL.md"),
  ];
  for (const file of skillCandidates) {
    if (existsSync(file)) {
      evidence.push({ type: "skill", path: file });
    }
  }

  const configCandidates = [
    join(process.cwd(), ".mcp.json"),
    join(HOME, ".claude.json"),
    join(HOME, ".claude", "mcp.json"),
    join(HOME, ".config", "claude", "mcp.json"),
    join(HOME, ".codex", "config.toml"),
    join(HOME, ".gemini", "settings.json"),
    join(HOME, ".gemini", "mcp.json"),
  ];

  for (const file of configCandidates) {
    if (!existsSync(file)) continue;
    try {
      const contents = readFileSync(file, "utf8");
      if (/\bcontext7\b|@upstash\/context7-mcp|mcp\.context7\.com|ctx7/i.test(contents)) {
        evidence.push({ type: "mcp-config", path: file });
      }
    } catch (err) {
      evidence.push({
        type: "mcp-config-unreadable",
        path: file,
        error: err.message?.split(/\r?\n/)[0] ?? "cannot read file",
      });
    }
  }

  if (evidence.some((item) => item.type !== "mcp-config-unreadable")) {
    return {
      ok: true,
      optional: true,
      evidence,
      usage:
        "When delegating Codex/Gemini work involving libraries, frameworks, SDKs, APIs or cloud services, instruct the agent to use Context7 MCP before relying on memory.",
    };
  }

  return {
    ok: false,
    optional: true,
    error: "Context7 MCP not detected in known Claude/Codex/Gemini/project config locations.",
    install: [
      "npx ctx7 setup --claude",
      'or: claude mcp add --scope user --header "CONTEXT7_API_KEY: YOUR_API_KEY" --transport http context7 https://mcp.context7.com/mcp',
    ],
  };
}

// ---------------------------------------------------------------------------
// Run all checks
// ---------------------------------------------------------------------------

const checks = {
  cli: {
    gemini: checkCli("gemini"),
    codex: checkCli("codex"),
    openspec: checkCli("openspec"),
  },
  plugins: {
    "cc-gemini-plugin": checkPlugin("cc-gemini-plugin", "cc-gemini-plugin"),
    "openai-codex": checkPlugin("openai-codex", "codex"),
  },
  skills: {
    openspec: checkOpenSpecSkills(),
  },
  optional: {
    mcp: {
      context7: checkContext7Mcp(),
    },
  },
};

const failed = [];

for (const [name, result] of Object.entries(checks.cli)) {
  if (!result.ok) failed.push({ category: "cli", name, ...result });
}
for (const [name, result] of Object.entries(checks.plugins)) {
  if (!result.ok) failed.push({ category: "plugin", name, ...result });
}
for (const [name, result] of Object.entries(checks.skills)) {
  if (!result.ok) failed.push({ category: "skill-bundle", name, ...result });
}

const status = failed.length === 0 ? "ok" : "failed";

const report = {
  status,
  generatedAt: new Date().toISOString(),
  checks,
  failed,
  remediation: failed.length === 0 ? null : buildRemediation(failed),
};

console.log(JSON.stringify(report, null, 2));

process.exit(status === "ok" ? 0 : 1);

// ---------------------------------------------------------------------------
// Remediation hints
// ---------------------------------------------------------------------------

function buildRemediation(failures) {
  const hints = [];
  for (const f of failures) {
    hints.push(remediationFor(f));
  }
  return hints;
}

function remediationFor(f) {
  const key = `${f.category}:${f.name}`;
  switch (key) {
    case "cli:gemini":
      return {
        target: "gemini-cli",
        steps: [
          "Instalar Gemini CLI globalmente:",
          "  npm install -g @google/gemini-cli",
          "  # ou: brew install gemini-cli (macOS)",
          "Autenticar:",
          "  gemini auth",
          "Garantir que o binário 'gemini' está no PATH global.",
        ],
        docs: "https://ai.google.dev/gemini-api/docs/cli",
      };
    case "cli:codex":
      return {
        target: "codex-cli",
        steps: [
          "Instalar Codex CLI globalmente:",
          "  npm install -g @openai/codex",
          "Autenticar:",
          "  codex login",
          "Garantir que o binário 'codex' está no PATH global.",
        ],
        docs: "https://github.com/openai/codex",
      };
    case "cli:openspec":
      return {
        target: "openspec-cli",
        steps: [
          "Instalar OpenSpec CLI globalmente:",
          "  npm install -g @fission-ai/openspec",
          "Inicializar no projeto atual:",
          "  openspec init",
          "Garantir que o binário 'openspec' está no PATH global.",
        ],
        docs: "https://github.com/Fission-AI/OpenSpec",
      };
    case "plugin:cc-gemini-plugin":
      return {
        target: "Claude Code plugin: cc-gemini-plugin",
        steps: [
          "Dentro do Claude Code:",
          "  /plugin marketplace add thepushkarp/cc-gemini-plugin",
          "  /plugin install cc-gemini-plugin@cc-gemini-plugin",
        ],
        docs: "https://github.com/thepushkarp/cc-gemini-plugin",
      };
    case "plugin:openai-codex":
      return {
        target: "Claude Code plugin: codex-plugin-cc",
        steps: [
          "Dentro do Claude Code:",
          "  /plugin marketplace add openai/codex-plugin-cc",
          "  /plugin install codex@openai-codex",
        ],
        docs: "https://github.com/openai/codex-plugin-cc",
      };
    case "skill-bundle:openspec":
      return {
        target: "OpenSpec skills (~/.claude/skills/openspec-*)",
        steps: [
          "Esses skills são instalados pelo CLI do OpenSpec:",
          "  openspec init",
          "Após inicializar, os skills openspec-* aparecem em ~/.claude/skills/.",
          "Se ainda assim faltarem, reinstale o OpenSpec CLI:",
          "  npm install -g @fission-ai/openspec",
        ],
        docs: "https://github.com/Fission-AI/OpenSpec",
      };
    default:
      return {
        target: f.name,
        steps: ["Verifique manualmente a dependência."],
        docs: null,
      };
  }
}
