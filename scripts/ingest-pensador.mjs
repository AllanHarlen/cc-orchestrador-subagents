#!/usr/bin/env node
/**
 * Compatibility wrapper.
 *
 * The canonical script lives inside the skill directory so SKILL.md
 * can reference it through ${CLAUDE_SKILL_DIR}, as recommended by Claude Code
 * skills documentation. Keep this wrapper for README examples and command
 * invocations that still point at scripts/ingest-pensador.mjs.
 */
import "../skills/orchestrator-multi-agent-development/scripts/ingest-pensador.mjs";
