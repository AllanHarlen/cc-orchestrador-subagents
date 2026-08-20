import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");

const activeDocs = [
  "README.md",
  "README.pt-BR.md",
  "commands/orchestrator.md",
  "commands/orchestrador.md",
  "skills/orchestrator-multi-agent-development/SKILL.md",
  "skills/orchestrator-multi-agent-development/references/agent-stack.md",
  "skills/orchestrator-multi-agent-development/references/persistent-state.md",
  "skills/orchestrator-multi-agent-development/references/subagent-prompts.md",
  "skills/orchestrator-multi-agent-development/references/workflow.md",
  "skills/orchestrator-multi-agent-development/assets/implementation-report-template.md",
  "skills/orchestrator-multi-agent-development/assets/monitoring-template.md",
  "skills/orchestrator-multi-agent-development/assets/subagents-context-template.md",
  "skills/orchestrator-multi-agent-development/assets/workflow-log-template.md",
].map(read).join("\n");

test("release and preflight declare the Antigravity 4 compatibility floor", () => {
  const plugin = JSON.parse(read(".claude-plugin/plugin.json"));
  const marketplace = JSON.parse(read(".claude-plugin/marketplace.json"));
  const preflight = read("skills/orchestrator-multi-agent-development/scripts/preflight.mjs");
  assert.equal(plugin.version, "4.2.0");
  assert.equal(marketplace.plugins[0].version, "4.2.0");
  assert.match(preflight, /MIN_ANTIGRAVITY_PLUGIN_VERSION = "4\.0\.0"/);
  assert.match(preflight, /MIN_AGY_VERSION = "1\.1\.8"/);
  assert.match(preflight, /RECOMMENDED_AGY_VERSION = "1\.1\.16"/);
});

test("active instructions use native model selection and role-specific structured formats", () => {
  assert.doesNotMatch(activeDocs, /\.gemini\/antigravity-cli\/settings\.json/);
  assert.doesNotMatch(activeDocs, /gemini-3\.[15]-(?:flash|pro)-(?:low|medium|high)/);
  assert.doesNotMatch(activeDocs, /cc-antigravity-plugin >= 3\.6\.0/);
  assert.match(activeDocs, /--mode accept-edits --format stream-json --model <agyModel>/);
  assert.match(activeDocs, /--read-only --format json --model pro-high --effort high/);
  assert.match(activeDocs, /--agy-effort <low\|medium\|high>/);
  assert.match(activeDocs, /--agy-timeout <(?:duration|duracao|duração)>/);
  assert.match(activeDocs, /--conversation <id>/);
});

test("router aliases and adapter metadata match the bridge 4 envelope", () => {
  const router = read("skills/orchestrator-multi-agent-development/scripts/lib/adaptive-router.mjs");
  const adapter = read("skills/orchestrator-multi-agent-development/scripts/lib/executor-adapters.mjs");
  for (const alias of ["flash-low", "flash-medium", "flash-high", "pro-low", "pro-high"]) {
    assert.match(router, new RegExp(`"${alias}"`));
  }
  for (const field of ["conversationId", "retryDirective", "usage", "durationSeconds", "numTurns"]) {
    assert.match(adapter, new RegExp(`\\b${field}\\b`));
  }
  assert.match(adapter, /input_tokens: "inputTokens"/);
  assert.match(adapter, /output_tokens: "outputTokens"/);
  assert.match(adapter, /--conversation\\s\+\(\[\^\\s\]\+\)/);
});
