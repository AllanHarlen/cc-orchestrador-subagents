![cc-orchestrador-subagents](banner.png)

# cc-orchestrador-subagents

Claude Code plugin to conduct a multi-agent development workflow from an existing PRD/spec, with Codex, Antigravity/AGY and audit artifacts.

**[Leia em Português](README.pt-BR.md)** — Portuguese version available.

## Overview

The `cc-orchestrador-subagents` organizes development as a **Harness Orchestrator** for Claude CLI/Claude Code. Claude acts as the **Main Orchestrator**: its only goal is to **orchestrate the agents' work**. It does not do demand discovery or planning — it works exclusively on projects that already have a **PRD or pre-established specs**.

The user provides the specification via file mention (`@docs/prd.md`) or by sending the PRD/spec file. That document is the **source of truth**: the orchestrator ingests it, classifies tasks, builds waves, generates contracts, delegates, monitors, integrates and reviews.

Codex and Antigravity/AGY enter as specialized sub-agents:

| Role | Executor | Responsibility |
|---|---|---|
| Harness Orchestrator | Claude CLI / Claude Code | Ingests the PRD/spec and coordinates workflow, contracts, waves, validations, logs and user decisions. |
| Back-end implementation, database, tests and adjustments | Codex (`codex:codex-rescue`) | Executes non-front-end tasks with `--effort medium`, without fixing `--model`. |
| Front-end implementation and UX | Antigravity/AGY (`cc-antigravity-plugin:antigravity-agent`) | Executes `FRONTEND_ONLY` tasks and front-end slices of `FULLSTACK`, including Vite/React setup, routing, and UI implementation. |
| Back-end post-implementation review | Codex (`codex:codex-rescue`) | Reviews **back-end only** with `--effort high` or falls back to orchestrator's internal read-only review when quota is exhausted. |
| Front-end post-implementation review | Antigravity/AGY (`cc-antigravity-plugin:antigravity-agent`, `--model gemini-3.1-pro-high`) | Reviews **front-end only** read-only or falls back to orchestrator's internal review when AGY is unavailable. |

### Complete Workflow

- **Phase 0 - Preflight:** runs `node scripts/preflight.mjs`, validates dependencies, Codex, AGY, `Bash(node:*)` permission and registers `autoRemediation` when `.claude/settings.json` can be created.
- **Phase 1 - Spec ingestion:** reads the user-provided PRD/spec (file mention or sent file) and treats it as the source of truth. Extracts deliverables, tasks, technical decisions and acceptance criteria, without reopening the understanding. Blocking gaps are resolved with `AskUserQuestion` in a targeted way.
- **Phase 2 - Task classification:** generates `tasks-classification.md` with category, dependencies, critical files, complexity, `contractRequired`, `assignedAgent` and `routingReason`.
- **Phase 3 - Execution waves:** assembles `waves.md`, respecting dependencies, pending contracts, changing schemas and shared central files. Then runs `validate-routing.mjs` and corrects routing errors.
- **Phase 4 - API/UI contracts:** creates `contracts/*.md` for every front-back exchange, including endpoint, method, wire format, JSON casing, complete examples, status codes, UI states, permissions and error scenarios.
- **Phase 5 - Parallel delegation:** sends tasks to sub-agents according to `waves.md`. Codex receives prompts without `--model`; AGY receives `--model <agyModel>`. If an AGY task has two or more independent deliverables, fan-out is activated.
- **Phase 6 - Monitoring:** tracks `PENDING`, `RUNNING`, `BLOCKED`, `DONE`, `FAILED`, `QUOTA_EXAUSTED`, `AUTH_REQUIRED`, `AGY_MISSING`, `TIMEOUT` and other states, recording evidence in `monitoring.md`.
- **Phase 7 - Integration:** validates adherence to the PRD/spec, contracts, wire format, JSON casing, real serialization, file scope, tests and build. Point adjustments go back to Codex (back-end) or AGY (front-end) by category.
- **Phase 8 - Back-end post-implementation review:** delegates final read-only review to Codex with `--effort high`, **back-end only**, and saves `review-final.md`. If Codex runs out of quota, the Orchestrator itself does internal review. Skipped when there is no back-end.
- **Phase 9 - Front-end post-implementation review:** delegates final read-only review to AGY with `--model gemini-3.1-pro-high`, **front-end only**, and saves `review-frontend.md`. If AGY is unavailable, the Orchestrator does internal review. **Skipped when there is no front-end task.**
- **Phase 10 - Final reports:** creates `workflow-log.md`, `subagents-context.md` and `implementation-report.md`, consolidating timeline, contracts, validations, sub-agents, AGY Conversation IDs and delivery status.
- **Phase 11 - User delivery:** publishes final summary, artifact paths, executed validations, remaining blockers and business instructions.

