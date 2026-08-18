---
description: Conduzir, retomar e manter um workflow multiagentico persistente que acumula conhecimento comprovado, com state machine, lifecycle, worktrees, validacao deterministica, telemetria e learning
argument-hint: "resume [runId] | preflight | knowledge <status|search|pin|archive|rollback> | telemetry <report|compact> | [flags] <PRD/especificacao>"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node:*), AskUserQuestion, Agent, TaskCreate, TaskUpdate, TaskList, Skill
---

# /orchestrator

Inicia o **Orquestrador Multiagentico de Desenvolvimento** a partir de um PRD ou especificacao ja pronta fornecida pelo usuario. O orquestrador **nao faz discovery nem planejamento**: ele ingere a especificacao como fonte da verdade e orquestra os subagentes. O workflow cobre:

0. Preflight
1. Project Memory comprovada + historico FTS5 + ingestao do PRD/especificacao
2. Classificacao das tasks com contrato, evidence plan, scope, complexidade e features
3. Ondas, routing adaptativo conservador e plano de worktrees
4. Contratos API/UI e programmatic validation para toda troca front-back
5. Delegacao paralela em worktrees elegiveis:
   - Back-end -> `codex:codex-rescue` com `--effort medium`
   - Front-end -> `cc-antigravity-plugin:antigravity-coder` com `--model` escolhido por heuristica ou override do usuario; quando `agyParallel: yes`, passa `--parallel` ao bridge para fan-out nativo de subagentes Gemini; quando `agySubagentModel` for diferente de `inherit`, passa tambem `--subagent-model`
6. Lifecycle Manager com probes, leases, heartbeat, stall/grace e reconciliacao
7. Integracao recuperavel e validacao deterministica de diff/escopo/wire/testes
8. Review back-end pos-implementacao (`codex:codex-rescue` com `--effort high`; somente back-end)
9. Review front-end pos-implementacao (`cc-antigravity-plugin:antigravity-agent` com `--model gemini-3.1-pro-high`; ignorar se nao houver front-end)
10. `workflow-log.md` + `subagents-context.md` + `implementation-report.md` + handoff
11. Entrega duravel ainda nao publicada
12. `learning-report.md`, candidate lessons, history/telemetry, audit terminal e publicacao

Cada run mantem `.orchestration/<slug>/state.json` e `events.jsonl`; o projeto mantem `.orchestrator/project-memory.md`, `knowledge.db`, `history.db`, `telemetry.jsonl` e `learned/`. Toda transicao terminal e persistida antes de ser anunciada; uma task cujo resultado nao puder ser determinado apos interrupcao fica `UNKNOWN`, nunca `FAILED` por suposicao. Memoria aceita apenas fatos com fonte comprovada, e learning nunca edita a skill automaticamente.

## Regra central de execucao

Durante um workflow iniciado por `/orchestrator`, o Claude atua somente como orquestrador principal: mantem contexto, decide proximos passos, atualiza artefatos de coordenacao e delega implementacao para subagentes. Ele nao implementa codigo diretamente e nao reabre o entendimento da demanda — a especificacao fornecida pelo usuario e a fonte da verdade.

Atividades paralelas de implementacao devem usar subagentes. Para back-end, banco, testes, ajustes pontuais, handoffs e recuperacao de falha operacional, use `codex:codex-rescue` com `--effort medium`. O review back-end usa `codex:codex-rescue` com `--effort high`, sempre deixando o modelo no padrao disponivel na conta. O review front-end usa `cc-antigravity-plugin:antigravity-agent` com `--model gemini-3.1-pro-high`. Codex nunca revisa front-end.

O roteamento de implementacao segue a categoria da task. Toda task `FRONTEND_ONLY` deve ser delegada ao `cc-antigravity-plugin:antigravity-coder`, inclusive setup Vite/React, rotas, tipos TypeScript, servicos API e componentes simples. `antigravity-agent` e **somente leitura** (analise, planejamento, review) e nunca deve receber tasks de implementacao — usar `antigravity-agent` para escrever codigo e um erro de roteamento. Codex so recebe front-end como fallback operacional registrado depois de falha/cota do AGY ou decisao explicita do usuario.

Tasks de front-end devem ser delegadas ao Antigravity/AGY por categoria, chamando o bridge do plugin com `--model <agyModel>`. O bridge aplica o modelo via `~/.gemini/antigravity-cli/settings.json`, sem repassar `--model` como flag nativa do `agy`.

Selecao de modelo AGY:

