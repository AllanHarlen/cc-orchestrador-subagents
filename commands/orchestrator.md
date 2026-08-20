---
description: Conduzir, retomar e manter um workflow multiagentico persistente que acumula conhecimento comprovado, com state machine, lifecycle, worktrees, validacao deterministica, telemetria e learning
argument-hint: "resume [runId] | preflight | project-config | knowledge <status|search|pin|archive|rollback> | telemetry <report|compact> | [flags] <PRD/especificacao>"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node:*), AskUserQuestion, Agent, TaskCreate, TaskUpdate, TaskList, Skill
---

# /orchestrator

Inicia o **Orquestrador Multiagentico de Desenvolvimento** a partir de um PRD ou especificacao ja pronta fornecida pelo usuario. O orquestrador **nao faz discovery nem planejamento**: ele ingere a especificacao como fonte da verdade e orquestra os subagentes. O workflow cobre:

0. Preflight, resolucao da configuracao de stack do projeto e instalacao assistida das dependencias ausentes
1. Project Memory comprovada + historico FTS5 + ingestao do PRD/especificacao
2. Classificacao das tasks com contrato, evidence plan, scope, complexidade e features
3. Ondas, routing adaptativo conservador e plano de worktrees
4. Contratos API/UI e programmatic validation para toda troca front-back
5. Delegacao paralela em worktrees elegiveis:
   - Back-end -> `codex:codex-rescue` com `--effort medium`
   - Front-end -> `cc-antigravity-plugin:antigravity-coder` com `--mode accept-edits --format stream-json --model <agyModel>`; quando `agyParallel: yes`, passa `--parallel`; quando `agySubagentModel` for diferente de `inherit`, passa tambem `--subagent-model`
6. Lifecycle Manager com probes, leases, heartbeat, stall/grace e reconciliacao
7. Integracao recuperavel e validacao deterministica de diff/escopo/wire/testes
8. Review back-end pos-implementacao (`codex:codex-rescue` com `--effort high`; somente back-end)
9. Review front-end pos-implementacao (`cc-antigravity-plugin:antigravity-agent` com `--read-only --format json --model pro-high --effort high` e `--timeout <agyTimeout>` quando solicitado; ignorar se nao houver front-end)
10. `report/workflow-log.md` + `report/subagents-context.md` + `report/implementation-report.md` + handoff
11. Entrega duravel ainda nao publicada
12. `learning/learning-report.md`, candidate lessons, history/telemetry, audit terminal e publicacao

Cada run mantem `.orchestration/<slug>/state.json` e `events.jsonl`; o projeto mantem `.orchestrator/project-memory.md`, `knowledge.db`, `history.db`, `telemetry.jsonl` e `learned/`. Toda transicao terminal e persistida antes de ser anunciada; uma task cujo resultado nao puder ser determinado apos interrupcao fica `UNKNOWN`, nunca `FAILED` por suposicao. Memoria aceita apenas fatos com fonte comprovada, e learning nunca edita a skill automaticamente.

## Regra central de execucao

Durante um workflow iniciado por `/orchestrator`, o Claude atua somente como orquestrador principal: mantem contexto, decide proximos passos, atualiza artefatos de coordenacao e delega implementacao para subagentes. Ele nao implementa codigo diretamente e nao reabre o entendimento da demanda — a especificacao fornecida pelo usuario e a fonte da verdade.

Atividades paralelas de implementacao devem usar subagentes. Para back-end, banco, testes, ajustes pontuais, handoffs e recuperacao de falha operacional, use `codex:codex-rescue` com `--effort medium`. O review back-end usa `codex:codex-rescue` com `--effort high`, sempre deixando o modelo no padrao disponivel na conta. O review front-end usa `cc-antigravity-plugin:antigravity-agent` com `--read-only --format json --model pro-high --effort high`. Codex nunca revisa front-end.

O roteamento de implementacao segue a categoria da task. Toda task `FRONTEND_ONLY` deve ser delegada ao `cc-antigravity-plugin:antigravity-coder`, inclusive setup Vite/React, rotas, tipos TypeScript, servicos API e componentes simples. `antigravity-agent` e **somente leitura** (analise, planejamento, review) e nunca deve receber tasks de implementacao — usar `antigravity-agent` para escrever codigo e um erro de roteamento. Codex so recebe front-end como fallback operacional registrado depois de falha/cota do AGY ou decisao explicita do usuario.