Coordination artifacts live under `orchestration/<name>/`; final reports live at the agent's execution root.

### Main Operational Rules

- **Usage premise:** the orchestrator only works with a ready PRD/spec. It does not do discovery, planning, or reinterpret the demand.
- **Codex reviews back-end only;** AGY (`gemini-3.1-pro-high`) reviews front-end only.
- **AGY Fan-out:** `--agy-parallel` and `--agy-subagent-model` activate native Gemini sub-agents within the AGY task. Requires `cc-antigravity-plugin >= 3.6.0`.
- **AGY Model:** without override, the Orchestrator chooses `agyModel` by heuristic; the user can force with `/orchestrator --agy-model <model> <demand>`. The front-end review always uses `gemini-3.1-pro-high`.
- **Codex Prompts:** do not fix `--model`; use only `--effort medium` for implementation/handoff/adjustments and `--effort high` for back-end review.
- **Mandatory contracts:** any front-back exchange requires contract before parallelizing.
- **Wire format:** every contract must explicitly state JSON casing, field names, complete examples and real serialization validation.
- **Routing by category:** `FRONTEND_ONLY` goes to Antigravity/AGY, including front-end setup; Codex only assumes front-end as a registered operational fallback.
- **Codex Quota:** lack of quota on implementation blocks and requests user decision; lack of quota on back-end review triggers orchestrator's internal read-only review.
- **Codex Sandbox:** external network blocked for packages/restore, missing package in local cache or write outside allowed working directory becomes `BLOCKED` with evidence.
- **AGY Limit on Windows:** AGY prompts above 28,000 chars are divided into subtasks by deliverables before delegation to avoid `ENAMETOOLONG`.

## Official Dependencies

This plugin depends on the official Codex plugin for Claude Code: https://github.com/openai/codex-plugin-cc.

```text
/plugin marketplace add openai/codex-plugin-cc
/plugin install codex@openai-codex
/reload-plugins
/codex:setup
```

The marketplace/dependency used in manifests is `openai-codex`, and the expected sub-agent is `codex:codex-rescue`.

For front-end, the orchestrator expects `cc-antigravity-plugin >= 3.6.0` (mandatory for `--parallel`/`--subagent-model`), with these files present in the installed plugin:

- `agents/antigravity-agent.md`
- `commands/antigravity.md`
- `scripts/antigravity-bridge.js`

## How to provide the specification

The orchestrator does not invent the demand. Provide the PRD/spec in one of these ways:

```text
# File mention
/orchestrator @docs/prd-reservations.md

# Spec pasted directly into the argument
/orchestrator "Implement the reservations flow per: <paste the complete specification here>"

# With AGY model override
/orchestrator --agy-model gemini-3.1-pro-low @docs/prd-reservations.md
```

If no PRD/spec is provided, the orchestrator asks for the specification before continuing.

## Codex: Model and Effort

The workflow no longer fixes Codex models like `gpt-5.4` or `gpt-5.5`.

Use:

- `codex:codex-rescue` with `--effort medium` for implementation, handoff and adjustments;
- `codex:codex-rescue` with `--effort high` for back-end post-implementation review.

The model defaults to what is available in the user's account. Codex never reviews front-end.

## Codex: Sandbox Limits

When Codex is in a sandboxed environment, treat as operational blocker:

- external network failure for packages, restore or registries, like `NU1301` accessing `https://api.nuget.org/v3/index.json`;
- required package missing from local cache;
- `UnauthorizedAccessException` or equivalent error when trying to create/edit files outside allowed working directory.

In these cases the sub-agent must stop, record evidence and return `Status: BLOCKED`, without insisting on long retries or trying to bypass the sandbox.

## Front-end Routing

The agent is chosen by task category, not by work appearance. If the task is `FRONTEND_ONLY`, use `cc-antigravity-plugin:antigravity-agent` even when it is Vite/React setup, React routing, or other front-end infrastructure.

Codex should only receive front-end as a registered operational fallback after `QUOTA_EXAUSTED`, `AUTH_REQUIRED`, `AGY_MISSING`, `TIMEOUT`, AGY tool/write failure or explicit decision.

