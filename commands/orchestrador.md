---
name: orchestrador
description: Alias em portugues para /orchestrator
argument-hint: "[--agy-model <modelo>] [--agy-parallel] [--agy-subagent-model <modelo>] <descricao da demanda>"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node:*), AskUserQuestion, Agent, TaskCreate, TaskUpdate, TaskList, Skill
---

# /orchestrador

Este comando e um alias em portugues de `/orchestrator`.

Quando invocado, leia `${CLAUDE_PLUGIN_ROOT}/commands/orchestrator.md` e execute exatamente o mesmo workflow ali definido, preservando todos os argumentos fornecidos pelo usuario em `$ARGUMENTS`, inclusive `--agy-model <modelo>`, `--agy-parallel` e `--agy-subagent-model <modelo>` quando presentes.

Se `$ARGUMENTS` estiver vazio, siga a regra "Quando o usuario invocar sem argumento" do comando `/orchestrator`.
