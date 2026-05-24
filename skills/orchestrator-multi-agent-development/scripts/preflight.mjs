#!/usr/bin/env node
/**
 * Preflight check for cc-orchestrador-subagents.
 *
 * Validates that every dependency the orchestrator needs is present:
 *  - CLIs on PATH: agy, codex, openspec
 *  - Claude Code plugins: cc-antigravity-plugin, openai-codex
 *  - OpenSpec skills under ~/.claude/skills/openspec-*
 *  - A compatible Bash permission for the Codex companion runtime
 *  - A summary of the broader agent permission profile when available
 *  - Claude Code hook settings compatible with /goal
 *  - Optional Context7 MCP configuration (reported, never blocking)
 *
 * Outputs a JSON report to stdout and exits with code 0 if every required
 * dependency is OK; exits with code 1 otherwise.
 *
 * Usage:
 *   node "${CLAUDE_SKILL_DIR}/scripts/preflight.mjs" [--json] [--silent]
 *   node scripts/preflight.mjs [--json] [--silent] # compatibility wrapper
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const PLUGINS_CACHE = join(HOME, ".claude", "plugins", "cache");
const SKILLS_DIR = join(HOME, ".claude", "skills");
const PROJECT_CLAUDE_DIR = join(process.cwd(), ".claude");
const PROJECT_SETTINGS_FILE = join(PROJECT_CLAUDE_DIR, "settings.json");

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

function checkCodexCompanionBashPermission() {
  const candidates = [
    PROJECT_SETTINGS_FILE,
    join(PROJECT_CLAUDE_DIR, "settings.local.json"),
    join(HOME, ".claude", "settings.json"),
    join(HOME, ".claude", "settings.local.json"),
  ];

  const inspected = [];
  const parseErrors = [];

  for (const file of candidates) {
    if (!existsSync(file)) continue;

    try {
      const settings = JSON.parse(readFileSync(file, "utf8"));
      const allow = Array.isArray(settings?.permissions?.allow)
        ? settings.permissions.allow
        : [];
      const deny = Array.isArray(settings?.permissions?.deny)
        ? settings.permissions.deny
        : [];
      const ask = Array.isArray(settings?.permissions?.ask)
        ? settings.permissions.ask
        : [];
      const matches = allow.filter(isCodexCompanionBashRule);
      const profile = summarizePermissionProfile(settings);

      inspected.push({
        path: file,
        allow: allow.filter((rule) => typeof rule === "string" && rule.startsWith("Bash")),
        deny,
        ask,
        defaultMode: settings?.permissions?.defaultMode ?? null,
      });

      if (matches.length > 0) {
        return {
          ok: true,
          path: file,
          rules: matches,
          profile,
        };
      }
    } catch (err) {
      parseErrors.push({
        path: file,
        error: err.message?.split(/\r?\n/)[0] ?? "cannot parse settings file",
      });
    }
  }

  return {
    ok: false,
    error:
      "Missing Claude Code permission to run the Codex companion via Bash. The codex:codex-rescue subagent needs a compatible Bash rule such as Bash(node:*) so it can invoke codex-companion.mjs without an approval prompt.",
    expected: 'permissions.allow includes a compatible rule such as "Bash(node:*)"',
    inspected,
    parseErrors,
  };
}

function autoRemediateCodexCompanionBashPermission(initialCheck) {
  const fileExistedBefore = existsSync(PROJECT_SETTINGS_FILE);
  const result = {
    attempted: false,
    changed: false,
    target: PROJECT_SETTINGS_FILE,
    action: "none",
    revalidated: false,
    ok: initialCheck.ok,
  };

  if (initialCheck.ok) {
    return result;
  }

  const projectParseError = initialCheck.parseErrors?.find(
    (entry) => entry.path === PROJECT_SETTINGS_FILE,
  );

  if (projectParseError) {
    return {
      ...result,
      attempted: true,
      action: "blocked-invalid-json",
      error:
        "Auto-remediation skipped because .claude/settings.json exists but contains invalid JSON. Fix the file manually and rerun preflight.",
      ok: false,
    };
  }

  let settings = {};
  if (fileExistedBefore) {
    try {
      settings = JSON.parse(readFileSync(PROJECT_SETTINGS_FILE, "utf8"));
    } catch (err) {
      return {
        ...result,
        attempted: true,
        action: "blocked-invalid-json",
        error:
          err.message?.split(/\r?\n/)[0] ??
          "Auto-remediation skipped because .claude/settings.json could not be parsed.",
        ok: false,
      };
    }
  }

  if (!isPlainObject(settings)) {
    return {
      ...result,
      attempted: true,
      action: "blocked-non-object-root",
      error:
        "Auto-remediation skipped because .claude/settings.json must contain a JSON object at the root.",
      ok: false,
    };
  }

  const permissions = settings.permissions;
  if (permissions != null && !isPlainObject(permissions)) {
    return {
      ...result,
      attempted: true,
      action: "blocked-invalid-permissions-shape",
      error:
        "Auto-remediation skipped because .claude/settings.json has a non-object permissions field.",
      ok: false,
    };
  }

  const allow = permissions?.allow;
  if (allow != null && !Array.isArray(allow)) {
    return {
      ...result,
      attempted: true,
      action: "blocked-invalid-allow-shape",
      error:
        "Auto-remediation skipped because .claude/settings.json has permissions.allow in a non-array format.",
      ok: false,
    };
  }

  const nextSettings = {
    ...settings,
    permissions: {
      ...(permissions ?? {}),
      allow: [...(allow ?? []), "Bash(node:*)"],
    },
  };

  mkdirSync(PROJECT_CLAUDE_DIR, { recursive: true });
  writeFileSync(PROJECT_SETTINGS_FILE, `${JSON.stringify(nextSettings, null, 2)}\n`, "utf8");

  const revalidated = checkCodexCompanionBashPermission();
  return {
    attempted: true,
    changed: true,
    target: PROJECT_SETTINGS_FILE,
    action: fileExistedBefore ? "updated-settings-json" : "created-settings-json",
    revalidated: revalidated.ok,
    ok: revalidated.ok,
    rules: revalidated.rules ?? [],
    path: revalidated.path ?? PROJECT_SETTINGS_FILE,
    error: revalidated.ok ? null : revalidated.error,
  };
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function checkGoalHookSettings() {
  const candidates = [
    join(PROJECT_CLAUDE_DIR, "settings.json"),
    join(PROJECT_CLAUDE_DIR, "settings.local.json"),
    join(HOME, ".claude", "settings.json"),
    join(HOME, ".claude", "settings.local.json"),
    join(HOME, ".claude", "managed-settings.json"),
  ];

  const inspected = [];
  const parseErrors = [];

  for (const file of candidates) {
    if (!existsSync(file)) continue;

    try {
      const settings = JSON.parse(readFileSync(file, "utf8"));
      inspected.push({
        path: file,
        disableAllHooks: settings?.disableAllHooks,
        allowManagedHooksOnly: settings?.allowManagedHooksOnly,
      });

      if (settings?.disableAllHooks === true) {
        return {
          ok: false,
          path: file,
          error:
            "/goal is unavailable because disableAllHooks is true. /goal depends on Claude Code Stop hooks.",
          inspected,
        };
      }

      if (settings?.allowManagedHooksOnly === true) {
        return {
          ok: false,
          path: file,
          error:
            "/goal may be unavailable because allowManagedHooksOnly is true. /goal depends on a session-scoped prompt Stop hook.",
          inspected,
        };
      }
    } catch (err) {
      parseErrors.push({
        path: file,
        error: err.message?.split(/\r?\n/)[0] ?? "cannot parse settings file",
      });
    }
  }

  return {
    ok: true,
    inspected,
    parseErrors,
    note:
      "No local/project setting was found disabling hooks. The workspace still needs to be trusted in Claude Code before /goal can run.",
  };
}

function isCodexCompanionBashRule(rule) {
  if (typeof rule !== "string") return false;
  const normalized = rule.replace(/\s+/g, " ").trim();

  return (
    normalized === "Bash" ||
    normalized === "Bash(*)" ||
    normalized === "Bash(node:*)" ||
    /^Bash\(node:.*codex-companion\.mjs.*\)$/.test(normalized) ||
    /^Bash\(node .*codex-companion\.mjs.*\)$/.test(normalized)
  );
}

function summarizePermissionProfile(settings) {
  const permissions = settings?.permissions ?? {};
  const allow = Array.isArray(permissions.allow) ? permissions.allow : [];
  const deny = Array.isArray(permissions.deny) ? permissions.deny : [];
  const ask = Array.isArray(permissions.ask) ? permissions.ask : [];

  return {
    defaultMode: permissions.defaultMode ?? null,
    allowCount: allow.length,
    denyCount: deny.length,
    askCount: ask.length,
    hasBroadBashAccess:
      allow.includes("Bash") ||
      allow.includes("Bash(*)") ||
      allow.some((rule) => typeof rule === "string" && /^Bash\([^)]+:\*\)$/.test(rule)),
    hasWebSearch: allow.includes("WebSearch"),
    hasPlaywrightMcp: allow.some(
      (rule) => typeof rule === "string" && rule.startsWith("mcp__playwright__"),
    ),
    sampleAllow: allow.slice(0, 10),
    sampleDeny: deny.slice(0, 10),
    sampleAsk: ask.slice(0, 10),
  };
}

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

  const directoryCandidates = [
    join(HOME, ".gemini", "antigravity-cli", "mcp", "context7"),
    join(HOME, ".gemini", "antigravity-cli", "plugins", "context7"),
  ];
  for (const dir of directoryCandidates) {
    if (existsSync(dir)) {
      evidence.push({ type: "mcp-directory", path: dir });
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
    join(HOME, ".gemini", "antigravity-cli", "settings.json"),
    join(HOME, ".gemini", "antigravity-cli", "import_manifest.json"),
    join(HOME, ".gemini", "antigravity-cli", "plugins", "context7", "mcp_config.json"),
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
        "When delegating Codex/Antigravity work involving libraries, frameworks, SDKs, APIs or cloud services, instruct the agent to use Context7 MCP before relying on memory.",
    };
  }

  return {
    ok: false,
    optional: true,
    error: "Context7 MCP not detected in known Claude/Codex/Antigravity/project config locations.",
    install: [
      "npx ctx7 setup --claude",
      'or: claude mcp add --scope user --header "CONTEXT7_API_KEY: YOUR_API_KEY" --transport http context7 https://mcp.context7.com/mcp',
    ],
  };
}

const initialCodexCompanionBash = checkCodexCompanionBashPermission();
const autoRemediation = autoRemediateCodexCompanionBashPermission(initialCodexCompanionBash);
const finalCodexCompanionBash = checkCodexCompanionBashPermission();

const checks = {
  cli: {
    agy: checkCli("agy"),
    codex: checkCli("codex"),
    openspec: checkCli("openspec"),
  },
  plugins: {
    "cc-antigravity-plugin": checkPlugin("cc-antigravity-plugin", "cc-antigravity-plugin"),
    "openai-codex": checkPlugin("openai-codex", "codex"),
  },
  skills: {
    openspec: checkOpenSpecSkills(),
  },
  permissions: {
    "codex-companion-bash": finalCodexCompanionBash,
    "goal-hooks-enabled": checkGoalHookSettings(),
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
for (const [name, result] of Object.entries(checks.permissions)) {
  if (!result.ok) failed.push({ category: "permission", name, ...result });
}

const status = failed.length === 0 ? "ok" : "failed";

const report = {
  status,
  generatedAt: new Date().toISOString(),
  checks,
  autoRemediation,
  failed,
  remediation: failed.length === 0 ? null : buildRemediation(failed),
};

console.log(JSON.stringify(report, null, 2));

process.exit(status === "ok" ? 0 : 1);

function buildRemediation(failures) {
  return failures.map((failure) => remediationFor(failure));
}

function remediationFor(f) {
  const key = `${f.category}:${f.name}`;
  switch (key) {
    case "cli:agy":
      return {
        target: "Antigravity CLI (agy)",
        steps: [
          "Instalar Antigravity CLI:",
          "  Windows: irm https://antigravity.google/cli/install.ps1 | iex",
          "  macOS/Linux: curl -fsSL https://antigravity.google/cli/install.sh | bash",
          "Abrir `agy` uma vez para concluir a autenticacao interativa.",
          "Garantir que o binario 'agy' esta no PATH global.",
        ],
        docs: "https://antigravity.google/cli",
      };
    case "cli:codex":
      return {
        target: "codex-cli",
        steps: [
          "Instalar Codex CLI globalmente:",
          "  npm install -g @openai/codex",
          "Autenticar:",
          "  codex login",
          "Garantir que o binario 'codex' esta no PATH global.",
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
          "Garantir que o binario 'openspec' esta no PATH global.",
        ],
        docs: "https://github.com/Fission-AI/OpenSpec",
      };
    case "plugin:cc-antigravity-plugin":
      return {
        target: "Claude Code plugin: cc-antigravity-plugin",
        steps: [
          "Dentro do Claude Code:",
          "  claude plugin install AllanHarlen/cc-antigravity-plugin",
        ],
        docs: "https://github.com/AllanHarlen/cc-antigravity-plugin",
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
          "Esses skills sao instalados pelo CLI do OpenSpec:",
          "  openspec init",
          "Apos inicializar, os skills openspec-* aparecem em ~/.claude/skills/.",
          "Se ainda assim faltarem, reinstale o OpenSpec CLI:",
          "  npm install -g @fission-ai/openspec",
        ],
        docs: "https://github.com/Fission-AI/OpenSpec",
      };
    case "permission:codex-companion-bash":
      return {
        target: "Claude Code permission: codex-companion via Bash",
        steps: [
          "No projeto alvo, crie ou atualize .claude/settings.json com:",
          '  { "permissions": { "allow": ["Bash(node:*)"] } }',
          "Ou use um perfil mais amplo, desde que ele inclua uma regra compativel para execucao do node/codex-companion.",
          "Reinicie ou recarregue a sessao do Claude Code antes de rodar /orchestrator novamente.",
          "Isso permite que codex:codex-rescue invoque node \"${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs\" task ... sem pedir aprovacao em background.",
        ],
        docs: "https://docs.anthropic.com/en/docs/claude-code/settings",
      };
    case "permission:goal-hooks-enabled":
      return {
        target: "Claude Code /goal hooks",
        steps: [
          "Remova ou altere a configuracao que desabilita hooks no escopo do projeto/usuario/managed settings.",
          "Garanta que disableAllHooks nao esteja true.",
          "Garanta que allowManagedHooksOnly nao bloqueie hooks de sessao.",
          "Abra o projeto no Claude Code e aceite o trust dialog do workspace.",
          "Depois rode /goal com uma condicao mensuravel, ou use /orchestrator novamente.",
        ],
        docs: "https://code.claude.com/docs/en/goal",
      };
    default:
      return {
        target: f.name,
        steps: ["Verifique manualmente a dependencia."],
        docs: null,
      };
  }
}
