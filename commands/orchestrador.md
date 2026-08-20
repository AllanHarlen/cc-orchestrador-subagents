---
name: orchestrador
description: Alias em portugues para /orchestrator
argument-hint: "resume [runId] | preflight | project-config | knowledge <acao> | telemetry <acao> | [flags] <PRD/especificacao>"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node:*), AskUserQuestion, Agent, TaskCreate, TaskUpdate, TaskList, Skill
---

# /orchestrador

Este comando e um alias em portugues de `/orchestrator`.

Quando invocado, leia `${CLAUDE_PLUGIN_ROOT}/commands/orchestrator.md` e execute exatamente o mesmo workflow ali definido, preservando todos os argumentos fornecidos pelo usuario em `$ARGUMENTS`, inclusive `resume [runId]`, `project-config`, `knowledge ...`, `telemetry ...`, `--agy-model <modelo>`, `--agy-parallel`, `--agy-subagent-model <modelo>`, `--agy-effort <nivel>` e `--agy-timeout <duracao>` quando presentes.

Se `$ARGUMENTS` estiver vazio, siga a regra "Quando o usuario invocar sem argumento" do comando `/orchestrator`.