## AGY: Front-end Delegation

Front-end tasks are routed to Antigravity/AGY by category, passing `--model <agyModel>` to the plugin bridge.

Default policy (implementation):

- `gemini-3.5-flash-medium` for most tasks;
- `gemini-3.1-pro-low` for complex tasks, multi-route, multi-file, with delicate API/UI contract or high regression risk;
- `gemini-3.1-pro-high` only in critical cases;
- manual override available via `/orchestrator --agy-model <model> <demand>`.

The **front-end review (Phase 9)** always uses `gemini-3.1-pro-high`, regardless of the implementation `agyModel`.

## AGY: Native Gemini Sub-agent Fan-out

When a front-end task produces two or more independent deliverables (e.g., three React components, two HTML reports), the orchestrator can activate AGY's native fan-out via `DefineSubagent` inside the prompt.

The mechanism is purely intra-task: it remains 1 task = 1 AGY delegation; `monitoring.md`, contracts and `validate-routing.mjs` remain intact.

### New Flags

| Flag | Behavior |
|---|---|
| `--agy-parallel` | Forces fan-out on all AGY tasks in the execution. AGY decides the count. |
| `--agy-subagent-model <model>` | Model of Gemini sub-agents. Implies `--agy-parallel`. Default: `inherit` (inherits `agyModel`). |

### Examples

```text
# Fan-out forced by user
/orchestrator --agy-parallel "Create three independent React components: Header, Sidebar and Footer"

# Pro Planner coordinating Flash sub-agents
/orchestrator --agy-model gemini-3.1-pro-low --agy-subagent-model gemini-3.5-flash-medium \
  "Generate two HTML reports: taxes on electric cars and combustion cars"

# Automatic heuristic (orchestrator decides)
/orchestrator "Create Header, Sidebar and Footer as separate components in src/components/"
```

### When Fan-out is Used by Heuristic

The orchestrator turns on `--parallel` automatically when a `FRONTEND_ONLY` task (or front-end slice of `FULLSTACK`) lists two or more independent deliverables in acceptance criteria — and the task logic is not shared between them.

Dependent deliverables or those sharing state remain in the single AGY sub-agent, without `--parallel`.

### New Fields in `tasks-classification.md` and `waves.md` (AGY Tasks)

- `agyParallel: yes|no`
- `agyParallelSource: user|heuristic`
- `agySubagentModel: <model>|inherit`

Models accepted in `--agy-model` and `--agy-subagent-model`:

| Model | Tier |
|---|---|
| `gemini-3.5-flash-low` | Flash |
| `gemini-3.5-flash-medium` | Flash |
| `gemini-3.5-flash-high` | Flash |
| `gemini-3.1-pro-low` | Pro |
| `gemini-3.1-pro-high` | Pro |
| `claude-4.6-sonnet-thinking` | Claude |
| `claude-4.6-opus-thinking` | Claude |
| `gpt-oss-120b-medium` | GPT |
| `auto` | — |

## Preflight and Auto-remediation

Run:

```bash
node scripts/preflight.mjs
```

The JSON includes:

- `status`
- `checks`
- `failed`
- `remediation`
- `autoRemediation`

Preflight validates:

- version of `agy` found in PATH;
- Codex CLI in PATH;
- `cc-antigravity-plugin >= 3.6.0` and the `openai-codex` plugin;
- presence of `agents/antigravity-agent.md`, `commands/antigravity.md` and `scripts/antigravity-bridge.js` in the installed AGY plugin;
- `Bash(node:*)` permission for the Codex companion.

> As of version 3.0.0, preflight no longer requires the OpenSpec CLI or `openspec-*` skills, because OpenSpec is no longer part of the flow.

### Auto-remediation Scope

Auto-correction only exists for `codex-companion-bash`:

- if `.claude/settings.json` does not exist, it can be created;
- if it exists with valid JSON, `permissions.allow` receives `Bash(node:*)`;
- if it exists with invalid JSON, the file is not overwritten.

Example of minimum baseline:

```json
{
  "permissions": {
    "allow": [
      "Bash(node:*)"
    ]
  }
}
```

## AGY Prompt Limit — CLI Limitation on Windows

