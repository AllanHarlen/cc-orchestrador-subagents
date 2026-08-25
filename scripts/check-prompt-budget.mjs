#!/usr/bin/env node
/**
 * Compatibility wrapper.
 *
 * The canonical check-prompt-budget script lives inside the skill directory so
 * SKILL.md can reference it through ${CLAUDE_SKILL_DIR}. Keep this wrapper for
 * README examples and command invocations that point at
 * scripts/check-prompt-budget.mjs.
 */
import "../skills/orchestrator-multi-agent-development/scripts/check-prompt-budget.mjs";