- se o usuario invocar `/orchestrator --agy-model <modelo> <demanda>`, preserve o override em todo o workflow;
- se nao houver override, determine o piso por dificuldade e consulte o router adaptativo:
  - padrao: `gemini-3.5-flash-medium`;
  - tasks front-end complexas, multi-rota, multi-arquivo, com contrato API/UI delicado ou alto risco de regressao: `gemini-3.1-pro-low`;
  - tasks criticas ou explicitamente pesadas: `gemini-3.1-pro-high`.
- O router so pode escalar com amostra historica comparavel suficiente (`taskType` + `complexity`), nunca reduz o piso e precisa registrar `agyModelEvidence`. Sem evidencia, use a heuristica.
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

Subcomandos reservados:

- `preflight` — valida apenas as dependencias;
- `resume` — retoma o run ativo mais recentemente atualizado;
- `resume <runId>` — retoma o run exato sem assumir o resultado de tasks interrompidas;
- `knowledge status` — resume memoria, historico, recipes e Curator;
- `knowledge search <query>` — busca FTS5 cross-run;
- `knowledge pin|archive|activate <recipeId>` — controla uma Learned Recipe explicitamente;
- `knowledge curate [--apply]` — mostra/aplica o lifecycle do Curator; sem `--apply` e sempre dry-run;
- `knowledge rollback <backupId> [--apply]` — valida/mostra ou restaura backup; sem `--apply` nao muta;
- `telemetry report` — agrega produtividade/qualidade metadata-only;
- `telemetry compact [--retention-days N] [--apply]` — preview/aplica retencao recuperavel.

## Execucao autonoma com `/goal`

Para trabalho independente entre turnos, o modo recomendado e envolver a demanda em `/goal`.

```text
/goal Execute a skill cc-orchestrador-subagents:orchestrator-multi-agent-development para orquestrar a especificacao: <PRD/spec>. Condicao de conclusao: preflight e SQLite/FTS5 OK; Project Memory auditada; especificacao ingerida; tasks classificadas com evidence plan/scope e roteamento validado; worktrees/lifecycle encerrados ou bloqueios documentados; reviews e E2E aplicaveis executados; reports/handoff e learning-report.md criados; Phase 12 concluida; history/telemetry projetados; audit.complete=true; run DONE e verify OK; so entao resultados e instrucoes publicados; ou pare preservando o estado sem presumir resultado.
```

## Comportamento

Quando este comando for invocado, siga esta ordem:

### Modo knowledge

Se o primeiro argumento for `knowledge`, este ramo substitui a execucao de PRD. Nao inicialize run nem delegue agentes. Mapeie o segundo argumento:

```bash
# status consolidado (execute os tres)
node "${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator-knowledge.mjs" status
node "${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator-knowledge.mjs" history-status
node "${CLAUDE_PLUGIN_ROOT}/scripts/orchestration-learning.mjs" curator-status

# busca historica
node "${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator-knowledge.mjs" history-search "<query>"

# lifecycle explicito de recipe
node "${CLAUDE_PLUGIN_ROOT}/scripts/orchestration-learning.mjs" recipe-pin --id "<id>"
node "${CLAUDE_PLUGIN_ROOT}/scripts/orchestration-learning.mjs" recipe-archive --id "<id>"
node "${CLAUDE_PLUGIN_ROOT}/scripts/orchestration-learning.mjs" recipe-activate --id "<id>"

# curator/rollback: preview por padrao; mutacao so com --apply do usuario
node "${CLAUDE_PLUGIN_ROOT}/scripts/orchestration-learning.mjs" curate [--apply]
node "${CLAUDE_PLUGIN_ROOT}/scripts/orchestration-learning.mjs" rollback --backup "<id>" [--apply]
```

`knowledge render`, `knowledge audit`, `knowledge backups` e `knowledge history-project` mapeiam para os comandos homonimos das CLIs. `pin/archive/activate/rollback` exigem ID explicito; nao escolha uma recipe/backup por inferencia. Mostre contradicoes e `needsReview`; recipe contraditoria nao pode ser aplicada.

### Modo telemetry

Se o primeiro argumento for `telemetry`, nao inicialize run. Mapeie `report`, `compact`, `otlp-preview` e `otlp-export` para `scripts/orchestration-telemetry.mjs`. `compact` e dry-run sem `--apply`; export OTLP exige endpoint fornecido explicitamente, usa HTTPS por padrao e envia somente metadata allowlisted.

### Modo resume

Se o primeiro argumento for `resume`, trate o segundo argumento, quando presente, como `runId`. Antes de qualquer nova delegacao, execute:

```bash
# Sem runId: seleciona a run ativa mais recente
node "${CLAUDE_PLUGIN_ROOT}/scripts/orchestration-state.mjs" resume

# Com runId/slug explicito
node "${CLAUDE_PLUGIN_ROOT}/scripts/orchestration-state.mjs" resume "operatus-equipamento-20260814-001"
```