Tasks de front-end devem ser delegadas ao Antigravity/AGY por categoria, chamando o bridge do plugin com `--mode accept-edits --format stream-json --model <agyModel>`. O bridge consulta `agy models`, resolve aliases e encaminha `--model` nativamente, sem modificar configuracoes do usuario. `--agent` seleciona um agente customizado do AGY e nao substitui `antigravity-coder`/`antigravity-agent`.

Selecao de modelo AGY:

- se o usuario invocar `/orchestrator --agy-model <modelo> <demanda>`, preserve o override em todo o workflow;
- se nao houver override, determine o piso por dificuldade e consulte o router adaptativo:
  - padrao: `flash-medium`;
  - design system com julgamento visual: `flash-high`;
  - tasks front-end complexas, multi-rota, multi-arquivo, com contrato API/UI delicado ou alto risco de regressao: `pro-low`;
  - tasks criticas ou explicitamente pesadas: `pro-high`.
- O router so pode escalar com amostra historica comparavel suficiente (`taskType` + `complexity`), nunca reduz o piso e precisa registrar `agyModelEvidence`. Sem evidencia, use a heuristica.
- O review front-end (Fase 9) usa sempre `--read-only --format json --model pro-high --effort high`, independentemente do `agyModel` de implementacao.

Fan-out de subagentes AGY:

- `--agy-parallel`: quando presente em `$ARGUMENTS`, registre `agyParallel: yes` e `agyParallelSource: user` em todas as tasks AGY, independente de heuristica.
- `--agy-subagent-model <modelo>`: aceite alias ou slug dinamico seguro; registre `agySubagentModel: <modelo>` e ligue `agyParallel: yes` automaticamente (`--agy-subagent-model` implica `--agy-parallel`). Modelo sera passado como `--subagent-model <modelo>` ao bridge.
- Sem override de usuario, o orquestrador avalia por heuristica: tasks com dois ou mais entregaveis independentes recebem `agyParallel: yes` e `agyParallelSource: heuristic`.
- Default: `agySubagentModel: inherit` (omite `--subagent-model`; subagentes herdam `agyModel`).

Aliases de capacidade usados pela heuristica e pelo router adaptativo:

- `flash-low`
- `flash-medium`
- `flash-high`
- `pro-low`
- `pro-high`
- `auto`

Overrides do usuario tambem aceitam qualquer slug dinamico valido; o bridge 4.0 resolve o catalogo disponivel em runtime. Historico adaptativo e agregado pelo alias solicitado, nao pelo slug versionado resolvido.

Politica de cota:

- `QUOTA_EXHAUSTED` em implementacao, ajuste pontual ou handoff via Codex: marque `BLOCKED`, registre evidencia e peca decisao ao usuario.
- `QUOTA_EXHAUSTED` em review back-end Codex: faca fallback de review read-only pelo proprio orquestrador, sem editar codigo produtivo, e salve o resultado em `review/review-final.md`.
- `QUOTA_EXAUSTED`/`AUTH_REQUIRED`/`AGY_MISSING`/`TIMEOUT` em review front-end AGY: faca fallback de review read-only pelo proprio orquestrador, sem editar codigo produtivo, e salve o resultado em `review/review-frontend.md`.
- `QUOTA_EXAUSTED` no Antigravity/AGY em implementacao: registre o status cru, `reason`, modelo, `usage`, `conversation_id` e `retry`; prefira `--conversation <id>` e use `--continue` apenas sem ID. Nao retente automaticamente: aguarde a quota ser resolvida ou uma decisao explicita de fallback.
- `AUTH_REQUIRED` no Antigravity/AGY: marque bloqueio operacional e oriente o usuario a rodar `agy` interativamente uma vez.
- `AGY_MISSING` no Antigravity/AGY: marque bloqueio operacional e mostre a remediacao de instalacao.
- `TIMEOUT` no Antigravity/AGY: registre evidencia e decida entre aumentar timeout, reduzir escopo ou quebrar a task.

Politica de sandbox Codex:

