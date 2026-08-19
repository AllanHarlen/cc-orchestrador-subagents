#!/usr/bin/env node
/**
 * Compatibility wrapper.
 *
 * The canonical project-config CLI lives inside the skill directory so SKILL.md
 * and references can point at it through ${CLAUDE_SKILL_DIR}, as recommended by
 * Claude Code skills documentation. Keep this wrapper for README examples and
 * command invocations that still point at scripts/project-config.mjs.
 *
 * The canonical module calls executeJsonCli on load and reads
 * process.argv.slice(2), so importing it here preserves every subcommand
 * (show, write, validate, required-clis), the JSON contract and the exit code.
 */
import "../skills/orchestrator-multi-agent-development/scripts/project-config.mjs";