O comando faz replay/reparo do log, muda tasks previamente `RUNNING` para `UNKNOWN`, reconcilia Git/arquivos e retorna `resumeFromPhase`, `currentWave`, `pendingExternalProbes` e `recommendations`.

Para cada `pendingExternalProbes`:

1. consulte `TaskList` e as capacidades de retomada/status do subagente instalado;
2. para Codex, correlacione pelo `sessionId`/task ID; para AGY, correlacione pelo `conversationId` e pelo retorno persistido do bridge;
3. se a integracao nao expuser status autoritativo, mantenha `UNKNOWN` e use Git, arquivos e validacoes apenas como evidencia — nunca como prova isolada de sucesso;
4. grave um `.orchestration/<slug>/reconciliation-probe.json` sem secrets, no formato de `references/persistent-state.md`, e rode:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/orchestration-state.mjs" reconcile \
  --dir ".orchestration/<slug>" \
  --probe-file ".orchestration/<slug>/reconciliation-probe.json"
```

Quando `.orchestrator/executor-control.json` existir e validar contra `executor-control-config.schema.json`, prefira a reconciliacao automatizada:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/orchestration-lifecycle.mjs" tick \
  --dir ".orchestration/<slug>" --resume \
  --adapter-config ".orchestrator/executor-control.json"
```

O manager persiste o retorno redigido/limitado do executor em `executor-results/` antes de atualizar o state. Sem adapter ou status autoritativo, mantenha `UNKNOWN`; Git/arquivos/testes sao corroboracao, nao substitutos de ownership externo.

Nao redelegue task `UNKNOWN` ate confirmar que a sessao/conversation anterior nao segue ativa e avaliar mudancas parciais. Depois da reconciliacao, rode o preflight; se passar, carregue a skill e continue exatamente de `resumeFromPhase`/`currentWave`. Se o state engine retornar `RUN_NOT_FOUND`, informe o erro e encerre sem criar um run novo implicitamente.

Este ramo substitui a ingestao/inicializacao de uma run nova: nao interprete `resume` como PRD, nao execute `init` novamente e nao passe pela validacao de "PRD ausente" do Passo 3. Apos preflight + carregamento da skill, salte diretamente para a fase/wave devolvida pelo state engine.

Leia `references/persistent-state.md` por completo ao entrar neste modo.

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

O preflight tambem valida `cc-antigravity-plugin >= 3.6.0` (requerido para `--parallel`/`--subagent-model`), a presenca de `agents/antigravity-coder.md` (implementacao), `agents/antigravity-agent.md` (review read-only), `commands/antigravity.md` e `scripts/antigravity-bridge.js`, alem da versao detectada de `agy`.

Tambem exige Node.js `>=22.13.0`, `node:sqlite` sem flag experimental e SQLite FTS5. Essa checagem e bloqueante para Project Memory, history, recipes e adaptive routing.

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

### Passo 3.5 - Carregar conhecimento comprovado

