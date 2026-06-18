---
description: Conduzir manualmente um workflow de desenvolvimento multiagentico a partir de um PRD/especificacao ja pronta, com suporte a execucao autonoma via /goal (ingestao do PRD + classificacao + contratos + Codex/Antigravity execucao paralela + review back-end Codex + review front-end AGY + log de workflow + relatorio final + instrucoes de negocio)
argument-hint: "[--agy-model <modelo>] [--agy-parallel] [--agy-subagent-model <modelo>] <PRD/especificacao - ex.: '@docs/prd-reservas.md' ou cole a spec ja pronta>"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node:*), AskUserQuestion, Agent, TaskCreate, TaskUpdate, TaskList, Skill
---

# /orchestrator

Inicia o **Orquestrador Multiagentico de Desenvolvimento** a partir de um PRD ou especificacao ja pronta fornecida pelo usuario. O orquestrador **nao faz discovery nem planejamento**: ele ingere a especificacao como fonte da verdade e orquestra os subagentes. O workflow cobre:

0. Preflight
1. Ingestao do PRD/especificacao fornecido pelo usuario
2. Classificacao das tasks com `contractRequired: yes|no`
3. Ondas de execucao e validacao de roteamento
4. Contratos API/UI para toda troca front-back
5. Delegacao paralela em background:
   - Back-end -> `codex:codex-rescue` com `--effort medium`
   - Front-end -> `cc-antigravity-plugin:antigravity-agent` com `--model` escolhido por heuristica ou override do usuario; quando `agyParallel: yes`, passa `--parallel` ao bridge para fan-out nativo de subagentes Gemini; quando `agySubagentModel` for diferente de `inherit`, passa tambem `--subagent-model`
6. Monitoramento
7. Integracao e resolucao de divergencias
8. Review back-end pos-implementacao (`codex:codex-rescue` com `--effort high`; somente back-end)
9. Review front-end pos-implementacao (`cc-antigravity-plugin:antigravity-agent` com `--model gemini-3.1-pro-high`; ignorar se nao houver front-end)
10. `workflow-log.md` + `subagents-context.md` + `implementation-report.md`
11. Instrucoes de negocio para o usuario

## Regra central de execucao

Durante um workflow iniciado por `/orchestrator`, o Claude atua somente como orquestrador principal: mantem contexto, decide proximos passos, atualiza artefatos de coordenacao e delega implementacao para subagentes. Ele nao implementa codigo diretamente e nao reabre o entendimento da demanda — a especificacao fornecida pelo usuario e a fonte da verdade.

Atividades paralelas de implementacao devem usar subagentes. Para back-end, banco, testes, ajustes pontuais, handoffs e recuperacao de falha operacional, use `codex:codex-rescue` com `--effort medium`. O review back-end usa `codex:codex-rescue` com `--effort high`, sempre deixando o modelo no padrao disponivel na conta. O review front-end usa `cc-antigravity-plugin:antigravity-agent` com `--model gemini-3.1-pro-high`. Codex nunca revisa front-end.

O roteamento de implementacao segue a categoria da task. Toda task `FRONTEND_ONLY` deve ser delegada ao `cc-antigravity-plugin:antigravity-agent`, inclusive setup Vite/React, rotas, tipos TypeScript, servicos API e componentes simples. Codex so recebe front-end como fallback operacional registrado depois de falha/cota do AGY ou decisao explicita do usuario.

Tasks de front-end devem ser delegadas ao Antigravity/AGY por categoria, chamando o bridge do plugin com `--model <agyModel>`. O bridge aplica o modelo via `~/.gemini/antigravity-cli/settings.json`, sem repassar `--model` como flag nativa do `agy`.

Selecao de modelo AGY:

- se o usuario invocar `/orchestrator --agy-model <modelo> <demanda>`, preserve o override em todo o workflow;
- se nao houver override, escolha por dificuldade:
  - padrao: `gemini-3.5-flash-medium`;
  - tasks front-end complexas, multi-rota, multi-arquivo, com contrato API/UI delicado ou alto risco de regressao: `gemini-3.1-pro-low`;
  - tasks criticas ou explicitamente pesadas: `gemini-3.1-pro-high`.
- O review front-end (Fase 9) usa sempre `gemini-3.1-pro-high`, independentemente do `agyModel` de implementacao.

