---
description: Conduzir manualmente um workflow de desenvolvimento multiagentico, com suporte a execucao autonoma via /goal (OpenSpec + planejamento do orquestrador + Codex review + Codex/Antigravity execucao paralela + log de workflow + relatorio final + instrucoes de negocio)
argument-hint: "<descricao da demanda - ex.: 'implemente o fluxo de reservas com listagem, criacao e cancelamento'>"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node:*), AskUserQuestion, Agent, TaskCreate, TaskUpdate, TaskList, Skill
---

# /orchestrator

Inicia o **Orquestrador Multiagentico de Desenvolvimento** para a demanda descrita pelo usuario. O workflow cobre:

1. Entendimento da demanda
2. Criacao de mudanca OpenSpec
3. Plano tecnico feito pelo orquestrador
4. Review do plano (`codex:codex-rescue` com Codex padrao da conta e `--effort high`)
5. Consolidacao do plano
6. Classificacao das tasks
7. Identificacao de paralelizacao
8. Contratos API/UI para toda troca front-back com `contractRequired: yes|no`
9. Delegacao paralela em background:
   - Back-end -> `codex:codex-rescue` com `--effort medium`
   - Front-end -> `cc-antigravity-plugin:antigravity-agent` (AGY sem especificar modelo ou modo)
10. Monitoramento
11. Integracao e resolucao de divergencias
12. Review pos-implementacao
13. Verificacao OpenSpec
14. `workflow-log.md` + `subagents-context.md` + `implementation-report.md`
15. Instrucoes de negocio para o usuario

## Regra central de execucao

Durante um workflow iniciado por `/orchestrator`, o Claude atua somente como orquestrador principal: mantem contexto, decide proximos passos, atualiza artefatos de coordenacao e delega implementacao para subagentes. Ele nao implementa codigo diretamente.

Atividades paralelas de implementacao devem usar subagentes. Para back-end, banco, testes, ajustes pontuais, handoffs e recuperacao de falha operacional, use `codex:codex-rescue` com `--effort medium`. Reviews formais usam `codex:codex-rescue` com `--effort high`, sempre deixando o modelo no padrao disponivel na conta.

O roteamento de implementacao segue a categoria da task. Toda task `FRONTEND_ONLY` deve ser delegada ao `cc-antigravity-plugin:antigravity-agent`, inclusive setup Vite/React, rotas, tipos TypeScript, servicos API e componentes simples. Codex so recebe front-end como fallback operacional registrado depois de falha/cota do AGY ou decisao explicita do usuario.

Tasks de front-end devem ser delegadas ao Antigravity/AGY por categoria, sem passar `--model` ou qualquer seletor de modo. O AGY usa o padrao disponivel no proprio plugin/CLI.

Politica de cota:

- `QUOTA_EXHAUSTED` em implementacao, ajuste pontual ou handoff via Codex: marque `BLOCKED`, registre evidencia e peca decisao ao usuario.
- `QUOTA_EXHAUSTED` em review Codex: faca fallback de review read-only pelo proprio orquestrador, sem editar codigo produtivo, e salve o resultado em `review-final.md`.

Politica de sandbox Codex:

- Rede externa bloqueada para pacote/restore, pacote ausente no cache local ou `UnauthorizedAccessException` fora do working directory permitido devem virar `BLOCKED`, com evidencia em `monitoring.md`, `workflow-log.md` e `subagents-context.md`.
- Nao tente contornar esses limites com retries longos, troca arbitraria de ferramenta ou escrita fora do escopo.
- Para UI sem dependencia de rede, mantenha Antigravity/AGY como rota primaria; Codex so assume front-end com fallback documentado e escrita permitida.

## Argumento

`$ARGUMENTS` - descricao da demanda em linguagem natural. Pode ser frase unica ou paragrafo com contexto.

## Execucao autonoma com `/goal`

Para trabalho independente entre turnos, o modo recomendado e envolver a demanda em `/goal`.

```text
/goal Execute a skill cc-orchestrador-subagents:orchestrator-multi-agent-development para: <demanda>. Condicao de conclusao: preflight OK; mudanca OpenSpec criada, planejada e revisada; ondas de subagentes Codex/Antigravity encerradas ou bloqueios documentados; review pos-implementacao executado; verificacao OpenSpec executada ou impedimento registrado; workflow-log.md, subagents-context.md e implementation-report.md criados; resultados de testes/validacoes e instrucoes de negocio publicados na conversa; ou pare apos 20 turnos preservando o estado.
```

## Comportamento

Quando este comando for invocado, siga esta ordem:

### Modo preflight

Se `$ARGUMENTS` for exatamente `preflight`, rode apenas:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs"
```

Mostre o resumo do JSON ao usuario e encerre.

### Passo 1 - Preflight

Execute:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs"
```

Parse o JSON retornado:

- `status: "ok"` -> siga.
- `status: "failed"` -> cancele imediatamente e use `remediation`.

O JSON agora inclui `autoRemediation`. Se a permissao `Bash(node:*)` foi criada ou ajustada em `.claude/settings.json`, reporte isso ao usuario junto com o status final e diga se a correcao foi revalidada.

### Passo 2 - Carregar a skill

`Skill(skill="cc-orchestrador-subagents:orchestrator-multi-agent-development")`.

### Passo 3 - Validacoes leves antes da Fase 1

- Se a demanda e trivial (typo, padding, rename) -> avise que o orquestrador e overkill e ofereca executar direto.
- Se o repositorio atual nao tem `openspec/` -> ofereca `/openspec-onboard` antes de continuar.

### Passo 4 - Conduzir o workflow

Siga `SKILL.md` + `references/*.md`. Use `assets/*.md` para criar artefatos em `openspec/changes/<nome>/`.

Depois de gerar `tasks-classification.md` e `waves.md`, rode `node "${CLAUDE_PLUGIN_ROOT}/skills/orchestrator-multi-agent-development/scripts/validate-routing.mjs" "openspec/changes/<nome>"` ou o caminho equivalente via `${CLAUDE_SKILL_DIR}`. Se falhar, corrija os artefatos antes de delegar.

Antes de iniciar cada fase e antes de lancar ou redelegar subagentes, faca um gate operacional:

- Se a mensagem mais recente do usuario indicar cancelamento, pausa, reprovacao do plano/contrato ou problema bloqueante, interrompa imediatamente.
- Nao invoque novos subagentes, nao edite implementacao e nao avance de fase.
- Atualize `monitoring.md`, `workflow-log.md` e `subagents-context.md` com `CANCELLED` ou `PAUSED` quando a mudanca ja tiver artefatos.

### Passo 5 - Reportar updates

Mantenha o usuario informado com mensagens curtas:

- `preflight OK`
- se houve auto-correcao: `preflight auto-remediou Bash(node:*) em .claude/settings.json e revalidou`
- `Context7 MCP detectado; vou exigir docs atuais nos prompts dos subagentes`
- `criando mudanca OpenSpec <nome>`
- `lancei <N> subagentes em paralelo para a onda <N>, aviso quando completarem`
- no fim: caminhos do `workflow-log.md`, `implementation-report.md` e `subagents-context.md` + resumo de 2-3 frases + instrucoes de negocio

## Quando o usuario invocar sem argumento

Se `$ARGUMENTS` estiver vazio, use `AskUserQuestion` para pedir o tipo de demanda.

## Quando nao usar

Se a demanda for troca de texto, cor, padding, typo, import order ou ajuste de 1-2 linhas, ofereca execucao direta sem orquestracao.