- Rede externa bloqueada para pacote/restore, pacote ausente no cache local ou `UnauthorizedAccessException` fora do working directory permitido devem virar `BLOCKED`, com evidencia em `run/monitoring.md`, `report/workflow-log.md` e `report/subagents-context.md`.
- Nao tente contornar esses limites com retries longos, troca arbitraria de ferramenta ou escrita fora do escopo.
- Para UI sem dependencia de rede, mantenha Antigravity/AGY como rota primaria; Codex so assume front-end com fallback documentado e escrita permitida.

## Argumento

`$ARGUMENTS` - o PRD/especificacao a orquestrar, fornecido por mencao de arquivo (`@caminho/para/prd.md`), texto colado ou arquivo enviado. Opcionalmente pode comecar com um ou mais dos seguintes overrides (em qualquer ordem):

- `--agy-model <modelo>` — modelo AGY principal de implementacao
- `--agy-parallel` — forca fan-out de subagentes Gemini em todas as tasks AGY
- `--agy-subagent-model <modelo>` — modelo dos subagentes Gemini (implica `--agy-parallel`)
- `--agy-effort <low|medium|high>` — override de effort apenas para implementacao AGY; review permanece em `high`
- `--agy-timeout <duracao>` — timeout de silencio de todas as delegacoes AGY, por exemplo `300s` ou `5m`

Subcomandos reservados:

- `preflight` — valida apenas as dependencias;
- `project-config` — mostra e altera a stack de agentes do projeto (`.orchestrator/project-config.md`) e revalida o ambiente, sem iniciar run;
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
/goal Execute a skill cc-orchestrador-subagents:orchestrator-multi-agent-development para orquestrar a especificacao: <PRD/spec>. Condicao de conclusao: preflight e SQLite/FTS5 OK; Project Memory auditada; especificacao ingerida; tasks classificadas com evidence plan/scope e roteamento validado; worktrees/lifecycle encerrados ou bloqueios documentados; reviews e E2E aplicaveis executados; reports/handoff e learning/learning-report.md criados; Phase 12 concluida; history/telemetry projetados; audit.complete=true; run DONE e verify OK; so entao resultados e instrucoes publicados; ou pare preservando o estado sem presumir resultado.
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

O manager persiste o retorno redigido/limitado do executor em `run/executor-results/` antes de atualizar o state. Sem adapter ou status autoritativo, mantenha `UNKNOWN`; Git/arquivos/testes sao corroboracao, nao substitutos de ownership externo.

Nao redelegue task `UNKNOWN` ate confirmar que a sessao/conversation anterior nao segue ativa e avaliar mudancas parciais. Depois da reconciliacao, rode o preflight; se passar, carregue a skill e continue exatamente de `resumeFromPhase`/`currentWave`. Se o state engine retornar `RUN_NOT_FOUND`, informe o erro e encerre sem criar um run novo implicitamente.

Este ramo substitui a ingestao/inicializacao de uma run nova: nao interprete `resume` como PRD, nao execute `init` novamente e nao passe pela validacao de "PRD ausente" do Passo 3. Apos preflight + carregamento da skill, salte diretamente para a fase/wave devolvida pelo state engine.

Leia `references/persistent-state.md` por completo ao entrar neste modo.

### Modo preflight

Se `$ARGUMENTS` for exatamente `preflight`, rode apenas:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs"
```

Mostre o resumo do JSON ao usuario e encerre. O relatorio ja traz o bloco `projectConfig` com os quatro papeis efetivos e o `requiredCliSet` derivado; neste modo nao colete configuracao nem ofereca instalacao.

### Modo project-config

Se o primeiro argumento for `project-config`, este ramo substitui a execucao de PRD. Nao inicialize run, nao crie `.orchestration/<slug>/`, nao ingira PRD nem especificacao e nao delegue agentes. Leia `references/project-config.md` por completo ao entrar neste modo.

Etapa 1 - mostre a configuracao vigente e a origem (`file` = `.orchestrator/project-config.md`; `default` = padrao `codex`/`agy`/`codex`/`agy`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/orchestrator-multi-agent-development/scripts/project-config.mjs" show --root "."
```

`show` devolve `{ config, source, path, exists, requiredCliSet }`. `validate` e `required-clis` existem para checagem isolada e nunca gravam.