Fan-out de subagentes AGY:

- `--agy-parallel`: quando presente em `$ARGUMENTS`, registre `agyParallel: yes` e `agyParallelSource: user` em todas as tasks AGY, independente de heuristica.
- `--agy-subagent-model <modelo>`: valide contra a allowlist de modelos AGY; registre `agySubagentModel: <modelo>` e ligue `agyParallel: yes` automaticamente (`--agy-subagent-model` implica `--agy-parallel`). Modelo sera passado como `--subagent-model <modelo>` ao bridge.
- Sem override de usuario, o orquestrador avalia por heuristica: tasks com dois ou mais entregaveis independentes recebem `agyParallel: yes` e `agyParallelSource: heuristic`.
- Default: `agySubagentModel: inherit` (omite `--subagent-model`; subagentes herdam `agyModel`).

Modelos permitidos para `--agy-model` e `--agy-subagent-model`:

- `gemini-3.5-flash-low`
- `gemini-3.5-flash-medium`
- `gemini-3.5-flash-high`
- `gemini-3.1-pro-low`
- `gemini-3.1-pro-high`
- `claude-4.6-sonnet-thinking`
- `claude-4.6-opus-thinking`
- `gpt-oss-120b-medium`
- `auto`

Politica de cota:

- `QUOTA_EXHAUSTED` em implementacao, ajuste pontual ou handoff via Codex: marque `BLOCKED`, registre evidencia e peca decisao ao usuario.
- `QUOTA_EXHAUSTED` em review back-end Codex: faca fallback de review read-only pelo proprio orquestrador, sem editar codigo produtivo, e salve o resultado em `review-final.md`.
- `QUOTA_EXAUSTED`/`AUTH_REQUIRED`/`AGY_MISSING`/`TIMEOUT` em review front-end AGY: faca fallback de review read-only pelo proprio orquestrador, sem editar codigo produtivo, e salve o resultado em `review-frontend.md`.
- `QUOTA_EXAUSTED` no Antigravity/AGY em implementacao: registre o status cru retornado pelo bridge, o `reason`, o `model` e o retry sugerido `--continue`; avalie fallback para Codex apenas quando for seguro e documente o handoff.
- `AUTH_REQUIRED` no Antigravity/AGY: marque bloqueio operacional e oriente o usuario a rodar `agy` interativamente uma vez.
- `AGY_MISSING` no Antigravity/AGY: marque bloqueio operacional e mostre a remediacao de instalacao.
- `TIMEOUT` no Antigravity/AGY: registre evidencia e decida entre aumentar timeout, reduzir escopo ou quebrar a task.

Politica de sandbox Codex:

- Rede externa bloqueada para pacote/restore, pacote ausente no cache local ou `UnauthorizedAccessException` fora do working directory permitido devem virar `BLOCKED`, com evidencia em `monitoring.md`, `workflow-log.md` e `subagents-context.md`.
- Nao tente contornar esses limites com retries longos, troca arbitraria de ferramenta ou escrita fora do escopo.
- Para UI sem dependencia de rede, mantenha Antigravity/AGY como rota primaria; Codex so assume front-end com fallback documentado e escrita permitida.

## Argumento

`$ARGUMENTS` - o PRD/especificacao a orquestrar, fornecido por mencao de arquivo (`@caminho/para/prd.md`), texto colado ou arquivo enviado. Opcionalmente pode comecar com um ou mais dos seguintes overrides (em qualquer ordem):

- `--agy-model <modelo>` — modelo AGY principal de implementacao
- `--agy-parallel` — forca fan-out de subagentes Gemini em todas as tasks AGY
- `--agy-subagent-model <modelo>` — modelo dos subagentes Gemini (implica `--agy-parallel`)

## Execucao autonoma com `/goal`

Para trabalho independente entre turnos, o modo recomendado e envolver a demanda em `/goal`.