Antes de classificar tasks, inicialize/audite a Project Memory e reconstrua a projecao historica:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator-knowledge.mjs" init
node "${CLAUDE_PLUGIN_ROOT}/scripts/intelligence/inspect-project.mjs" --root "." --persist-knowledge
node "${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator-knowledge.mjs" audit
node "${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator-knowledge.mjs" history-project
```

Leia `.orchestrator/project-memory.md` junto do PRD. Nao use fatos `STALE`, `CONFLICT` ou `REVOKED`. Se o PRD/ambiente trouxer error fingerprints, stacks ou padroes relevantes, use `history-search` e carregue apenas o resultado condensado. Historico nao substitui a especificacao nem autoriza aplicar recipe sem trigger deterministico.

### Passo 4 - Conduzir o workflow

Siga `SKILL.md` + `references/*.md`. Crie os artefatos de coordenacao em `.orchestration/<nome>/`, onde `<nome>` e um identificador descritivo em kebab-case derivado do PRD/spec. Use `assets/*.md` para os templates.

Assim que `<nome>`/`<slug>` estiver resolvido, inicialize o run antes de continuar:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/orchestration-state.mjs" init \
  --slug "<nome>" --dir ".orchestration/<nome>" --phase 1
```

Depois de gerar `tasks-classification.md` e `waves.md`, rode `node "${CLAUDE_PLUGIN_ROOT}/skills/orchestrator-multi-agent-development/scripts/validate-routing.mjs" ".orchestration/<nome>"` ou o caminho equivalente via `${CLAUDE_SKILL_DIR}`. Se falhar, corrija os artefatos antes de delegar.

Depois que o roteamento passar, sincronize tasks/waves no snapshot:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/orchestration-state.mjs" sync \
  --dir ".orchestration/<nome>"
```

Antes do validator final, tasks AGY sem override consultam `orchestration-router.mjs route`. Preserve o piso heuristico e grave a decisao com `--record`; `source: adaptive` exige `agyModelEvidence`, caso contrario mantenha `heuristic`. Depois de `sync`, execute `orchestration-worktree.mjs plan` por wave. So `ISOLATED` pode ser criado/rodado concorrentemente; `SERIAL`/`UNSCOPED` aguardam.

Antes/depois de cada fase, persista `phase --status RUNNING|DONE|FAILED|BLOCKED|CANCELLED|UNKNOWN` com evidencia. Antes de lancar um subagente, crie a worktree elegivel, adquira lease e persista a task como `RUNNING` com executor, modelo, attempt e `sessionId`/`conversationId`. Durante a Fase 6, use `orchestration-lifecycle.mjs watch/tick` com adapter quando disponivel; grave heartbeat somente quando houver atividade observavel e execute `sweep`. O retorno externo redigido deve ser persistido antes de `DONE`/`FAILED`/`BLOCKED` e antes de anunciar o resultado. Use apenas estados canonicos e preserve quota/auth/timeout em `reasonCode`.

Na integracao, use `ready` + `integrate` para worktrees e os scripts `inspect-diff`, `validate-task-scope`, `inspect-api-ui`, `validate-wire-format` e `collect-test-results` para mecanica repetitiva. Se a operacao exigiria tres ou mais Greps/Reads, loop ou comparacao mecanica, a regra e usar script deterministico e consumir seu JSON condensado.

Depois de reports/handoff e da entrega duravel da Fase 11, execute a Fase 12 antes de fechar a run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/orchestration-learning.mjs" run --dir ".orchestration/<nome>"
node "${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator-knowledge.mjs" history-project --dir ".orchestration/<nome>"
node "${CLAUDE_PLUGIN_ROOT}/scripts/orchestration-telemetry.mjs" project --dir ".orchestration/<nome>"
node "${CLAUDE_PLUGIN_ROOT}/scripts/orchestration-state.mjs" audit --dir ".orchestration/<nome>"
```

Somente com `audit.complete: true`, todas as tasks/gates/evidencias/artefatos completos e Phase 12 `DONE`, marque `run --status DONE`, rode `verify`, reprojete history/telemetry e publique a mensagem ao usuario. Candidate lessons nunca sao promovidas automaticamente nem alteram `SKILL.md`.

As tasks `FRONTEND_ONLY` e a fatia front-end de `FULLSTACK` devem registrar `agyModel` e `agyModelSource: user|heuristic|adaptive` em `tasks-classification.md` e `waves.md`; `adaptive` sem `agyModelEvidence` e invalido.

Antes de iniciar cada fase e antes de lancar ou redelegar subagentes, faca um gate operacional:

- Se a mensagem mais recente do usuario indicar cancelamento, pausa, reprovacao do plano/contrato ou problema bloqueante, interrompa imediatamente.
- Nao invoque novos subagentes, nao edite implementacao e nao avance de fase.
- Atualize `monitoring.md`, `workflow-log.md` e `subagents-context.md` com `CANCELLED` ou `PAUSED` quando ja houver artefatos.

### Passo 5 - Reportar updates

Mantenha o usuario informado com mensagens curtas:

- `preflight OK`
- se houve auto-correcao: `preflight auto-remediou Bash(node:*) em .claude/settings.json e revalidou`
- `Context7 MCP detectado; vou exigir docs atuais nos prompts dos subagentes`
- `Project Memory auditada; carreguei apenas fatos validados e projetei o historico pesquisavel`
- `especificacao ingerida; classificando tasks em .orchestration/<nome>`
- `wave <N>: <X> tasks isoladas em worktrees e <Y> serializadas por overlap/escopo`
- `lancei <N> subagentes em paralelo para a onda <N>, aviso quando completarem`
- no fim: caminhos do `workflow-log.md`, `implementation-report.md`, `subagents-context.md` e `learning-report.md` + resumo e instrucoes de negocio
- no fim: confirme `audit.complete: true`, Phase 12, history/telemetry projetados, `runId` terminal e `verify` aprovado

## Quando o usuario invocar sem argumento

Se `$ARGUMENTS` estiver vazio, use `AskUserQuestion` para pedir o PRD/especificacao a orquestrar.

## Quando nao usar

Se a demanda for troca de texto, cor, padding, typo, import order ou ajuste de 1-2 linhas, ofereca execucao direta sem orquestracao.