Etapa 2 - se `show` retornar `ok: false` com erro do parser (`PROJECT_CONFIG_FIELD_MISSING`, `PROJECT_CONFIG_INVALID_VALUE`, `PROJECT_CONFIG_SCHEMA_UNSUPPORTED`, `PROJECT_CONFIG_UNPARSEABLE`), apresente o erro nomeando campo, valor recebido, conjunto aceito e caminho, e ofereca por `AskUserQuestion` a regravacao do arquivo a partir de novas respostas. Nao sobrescreva o arquivo sem confirmacao explicita.

Etapa 3 - apresente as quatro perguntas de `AskUserQuestion` (`backendExecutor`, `frontendExecutor`, `frontendReviewer`, `backendReviewer`) com o texto, as descricoes de papel e a CLI exigida por opcao de `references/project-config.md`, marcando o **valor vigente** de cada papel como opcao default.

Etapa 4 - grave as respostas. Papel sem resposta entra em `--default-applied` e recebe o default da referencia; omita a flag quando todos os quatro papeis foram respondidos:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/orchestrator-multi-agent-development/scripts/project-config.mjs" write --root "." \
  --backend-executor "<codex|agy|claude-code>" \
  --frontend-executor "<codex|agy|claude-code>" \
  --backend-reviewer "<codex|agy|claude-code>" \
  --frontend-reviewer "<codex|agy|claude-code>" \
  --default-applied "<papel,papel>"
```

`write` grava `updatedAt` novo e devolve `changed` (papeis alterados) e `previous`. Nunca edite `.orchestrator/project-config.md` a mao: o renderer e a unica rota de gravacao.

Etapa 5 - rode o preflight uma vez, sempre, inclusive quando `changed` vier vazio:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs"
```

- `changed` vazio -> informe que nenhum papel mudou e apresente o resultado da revalidacao.
- `changed` com papeis -> apresente o novo `status`, o `projectConfig.requiredCliSet` e os itens de `failed` e `warnings`.

Etapa 6 - se o preflight reprovar uma CLI do Required_CLI_Set ou o plugin do Claude Code que a conecta (`openai-codex`/`cc-antigravity-plugin`), acione o Dependency_Installer para o item reprovado, com o mesmo protocolo do Passo 1.3: uma pergunta por dependencia, execucao somente apos `instalar`, tratamento de exit code diferente de zero e novo preflight ao final. Depois disso encerre o comando; nenhuma run e iniciada.

### Passo 1 - Preflight, configuracao do projeto e instalacao assistida

A Fase 0 tem quatro etapas, nesta ordem: preflight, resolucao da Project_Config, instalacao assistida e novo preflight. A ordem e obrigatoria — a coleta da configuracao vem antes de qualquer oferta de instalacao, porque o conjunto de CLIs obrigatorias depende dos papeis escolhidos. Numa run nova sem arquivo de configuracao isso produz ate tres preflights.

Leia `references/project-config.md` (perguntas, defaults, roteamento derivado, protocolo do Dependency_Installer) e `references/mcp-context.md` (protocolo do CBM_MCP e do Context7_MCP) antes de conduzir estas etapas.

#### Passo 1.1 - Preflight