```text
/goal Execute a skill cc-orchestrador-subagents:orchestrator-multi-agent-development para orquestrar a especificacao: <PRD/spec>. Condicao de conclusao: preflight OK; especificacao ingerida; tasks classificadas e roteamento validado; ondas de subagentes Codex/Antigravity encerradas ou bloqueios documentados; review back-end (Codex) executado ou N/A; review front-end (AGY gemini-3.1-pro-high) executado ou N/A; workflow-log.md, subagents-context.md e implementation-report.md criados; resultados de testes/validacoes e instrucoes de negocio publicados na conversa; ou pare apos 20 turnos preservando o estado.
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

O JSON inclui `autoRemediation`. Se a permissao `Bash(node:*)` foi criada ou ajustada em `.claude/settings.json`, reporte isso ao usuario junto com o status final e diga se a correcao foi revalidada.

O preflight tambem valida `cc-antigravity-plugin >= 3.6.0` (requerido para `--parallel`/`--subagent-model`), a presenca de `agents/antigravity-agent.md`, `commands/antigravity.md` e `scripts/antigravity-bridge.js`, alem da versao detectada de `agy`.

### Passo 2 - Carregar a skill

`Skill(skill="cc-orchestrador-subagents:orchestrator-multi-agent-development")`.

### Passo 3 - Validacoes leves antes da ingestao

Antes dessas validacoes, parseie as flags de override no inicio de `$ARGUMENTS` (em qualquer ordem):

- `--agy-model <modelo>`: valide e registre `agyModelSource: user`.
- `--agy-parallel`: registre `agyParallelSource: user` para todas as tasks AGY.
- `--agy-subagent-model <modelo>`: valide contra a allowlist, registre `agySubagentModel: <modelo>`, ligue `agyParallel: yes` automaticamente.

Remova todos os prefixos reconhecidos do argumento. Se nao houver override de modelo, registre `agyModelSource: heuristic`. Se nao houver override de `--agy-parallel`, o orquestrador avalia por heuristica task a task.

- Se a demanda e trivial (typo, padding, rename) -> avise que o orquestrador e overkill e ofereca executar direto.
- Se o usuario nao forneceu um PRD/especificacao (nenhum arquivo mencionado/enviado e nenhuma spec colada) -> use `AskUserQuestion` pedindo o PRD/spec antes de continuar. O orquestrador nao inventa a especificacao.

### Passo 4 - Conduzir o workflow

Siga `SKILL.md` + `references/*.md`. Crie os artefatos de coordenacao em `.orchestration/<nome>/`, onde `<nome>` e um identificador descritivo em kebab-case derivado do PRD/spec. Use `assets/*.md` para os templates.

Depois de gerar `tasks-classification.md` e `waves.md`, rode `node "${CLAUDE_PLUGIN_ROOT}/skills/orchestrator-multi-agent-development/scripts/validate-routing.mjs" ".orchestration/<nome>"` ou o caminho equivalente via `${CLAUDE_SKILL_DIR}`. Se falhar, corrija os artefatos antes de delegar.

As tasks `FRONTEND_ONLY` e a fatia front-end de `FULLSTACK` devem registrar `agyModel` e `agyModelSource: user|heuristic` em `tasks-classification.md` e `waves.md`.

Antes de iniciar cada fase e antes de lancar ou redelegar subagentes, faca um gate operacional:

- Se a mensagem mais recente do usuario indicar cancelamento, pausa, reprovacao do plano/contrato ou problema bloqueante, interrompa imediatamente.
- Nao invoque novos subagentes, nao edite implementacao e nao avance de fase.
- Atualize `monitoring.md`, `workflow-log.md` e `subagents-context.md` com `CANCELLED` ou `PAUSED` quando ja houver artefatos.

### Passo 5 - Reportar updates

Mantenha o usuario informado com mensagens curtas:

- `preflight OK`
- se houve auto-correcao: `preflight auto-remediou Bash(node:*) em .claude/settings.json e revalidou`
- `Context7 MCP detectado; vou exigir docs atuais nos prompts dos subagentes`
- `especificacao ingerida; classificando tasks em .orchestration/<nome>`
- `lancei <N> subagentes em paralelo para a onda <N>, aviso quando completarem`
- no fim: caminhos do `.orchestration/<nome>/workflow-log.md`, `.orchestration/<nome>/implementation-report.md` e `.orchestration/<nome>/subagents-context.md` + resumo de 2-3 frases + instrucoes de negocio

## Quando o usuario invocar sem argumento

Se `$ARGUMENTS` estiver vazio, use `AskUserQuestion` para pedir o PRD/especificacao a orquestrar.

## Quando nao usar

Se a demanda for troca de texto, cor, padding, typo, import order ou ajuste de 1-2 linhas, ofereca execucao direta sem orquestracao.