The AGY CLI is invoked via `child_process` by the plugin bridge. On Windows, Node.js passes the prompt as a command-line argument, applying automatic quoting: each `"` becomes `\"` and each `\` doubles.

Results from empirical tests:

| Content Type | Max Prompt | Break Point |
|---|---|---|
| Plain text (xxx...) | 32,694 chars | 32,695 → `ENAMETOOLONG` |
| Real prompt (quotes, `\`, XML, `\n`) | ~28,520 chars | ~29,140 → `ENAMETOOLONG` |

**Conservative threshold adopted: 28,000 chars.**

Before delegating any task to AGY, the orchestrator assembles the complete prompt and counts the characters. If it exceeds 28,000 chars:

1. Divides the task's deliverables into two independent groups (A and B).
2. Creates subtasks `<ID>-a` and `<ID>-b`, each covering one group.
3. Updates `tasks-classification.md` and `waves.md`.
4. Reassembles the two prompts and validates that each is below the limit.
5. Records the split in `monitoring.md` and `workflow-log.md` with original size and reason.

If the task is monolithic and indivisible by deliverables, the orchestrator tries to reduce `Relevant files and modules` and, as a last resort, records `promptOverflow: true` and requests user decision.

## Quota Policy

### Codex on Implementation, Adjustment or Handoff

If `QUOTA_EXHAUSTED`:

- mark `BLOCKED`;
- record evidence;
- request user decision.

The orchestrator does not continue editing productive code on its own.

### Codex on Back-end Review

If `QUOTA_EXHAUSTED`:

- the orchestrator does internal read-only review;
- saves the result in `review-final.md`;
- does not edit productive code.

### AGY on Front-end Review

If `QUOTA_EXAUSTED`, `AUTH_REQUIRED`, `AGY_MISSING` or `TIMEOUT`:

- the orchestrator does internal read-only review;
- saves the result in `review-frontend.md`;
- does not edit productive code.

### Antigravity/AGY on Implementation

Continues with controlled fallback to Codex only when safe. The plugin bridge returns raw status:

- `QUOTA_EXAUSTED`
- `AUTH_REQUIRED`
- `TIMEOUT`
- `AGY_MISSING`

The orchestrator must record these values as they come from the bridge.

## Mandatory Contracts

Contract is mandatory whenever there is data exchange between front-end and back-end.

This applies to:

- `FULLSTACK` tasks;
- dependent pairs `BACKEND_ONLY` + `FRONTEND_ONLY`.

In Phase 2, each task must register `contractRequired: yes|no`.

For `FRONTEND_ONLY` tasks and front-end slice of `FULLSTACK`, also register:

- `agyModel`
- `agyModelSource: user|heuristic`

The routing validator requires these fields on AGY tasks and fails if:

- an AGY task does not register `agyModel`;
- `agyModelSource` is missing;
- the model is outside the allowlist;
- `FRONTEND_ONLY` points to Codex as primary agent.

In Phase 4, the orchestrator creates `contracts/*.md` for every item with `contractRequired: yes`.

## Wire Format and Serialization

Every contract must document:

- expected JSON casing;
- exact field names;
- complete request and response examples;
- global serializer or serialization attributes when present;
- validation of real serialization against the TypeScript consumer.

Especially for C# + TypeScript:

- internal DTO in `PascalCase` is not enough;
- expected JSON payload in `camelCase` must be documented;
- compatibility must be validated on actual payload, not just TypeScript types.

## Main Files

- `commands/orchestrator.md`
- `skills/orchestrator-multi-agent-development/SKILL.md`
- `skills/orchestrator-multi-agent-development/references/workflow.md`
- `skills/orchestrator-multi-agent-development/references/agent-stack.md`
- `skills/orchestrator-multi-agent-development/references/subagent-prompts.md`
- `skills/orchestrator-multi-agent-development/references/contracts.md`
- `skills/orchestrator-multi-agent-development/assets/contract-template.md`
- `skills/orchestrator-multi-agent-development/assets/monitoring-template.md`
- `skills/orchestrator-multi-agent-development/assets/implementation-report-template.md`

## Recommended Validation

```bash
node --check skills/orchestrator-multi-agent-development/scripts/preflight.mjs
node scripts/preflight.mjs
node skills/orchestrator-multi-agent-development/scripts/validate-routing.mjs orchestration/<name>
rg --line-number --fixed-strings -- 'QUOTA_EXAUSTED' README.md commands skills
rg --line-number --fixed-strings -- 'agyModelSource' README.md commands skills
rg --line-number --fixed-strings -- 'agyParallel' README.md commands skills
rg --line-number --fixed-strings -- 'gemini-3.1-pro-high' README.md commands skills
```