Execute:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs"
```

Parse o JSON retornado:

- `status: "ok"` -> siga.
- `status: "failed"` -> cancele imediatamente e use `remediation`.

O relatorio traz:

- `projectConfig` — os quatro papeis efetivos, `path`, `updatedAt`, `requiredCliSet` e `source: "file" | "default"`;
- `warnings` no topo — reprovado opcional e MCP ausente, com `reason` `NOT_DETECTED`, `TIMEOUT` ou `NOT_REQUIRED_BY_PROJECT_CONFIG`;
- `checks.optional.mcp.codebase-memory` e `checks.optional.mcp.context7` — evidencias e comandos de instalacao dos dois MCPs;
- `failed` — apenas reprovado obrigatorio. MCP ausente e CLI nao exigida pela configuracao ficam em `warnings` e nao bloqueiam.

O JSON inclui `autoRemediation`. Se a permissao `Bash(node:*)` foi criada ou ajustada em `.claude/settings.json`, reporte isso ao usuario junto com o status final e diga se a correcao foi revalidada.

O preflight valida `cc-antigravity-plugin >= 4.0.0`, AGY `>= 1.1.8` (com recomendacao de `1.1.16`) e a presenca de `agents/antigravity-coder.md`, `agents/antigravity-agent.md`, `commands/antigravity.md` e `scripts/antigravity-bridge.js` — todos obrigatorios somente quando algum papel da Project_Config e `agy`. O mesmo vale para `cli.codex` e `plugins.openai-codex`, obrigatorios somente quando algum papel e `codex`.

Tambem exige Node.js `>=22.13.0`, `node:sqlite` sem flag experimental e SQLite FTS5. Essa checagem e bloqueante em qualquer configuracao de projeto, porque Project Memory, history, recipes e adaptive routing dependem dela.

#### Passo 1.2 - Resolucao da Project_Config

Decida pelo bloco `projectConfig` e pelo check `checks.config.project-config`:

- `source: "file"` -> a configuracao existe e e valida. Carregue-a e **nao repita as quatro perguntas**; va direto para o Passo 1.3.
- `source: "default"` com arquivo ausente -> apresente as quatro perguntas de `AskUserQuestion` (`backendExecutor`, `frontendExecutor`, `frontendReviewer`, `backendReviewer`) **antes de oferecer qualquer instalacao**, com as descricoes e a CLI exigida por opcao de `references/project-config.md`. Grave com `project-config write` (papel sem resposta vai em `--default-applied` e recebe o default) e rode o preflight novamente para obter o Required_CLI_Set efetivo.
- `checks.config.project-config.ok: false` -> o arquivo existe e e invalido. Pare com o erro do parser e a remediacao de corrigir ou remover `.orchestrator/project-config.md`, preservando o conteudo atual. Nao sobrescreva o arquivo dentro de uma run.

Registre em `report/workflow-log.md` a configuracao efetiva, a origem e os papeis com `default-aplicado`. `frontendReviewer: codex` sobrepoe a politica padrao de review front-end pelo AGY: registre a sobreposicao e avise o usuario uma unica vez por run.

#### Passo 1.3 - Instalacao assistida

Com a Project_Config resolvida, monte a lista de dependencias ausentes: CBM_MCP ausente, Context7_MCP ausente e, para cada CLI do Required_CLI_Set, a propria CLI (quando `checks.cli.*` reprova) e o plugin do Claude Code que a conecta (quando `checks.plugins.*` reprova) — `openai-codex` para `codex`, `cc-antigravity-plugin` para `agy` (MCPs primeiro, depois CLI+plugin por CLI). CLI e plugin sao reprovacoes independentes: CLI instalada nao implica plugin instalado, e vice-versa. Use `scripts/lib/dependency-plan.mjs` (`buildMissingDependencies(report, { platform })`) como catalogo de comandos por SO em vez de reescrever comandos no prompt.

- Uma pergunta `AskUserQuestion` **por dependencia**, com as opcoes `instalar` e `seguir sem instalar`, informando nome, beneficio, impacto de seguir sem ela e o comando que sera executado.
- Execute comando de instalacao somente depois de o usuario responder `instalar` para aquela dependencia. Nunca agrupe dependencias numa pergunta so.
- Passos interativos ficam com o usuario: `codex login` depois da CLI `codex`, primeira execucao de `agy` para autenticar o AGY, e reinicio do agente de codigo para carregar um MCP recem-instalado.
- Exit code diferente de zero -> registre o codigo de saida e a ultima linha de erro, apresente a remediacao manual e peca decisao ao usuario antes de prosseguir. Sem loop de retry.
- `seguir sem instalar` em dependencia opcional (MCP) -> registre a limitacao em `report/workflow-log.md` e siga pelo caminho deterministico de `references/mcp-context.md`.
- `seguir sem instalar` em CLI do Required_CLI_Set -> ofereca por `AskUserQuestion` trocar o papel afetado para `claude-code` (regravando a configuracao e rodando o preflight de novo) ou encerrar o workflow. Nunca troque o papel por conta propria.
- Registre por dependencia apenas `name`, `decision`, `command`, `exitCode` e `durationMs` (`summarizeInstallOutcome`). Nada de stdout bruto, conteudo de arquivo de configuracao, chave de API ou cabecalho de autenticacao.

#### Passo 1.4 - Novo preflight

Concluidos todos os comandos confirmados, rode o preflight uma vez e apresente ao usuario o novo `status`, o Required_CLI_Set efetivo, os itens reprovados e os avisos. Esse preflight e obrigatorio mesmo que toda instalacao tenha retornado zero — e ele que confirma que a dependencia ficou visivel para o ambiente.

Com `checks.optional.mcp.codebase-memory.ok: true`, o protocolo de grafo de `references/mcp-context.md` passa a valer (gate de `index_status` antes de usar qualquer resultado como evidencia). Com `checks.optional.mcp.context7.ok: true`, avise o usuario que documentacao atual sera exigida nos prompts dos subagentes.

### Passo 2 - Carregar a skill

`Skill(skill="cc-orchestrador-subagents:orchestrator-multi-agent-development")`.

### Passo 3 - Validacoes leves antes da ingestao

Antes dessas validacoes, parseie as flags de override no inicio de `$ARGUMENTS` (em qualquer ordem):

- `--agy-model <modelo>`: valide e registre `agyModelSource: user`.
- `--agy-parallel`: registre `agyParallelSource: user` para todas as tasks AGY.
- `--agy-subagent-model <modelo>`: aceite alias ou slug dinamico seguro, registre `agySubagentModel: <modelo>`, ligue `agyParallel: yes` automaticamente.
- `--agy-effort <low|medium|high>`: valide e registre `agyEffort` nas tasks AGY de implementacao; nao reduza o effort `high` do review.
- `--agy-timeout <duracao>`: valide e registre `agyTimeout` em toda delegacao AGY.

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

Depois de gerar `plan/tasks-classification.md` e `plan/waves.md`, rode `node "${CLAUDE_PLUGIN_ROOT}/skills/orchestrator-multi-agent-development/scripts/validate-routing.mjs" ".orchestration/<nome>"` ou o caminho equivalente via `${CLAUDE_SKILL_DIR}`. Se falhar, corrija os artefatos antes de delegar.

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

As tasks `FRONTEND_ONLY` e a fatia front-end de `FULLSTACK` devem registrar `agyModel` e `agyModelSource: user|heuristic|adaptive` em `plan/tasks-classification.md` e `plan/waves.md`; `adaptive` sem `agyModelEvidence` e invalido.

Antes de iniciar cada fase e antes de lancar ou redelegar subagentes, faca um gate operacional:

- Se a mensagem mais recente do usuario indicar cancelamento, pausa, reprovacao do plano/contrato ou problema bloqueante, interrompa imediatamente.
- Nao invoque novos subagentes, nao edite implementacao e nao avance de fase.
- Atualize `run/monitoring.md`, `report/workflow-log.md` e `report/subagents-context.md` com `CANCELLED` ou `PAUSED` quando ja houver artefatos.

### Passo 5 - Reportar updates

Mantenha o usuario informado com mensagens curtas:

- `preflight OK`
- se houve auto-correcao: `preflight auto-remediou Bash(node:*) em .claude/settings.json e revalidou`
- `stack do projeto: back-end <executor>, front-end <executor>, review back-end <revisor>, review front-end <revisor> (origem: file|default)`
- se houve instalacao: `instalei <N> dependencias confirmadas e rodei o preflight de novo: status <ok|failed>`
- `Context7 MCP detectado; vou exigir docs atuais nos prompts dos subagentes`
- `Codebase Memory MCP detectado; vou consultar index_status antes de usar o grafo como evidencia`
- `Project Memory auditada; carreguei apenas fatos validados e projetei o historico pesquisavel`
- `especificacao ingerida; classificando tasks em .orchestration/<nome>`
- `wave <N>: <X> tasks isoladas em worktrees e <Y> serializadas por overlap/escopo`
- `lancei <N> subagentes em paralelo para a onda <N>, aviso quando completarem`
- no fim: caminhos do `report/workflow-log.md`, `report/implementation-report.md`, `report/subagents-context.md` e `learning/learning-report.md` + resumo e instrucoes de negocio
- no fim: confirme `audit.complete: true`, Phase 12, history/telemetry projetados, `runId` terminal e `verify` aprovado

## Quando o usuario invocar sem argumento

Se `$ARGUMENTS` estiver vazio, use `AskUserQuestion` para pedir o PRD/especificacao a orquestrar.

## Quando nao usar

Se a demanda for troca de texto, cor, padding, typo, import order ou ajuste de 1-2 linhas, ofereca execucao direta sem orquestracao.
