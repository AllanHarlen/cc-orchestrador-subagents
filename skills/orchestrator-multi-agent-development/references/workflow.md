# Workflow detalhado por fase

Este arquivo expande as fases do `SKILL.md`.

## Layout do diretorio da run

Toda run nova grava os artefatos agrupados por estagio (`state.layoutVersion: 2`). Os caminhos citados nas fases abaixo sao relativos a `.orchestration/<nome>/`:

```text
state.json                  events.jsonl                (raiz: identidade da run)
plan/                       tasks-classification.md, waves.md
contracts/                  um arquivo por contrato
run/                        monitoring.md, lifecycle-probe.json, executor-results/, prompts/
review/                     review-final.md, review-frontend.md, e2e-verification.md, screenshots/
report/                     implementation-report.md, workflow-log.md, subagents-context.md, handoff.json
evidence/                   saida dos scripts de intelligence
learning/                   learning-report.md
```

`state.json` e `events.jsonl` nunca saem da raiz da run, e o diretorio da run e sempre filho direto de `.orchestration/`: e assim que `resume` e a numeracao de `runId` encontram a run. Runs criadas antes desta versao permanecem no layout plano e continuam legiveis sem migracao. Detalhes e regras de resolucao em `references/persistent-state.md`.

O orquestrador atua somente em projetos com PRD/especificacao ja pronta, em desenvolvimento complexo. Ele nao faz discovery, nao cria plano OpenSpec e nao reabre o entendimento da demanda. Todos os artefatos de coordenacao ficam em `.orchestration/<nome>/`, onde `<nome>` e um identificador descritivo em kebab-case: em **modo conjunto** e o `<slug>` do Pensador (sem `-vN`); em **modo independente** e derivado do PRD. Ver `references/handoff-contract.md`.

## Checkpoint transversal e resume

Toda fase e toda task sao transicoes da state machine descrita em `persistent-state.md`. O orquestrador grava primeiro em `events.jsonl` e somente depois publica a mudanca; `state.json` e um snapshot reparavel, nao uma segunda fonte manual.

Antes de iniciar uma fase, execute `orchestration-state.mjs phase --status RUNNING`. Ao concluir, persista `DONE`; em bloqueio/interrupcao, persista o estado correspondente antes de parar. Um crash entre fases retoma da proxima entrada segura da sequencia explicita (`... 9, 9.5, 10, 11, 12`). Um crash com executor ativo transforma `RUNNING` em `UNKNOWN` ate a reconciliacao provar o resultado.

`/orchestrator resume [runId]` segue o protocolo completo de `persistent-state.md`: replay, reconciliacao conservadora, probes de Codex/AGY, reconstrucao da wave e continuacao da ultima fase segura. Quando existir adapter, rode `orchestration-lifecycle.mjs tick --resume`; o resultado bruto e persistido antes da transicao. Resume nunca e atalho para redelegar trabalho cujo resultado ainda pode chegar.

## Fase 0 - Preflight

Rode:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/preflight.mjs" --check-agent-mcp
```

Regras:

- se `status=failed`, cancele;
- `autoRemediation` existe para registrar se `.claude/settings.json` foi criado ou atualizado para adicionar `Bash(node:*)`;
- a auto-remediacao so vale para `codex-companion-bash`;
- se `.claude/settings.json` existir com JSON invalido, nao sobrescreva; falhe com remediacao clara.

## Fase 1 - Ingestao da especificacao

A especificacao chega por **duas vias** (ver `references/handoff-contract.md`). Antes de tratar a demanda como avulsa, detecte o modo.

### 1.K Inicializar conhecimento comprovado do projeto

Antes da classificacao, inicialize e audite a memoria pequena do projeto e atualize a projecao pesquisavel das runs anteriores:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/orchestrator-knowledge.mjs" init
node "${CLAUDE_SKILL_DIR}/scripts/inspect-project.mjs" --root "." --persist-knowledge
node "${CLAUDE_SKILL_DIR}/scripts/orchestrator-knowledge.mjs" audit
node "${CLAUDE_SKILL_DIR}/scripts/orchestrator-knowledge.mjs" history-project
```

Leia `.orchestrator/project-memory.md` junto da especificacao. Somente fatos `VALIDATED` com fonte `FILE`, `CONTRACT`, `TEST` aprovado, `RUN_EVENT` ou `USER` entram nessa projecao. Se `audit` marcar `STALE`/`CONFLICT`, exclua o fato da classificacao ate nova validacao. Busque `history-search` apenas por fingerprints, stacks ou problemas relevantes e mantenha o resultado condensado.

Na primeira run do projeto, confira se o `.gitignore` ja cobre os caminhos que nunca devem ser versionados (`.orchestrator/worktrees/`, `.orchestrator/backups/`, `.orchestrator/history.db`, `.orchestrator/telemetry.jsonl`, `*.db-wal`, `*.db-shm`). Se nao cobrir, proponha o bloco ao usuario antes de seguir — worktree versionada ou removida por `git clean` quebra a wave em execucao, e SQLite em WAL gera conflito binario. A tabela por caminho esta em `persistent-state.md`; nao altere o `.gitignore` do usuario sem aprovacao.

### 1.0 Detectar modo de operacao (conjunto vs independente)

1. Procure `.pensador/*/handoff.json`.
2. **Modo conjunto (Pensador → Orchestrador):** se houver um handoff `stage: pensador` com `status: DONE`:
   - Para multiplos `slug`, confirme via `AskUserQuestion` qual demanda implementar.
   - Para o mesmo `slug` com varias versoes `-vN`, use a maior versao (confirme se houver duvida).
   - Leia o `report/handoff.json` e trate os artefatos referenciados como fonte da verdade. Correlacione pelo `slug` e grave seus artefatos em `.orchestration/<slug>/` (sem `-vN`).
   - `status: BLOCKED`/`PARTIAL` no upstream: pare e peca decisao ao usuario.
   - Sem `handoff.json` mas com `.pensador/<slug>-vN/`: fallback por convencao — leia `.pensador-progress.json` (`checkpointVersion: 2`) e o array `artifacts`; avise o usuario.
3. **Modo independente:** sem `.pensador/`, o usuario fornece a especificacao via `@arquivo` ou texto no `/orquestrador`. `<nome>`/`<slug>` derivam do PRD.

Assim que o slug estiver resolvido, crie `.orchestration/<slug>/` e inicialize o estado **antes** de ler/produzir novos artefatos dessa execucao:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/orchestration-state.mjs" init \
  --slug "<slug>" --dir ".orchestration/<slug>" --phase 1
```

### 1.1 Ler a especificacao fornecida

- Em modo conjunto, ingira os artefatos do Pensador na ordem do handoff contract (secao 7):
  - **Modo PRD:** `prd` → `userhistory` → `architecture` → `api-contract` → `communication-contract` → `design-system`/`design-system-files`.
  - **Modo Spec (OpenSpec):** confirme o estado via `openspec status --change <nome> --json` (ou `openspec show <nome> --json`) antes de ler os arquivos; ingira o change set em `openspec/changes/<nome>/` (`proposal.md`, `design.md`, `tasks.md`, `specs/` quando presente — omitido sob `skip_specs`, podendo estar aninhado em `specs/<area>/<capability>/spec.md`); derive as tasks de `tasks.md` preservando IDs/ordem (contando subtarefas aninhadas).
- Em modo independente, leia o arquivo de PRD/spec apontado pelo usuario com `Read`. Se o usuario apontar varios arquivos ou um diretorio de specs, leia todos os relevantes.
- Nao reescreva, nao replaneje e nao reinterprete a demanda. O papel do orquestrador e **orquestrar**, nao planejar.
- **Contrato de API:** quando houver `api-contract` (maquina-legivel), ele e a **fonte da verdade** dos contratos da Fase 4 — suba o mock a partir dele e valide o codigo contra ele (campo `validation`). O `communication-contract` e apenas a visao legivel.
- **Design (Open Design):** quando houver `design-system-files`, guarde os caminhos verbatim e o `materializeInto` de cada `<id>` para materializar na Fase 4 (ver Fase 4).

### 1.2 Extrair os entregaveis e tasks

A partir da especificacao, extraia diretamente:

- objetivos e entregaveis ja definidos;
- tasks, fases ou ordem de implementacao quando o PRD ja as trouxer;
- decisoes tecnicas firmes (arquitetura, bibliotecas, endpoints, telas, contratos, migrations);
- restricoes de escopo, agente, tecnologia ou arquivo;
- criterios de aceite (`CA`) e validacoes obrigatorias — usados depois nos gates de review (Fases 8/9), nao para gerar uma suite de testes.

Quando o PRD ja lista tasks, preserve IDs, nomes e ordem para rastreabilidade. Quando o PRD descreve entregaveis sem IDs formais, derive uma lista de tasks objetiva a partir do texto, sem inventar escopo novo.

**Extraia o escopo completo, nao um subconjunto.** A lista de tasks desta fase deve cobrir tudo que a especificacao implica — nao apenas uma "primeira onda", "fundacao" ou MVP que o orquestrador julgue razoavel para uma unica execucao. A decisao de escopo ja foi tomada rio acima: no **modo conjunto** (integracao Pensador → Orquestrador), o Pensador ja conduziu a entrevista de descoberta com o usuario e o `report/handoff.json`/PRD/spec resultante ja reflete o escopo acordado; no **modo independente**, o proprio usuario definiu o escopo ao escrever ou fornecer o PRD/spec. Em nenhum dos dois casos cabe ao orquestrador redecidir o tamanho do trabalho — ver 1.3a abaixo.

### 1.3 Lacunas bloqueantes

Se a especificacao tiver uma lacuna que impeca classificar e delegar com seguranca (ex.: contrato de dados ausente entre front e back, decisao tecnica obrigatoria nao tomada), use `AskUserQuestion` para resolver apenas a lacuna bloqueante. Nao transforme isso em discovery aberto — pergunte o minimo necessario para destravar a orquestracao e registre a resposta.

### 1.3a Execucao continua ate a conclusao integral

Depois de extrair a lista completa de tasks (1.2), monte as ondas necessarias (Fase 3) e execute-as **sequencialmente ate a ultima**, sem pausar entre ondas para perguntar ao usuario se deve continuar. Isso vale mesmo quando a especificacao gerar tasks suficientes para varias ondas com dependencias fortes entre blocos (ex.: um PRD de produto inteiro com multiplos dominios funcionais): o orquestrador planeja o breakdown completo em `plan/tasks-classification.md`/`plan/waves.md` e delega onda apos onda ate esgotar o escopo, sem checkpoint de "posso continuar?" no meio do caminho.

As unicas pausas legitimas em qualquer ponto da execucao sao por bloqueio real, ja cobertas em outras secoes deste documento:

- lacuna bloqueante da Fase 1.3 (informacao que falta para classificar/delegar com seguranca);
- bloqueio de sandbox ou de quota (Codex/AGY — secoes "Politica de sandbox Codex" e "Politica de quota");
- reprovacao em review (Fase 8/9), que aciona o loop de correcao da Fase 7 antes de seguir adiante.

Reducao de escopo (implementar menos do que a especificacao pede) so e aceitavel quando o **proprio usuario** pedir isso explicitamente na mensagem que invocou o orquestrador — nunca por iniciativa do orquestrador, e nunca comunicada apenas no relatorio final depois do fato consumado.

Ao final da Fase 1, o orquestrador deve conseguir produzir `plan/tasks-classification.md` a partir da especificacao ingerida mais fatos comprovados da Project Memory, cobrindo o escopo integral, e seguir sem pausa ate a Fase 12 e o fechamento terminal.

## Fase 2 - Classificacao das tasks

Para cada task extraida do PRD/spec, registre em `.orchestration/<nome>/plan/tasks-classification.md`:

- categoria;
- dependencias;
- arquivos criticos;
- complexidade;
- `contractRequired: yes|no`;
- `assignedAgent`;
- `executor` e `executorSource: project-config` — o Executor derivado da categoria pela Project_Config vigente (`codex`, `agy` ou `claude-code`), ver abaixo;
- `routingReason`;
- `expectedFiles` e/ou `validationPlan` (ao menos um e obrigatorio para reconciliacao);
- `allowedPaths` para validar escopo e decidir isolamento;
- `complexity`, `contractIds` e features de routing;
- para AGY, `agyModel`, `agyModelSource` e, quando adaptativo, `agyModelEvidence`.

### Regra de roteamento por categoria

O Executor de cada task vem da categoria combinada com a Project_Config (`references/project-config.md`), nao de "parece infra" ou preferencia do orquestrador. Registre `executor` e `executorSource: project-config` por task em `plan/tasks-classification.md` e `plan/waves.md`; `validate-routing.mjs` reprova task cujo `executor` divirja do derivado para a categoria ou esteja fora de `codex`/`agy`/`claude-code`. Setup de projeto front-end, rotas, servicos API em TypeScript, componentes, paginas, hooks, estado e UX continuam sendo `FRONTEND_ONLY` e recebem o `frontendExecutor` configurado.

| Categoria | Papel da Project_Config | Execucao sob os defaults (`codex`/`agy`) |
|---|---|---|
| `BACKEND_ONLY` | `backendExecutor` | Codex via `codex-companion.mjs task --effort medium --write` (chamada direta; fallback `codex:codex-rescue`) |
| `DATABASE_ONLY` | `backendExecutor` | Codex via `codex-companion.mjs task --effort medium --write` (chamada direta; fallback `codex:codex-rescue`) |
| `REVIEW_ONLY` | `backendReviewer` | Codex via `codex-companion.mjs task --effort high` **sem `--write`** (chamada direta; fallback `codex:codex-rescue`) |
| `FRONTEND_ONLY` | `frontendExecutor` | AGY (`cc-antigravity-plugin:antigravity-coder`) com `--mode accept-edits --format stream-json --model <agyModel>` |
| `FULLSTACK` | `backendExecutor` + `frontendExecutor` | Codex para back-end; AGY com `--mode accept-edits --format stream-json --model <agyModel>` para front-end |

Quando o papel resolvido e `claude-code`, o `executor` da task e `claude-code`: delegue pela ferramenta `Agent` a um subagente do proprio Claude Code (implementacao) ou rode a task em modo read-only gravando em `review/review-final.md`/`review/review-frontend.md` (review). Uma task com `executor: claude-code` nunca registra `agyModel`, `agyModelSource`, `agyParallel` nem `agySubagentModel` — o validador reprova o bloco se algum desses campos aparecer. Artefato legado sem o campo `executor` continua validado pela heuristica antiga de mencao de agente (`assignedAgent`).

Se `FRONTEND_ONLY` aparecer com Codex como Executor fora do fallback abaixo, corrija antes de montar waves. Codex so pode assumir front-end depois de `QUOTA_EXAUSTED`, `AUTH_REQUIRED`, `AGY_MISSING`, `TIMEOUT`, falha operacional de AGY ou decisao explicita do usuario, e isso deve ficar registrado em `run/monitoring.md`, `report/workflow-log.md` e `report/subagents-context.md`.

**`antigravity-agent` e somente leitura.** Se `FRONTEND_ONLY` (ou a fatia front-end de `FULLSTACK`) aparecer com `assignedAgent: cc-antigravity-plugin:antigravity-agent`, isso e um erro de roteamento — corrija para `cc-antigravity-plugin:antigravity-coder` antes de montar waves. `antigravity-agent` so e valido como `assignedAgent` nas tasks de review (Fase 9), nunca em tasks que criam/editam arquivos.

### Regra de `agyParallel`

Para tasks `FRONTEND_ONLY` ou fatia front-end de `FULLSTACK`, avalie se ha dois ou mais entregaveis independentes nos criterios de aceite. Se sim, prefira **uma** task com `agyParallel: yes` em vez de N tasks AGY separadas. Registre em `plan/tasks-classification.md`:

- `agyParallel: yes|no`
- `agyParallelSource: user|heuristic` (quando `yes`)
- `agySubagentModel: <modelo>|inherit`

Condicoes para `agyParallel: yes`: entregaveis listados nos criterios de aceite sao independentes, nenhum toca arquivo central compartilhado, contrato nao esta pendente, schema nao esta mudando.

### Regra de `contractRequired`

Marque `yes` sempre que houver troca de dados front-back, mesmo que uma task esteja classificada como `BACKEND_ONLY` e outra como `FRONTEND_ONLY`.

Exemplos:

- endpoint novo consumido por tela -> `yes`;
- mudanca de payload, filtros, paginacao, validacao ou erro -> `yes`;
- ajuste puramente visual sem tocar API -> `no`.

## Fase 3 - Ondas

Agrupe tasks em `.orchestration/<nome>/plan/waves.md`.

Cada entrada de `plan/waves.md` deve repetir `assignedAgent` vindo de `plan/tasks-classification.md`. Depois de montar as waves, rode:

1. Para cada task AGY sem override do usuario, chame `orchestration-router.mjs route` com `taskType`, `complexity`, piso heuristico, criticidade, design e historico de attempts. O router exige amostra comparavel e nunca reduz o piso. Se retornar `source: adaptive`, registre `agyModelEvidence`; se retornar fallback, mantenha `source: heuristic`.
2. Valide o roteamento:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/validate-routing.mjs" ".orchestration/<nome>"
```

Se o validador falhar, corrija `plan/tasks-classification.md` e `plan/waves.md` antes de qualquer delegacao.

Quando o validador passar, sincronize os artefatos com o snapshot. O parser aceita IDs como `T1`, `BE-01` e `FE-01`; tasks removidas do Markdown nao sao apagadas silenciosamente do historico.

```bash
node "${CLAUDE_SKILL_DIR}/scripts/orchestration-state.mjs" sync \
  --dir ".orchestration/<nome>"
```

Em seguida, planeje isolamento fisico usando `allowedPaths`:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/orchestration-worktree.mjs" plan \
  --dir ".orchestration/<nome>" --wave <N>
```

`ISOLATED` pode executar em worktree paralela; `SERIAL` (overlap) e `UNSCOPED` nao podem compartilhar a mesma execucao concorrente. O plano e persistido antes de qualquer mutacao Git. Leia `worktrees-routing.md`.

Nao paralelize quando houver:

- contrato pendente;
- schema indefinido;
- arquivo central compartilhado;
- autenticacao ou seguranca sem consolidacao.

Se uma operacao de descoberta/comparacao exigir loops ou tres ou mais reads/greps, rode o script de intelligence correspondente em vez de expandir todos os arquivos no contexto.

## Fase 4 - Contratos API/UI e materializacao de design

### 4.0 Materializar arquivos de design (Open Design)

Quando a ingestao trouxe `design-system-files` (ou um `design-system.md` com diretorio verbatim):

- Copie os arquivos verbatim de cada `<id>` (`.pensador/<slug>-vN/design-systems/<id>/`) para o alvo real indicado em `materializeInto` (ex.: `packages/ui/design-systems/<id>/`, ou `src/styles/…` em app unico). Ver `references/handoff-contract.md` secao 6.
- Nao reescreva `tokens.css`, `DESIGN.md`, `components.html` nem `preview/`: eles sao consumidos verbatim.
- Guarde os caminhos materializados para carregar no prompt de **toda task front-end** (Fase 5) e para o gate de design da Fase 9.
- No modo Spec, o design chega em `design.md` + `specs/ui-design-system/spec.md`: use-os como requisito normativo do gate.

### 4.1 Contratos

Crie `.orchestration/<nome>/contracts/*.md` para:

- toda task `FULLSTACK`;
- todo par dependente `BACKEND_ONLY` + `FRONTEND_ONLY` que troque dados entre si.

Valide cada contrato e o conjunto API/UI de forma deterministica:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/inspect-contract.mjs" --root "." --path ".orchestration/<nome>/contracts/<id>.md" --persist-knowledge
node "${CLAUDE_SKILL_DIR}/scripts/inspect-api-ui.mjs" --root "." --backend <path> --frontend <path>
node "${CLAUDE_SKILL_DIR}/scripts/validate-wire-format.mjs" --root "." --contract <path> --payload <path>
```

Todo contrato deve conter:

- endpoint e metodo;
- wire format;
- casing JSON esperado;
- exemplos completos de request/response;
- status codes;
- estados de UI;
- permissoes;
- validacoes;
- comprovacao de serializacao real contra TypeScript.

### Regra especial para C# e TypeScript

Quando houver DTO C# e consumidor TypeScript:

- explicite se o DTO interno esta em `PascalCase`;
- explicite se o JSON exposto deve sair em `camelCase`;
- documente serializer global ou atributos por campo;
- nao aceite "bate com a interface" sem verificar o payload real.

## Fase 5 - Delegacao paralela

Antes de lancar subagentes, confirme que `validate-routing.mjs` passou e que o plano de worktrees da wave nao possui overlap sendo despachado em paralelo. A delegacao precisa seguir `assignedAgent` dos artefatos validados.

Para cada task `ISOLATED`, crie a worktree antes do dispatch e use o path retornado como working directory do executor:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/orchestration-worktree.mjs" create \
  --dir ".orchestration/<nome>" --task <ID>
```

Adquira uma lease com owner estavel antes do dispatch; o Lifecycle Manager a renova quando observa atividade e a libera apos terminal/reconciliacao. Nunca aponte dois executores para a mesma workspace/lease.

Para cada dispatch, persista a task como `RUNNING` **antes** de iniciar o executor. Inclua `executor`, `sessionId` do Agent/Codex ou `conversationId` do AGY assim que cada identificador existir. O engine captura `commitBefore` e incrementa `attempt` somente numa nova tentativa. Se o agendamento falhar antes do executor iniciar, registre `FAILED` com `reasonCode: DISPATCH_FAILED`; nao deixe a task eternamente `RUNNING`.

Quando o executor retornar, converta sinais de quota/auth/tooling para `BLOCKED` + `reasonCode`, ou persista `DONE`/`FAILED`, **antes** de anunciar o retorno na conversa ou avancar a wave.

### Prompt efetivo como artefato da run

Antes de cada dispatch (Codex ou AGY), monte o corpo do prompt seguindo o template de
`subagent-prompts.md` com os placeholders preenchidos, e **persista-o em arquivo antes de
delegar** — nunca so em memoria, nunca so em argv:

- `.orchestration/<slug>/run/prompts/<taskId>.md` para implementacao/handoff/ajuste;
- `.orchestration/<slug>/run/prompts/<taskId>-review.md` para review (Fases 8/9).

Isso alimenta dois pontos que antes nao existiam: o prompt que de fato chegou na CLI vira algo
auditavel depois (nao so o retorno do subagente, que e o unico rastro hoje), e a medicao do
orcamento abaixo passa a medir o arquivo real, nao uma estimativa mental.

Para AGY, ao invocar o `antigravity-coder`/`antigravity-agent`, passe tambem
`--dump-prompt ".orchestration/<slug>/run/prompts/<taskId>.agy.txt"` (ver `subagent-prompts.md`
Secao 2) — o bridge grava o prompt final **da run real** (pos fallback de overflow, nao um dry run)
e um sidecar `<path>.audit.json` com `{ promptChars, limit, degraded, droppedFiles, included,
skipped }`. Preencha os campos "Prompt enviado" e "Contexto degradado" de
`assets/subagents-context-template.md` a partir desse sidecar.

**Quando `degraded: true`** (o bridge descartou arquivos inline por causa do limite de 28.000 chars
no Windows), a task **nao conta como executada com contexto completo** — registre em
`run/monitoring.md` a lista de arquivos descartados (`skipped` com `reason:
"prompt-overflow-windows"`) e decida entre redespachar com `--priority-files` apontando para os
arquivos que ficaram de fora, ou dividir a task por entregaveis (ver abaixo). Hoje essa degradacao
so aparecia como um aviso em stderr que ninguem le; a partir daqui e um fato registrado na run.

### Regra de limite de prompt AGY (28.000 chars)

Antes de delegar, meca o arquivo persistido (nao conte manualmente):

```bash
node "${CLAUDE_SKILL_DIR}/scripts/check-prompt-budget.mjs" --agent agy \
  --file ".orchestration/<slug>/run/prompts/<taskId>.md"
```

**Threshold:** 28.000 chars. Prompts reais com aspas, barras invertidas, XML e quebras de linha inflariam ~14% na linha de comando codificada pelo Node.js no Windows, causando `ENAMETOOLONG`. O threshold conservador garante margem segura. Para AGY isso e limite duro: `ok: false` sai com exit 1 e o chamador deve tratar a falha antes de despachar.

**Para Codex, a mesma checagem (`--agent codex`) e apenas indicativa** (`advisory: true`, nunca
falha, exit 0 mesmo acima do limite) — a chamada direta ao companion usa `--prompt-file`
(`codex-companion.mjs`), que nao passa pelo limite de argv do Windows. Um prompt muito acima do
limite ainda pode indicar contexto mal recortado; considere dividir por entregaveis mesmo sem erro.

Se o prompt montado **exceder 28.000 chars**:

1. Identifique os entregaveis listados nos criterios de aceite da task original.
2. Divida os entregaveis em dois grupos independentes (A e B), priorizando que cada grupo seja coeso e nao dependa do outro para executar.
3. Crie duas subtasks derivadas da original:
   - **Task `<ID>-a`**: herda todos os metadados da task original (categoria, agente, contrato, stack, escopo); `Descricao` e criterios de aceite cobrem apenas o Grupo A.
   - **Task `<ID>-b`**: mesmo metadados; `Descricao` e criterios de aceite cobrem apenas o Grupo B.
4. Atualize `plan/tasks-classification.md` e `plan/waves.md` substituindo a task original pelas duas subtasks; mantenha a mesma wave se forem independentes.
5. Remonte os dois prompts e confirme que cada um esta abaixo de 28.000 chars. Se ainda exceder, repita a divisao.
6. Registre a divisao em `run/monitoring.md` e `report/workflow-log.md` com:
   - task original e motivo (prompt excedeu N chars);
   - subtasks geradas e criterios de aceite de cada uma.

**Quando a task nao pode ser dividida por entregaveis** (descricao monolitica indivisivel):

- Reduza `Arquivos e modulos relevantes` ao minimo critico para esta task; mova arquivos secundarios para `Fora do escopo`.
- Substitua listagens mecanicas extensas por um resumo deterministico de `scripts/intelligence` e referencias de path confinadas ao workspace; nao reduza o modelo, pois isso nao altera o limite da linha de comando e pode violar o piso de fidelidade.
- Se persistir, registre `promptOverflow: true` em `plan/tasks-classification.md` e peca decisao ao usuario antes de delegar.

Para Codex:

- implementacao, handoff e ajuste -> `--effort medium`;
- review -> `--effort high`;
- nao fixe `--model`.
- antes de executar instalacao/restore de pacotes, verifique se a task depende de rede externa ou de cache local; se falhar por rede bloqueada ou pacote ausente, pare como `BLOCKED`.
- se houver erro de permissao ao escrever fora do working directory permitido, pare como `BLOCKED` e reporte o caminho alvo.

Para Antigravity/AGY (implementacao):

- delegue ao `cc-antigravity-plugin:antigravity-coder` (unico subagente AGY com permissao de escrita; `antigravity-agent` e somente leitura e nao deve receber tasks de implementacao);
- passe `--mode accept-edits --format stream-json --model <agyModel>` para o bridge do plugin;
- inclua `--effort <agyEffort>` e `--timeout <agyTimeout>` somente quando os overrides publicos correspondentes existirem;
- registre `agyModelSource: user|heuristic|adaptive`; a opcao `adaptive` exige `agyModelEvidence` completo;
- quando `agyParallel: yes`, passe tambem `--parallel` ao bridge; quando `agySubagentModel` for diferente de `inherit`, passe `--subagent-model <agySubagentModel>` (implica `--parallel`);
- por padrao (`agySubagentModel: inherit`), omita `--subagent-model`; os subagentes herdam o modelo da sessao AGY principal;
- `--agy-subagent-model` informado pelo usuario liga `--parallel` automaticamente;
- o bridge consulta `agy models`, resolve aliases e encaminha `--model` nativamente; nao leia nem altere `settings.json` do usuario;
- eventos NDJSON `init`, `step_update` e `result` que chegarem ao adapter renovam heartbeat somente com atividade observavel; persista apenas contadores e metadados seguros.

Cada prompt deve incluir:

- descricao da task;
- contrato quando `contractRequired=yes`;
- escopo permitido;
- wire format;
- regra de validar casing JSON e serializacao;
- `sectorContext` (setor/industria do negocio, do PRD/`design-system.md` do Pensador) — orienta que imagery/iconografia fazem sentido para o produto real.

### Imagery/icones (`IMAGE_SUGGESTIONS`)

Todo prompt de task front-end usa o template da Secao 2 de `subagent-prompts.md`, que instrui o `antigravity-coder` a devolver um bloco `IMAGE_SUGGESTIONS` quando identificar oportunidades de imagem (hero, banners, ilustracoes de empty/error state, icones de produto/servico) — o `antigravity-coder` **nunca gera sem aprovacao previa**. Quando esse bloco vier preenchido na resposta, siga o fluxo da Secao 2a de `subagent-prompts.md` **antes de fechar a task**: apresente as opcoes ao usuario via `AskUserQuestion` (multiSelect), delegue apenas as aprovadas de volta ao `antigravity-coder` com `--generate-image`, confirme que o arquivo gerado foi fiado no componente, e registre o resultado em `report/subagents-context.md`. Nao marcar a task front-end como `DONE` com sugestoes de imagem pendentes de decisao do usuario.

### Verificacao de skills compativeis

Todo subagente em background deve, como **primeiro passo antes de implementar**, listar as skills disponiveis no ambiente e filtrar as compativeis com sua task:

1. execute `/skills` ou equivalente para listar as skills do ambiente;
2. ignore skills exclusivas do orquestrador (planejamento/coordenacao);
3. das skills restantes, identifique quais se aplicam a task em execucao;
4. use as skills compativeis durante a implementacao;
5. registre no retorno quais skills foram utilizadas (campo obrigatorio no retorno de Codex e Gemini).

O orquestrador consolida as skills utilizadas por subagente em `report/subagents-context.md`.

## Fase 6 - Monitoramento

Estados canonicos persistidos:

- `PENDING`
- `RUNNING`
- `DONE`
- `FAILED`
- `BLOCKED`
- `STALLED`
- `CANCELLED`
- `UNKNOWN`

`PAUSED` descreve o run/interacao, nao uma conclusao de task. `NEEDS_SYNC`, `QUOTA_EXAUSTED`, `QUOTA_EXHAUSTED`, `AUTH_REQUIRED`, `AGY_MISSING`, `TIMEOUT` e `REVIEWED` permanecem sinais operacionais em `reasonCode`/evidencia; nao criam estados concorrentes fora da state machine.

### Heartbeat e stall

Atualize heartbeat apenas quando houver progresso observavel (novo retorno/token, API call, tool call ou mudanca de `currentTool`). Poll sem mudanca nao renova `lastActivityAt`.

```bash
node "${CLAUDE_SKILL_DIR}/scripts/orchestration-state.mjs" heartbeat \
  --dir ".orchestration/<nome>" --task <ID> \
  --api-calls <N> --tool-calls <N> --current-tool <tool> --in-tool <true|false>

node "${CLAUDE_SKILL_DIR}/scripts/orchestration-state.mjs" sweep \
  --dir ".orchestration/<nome>"
```

Defaults: 450s sem progresso fora de tool, 1200s dentro de tool e 120s de grace period. `STALLED` recomenda interrupcao + reconciliacao; nao significa `FAILED` e nao autoriza retry imediato. Heartbeat real durante a grace period pode reativar `STALLED -> RUNNING`.

Prefira o manager continuo ao polling manual quando houver adapter configurado:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/orchestration-lifecycle.mjs" watch \
  --dir ".orchestration/<nome>" \
  --adapter-config ".orchestrator/executor-control.json" \
  --interval-seconds 30
```

O adapter recebe apenas placeholders allowlisted e roda sem shell. Cada probe bruto redigido e limitado e salvo em `run/executor-results/` antes de atualizar task, heartbeat, lease, history e telemetry. Para AGY, preserve `conversationId`, modelo resolvido, `usage`, duracao, turnos e a diretiva de retry validada. `interrupt`, `retry` e `cancel` exigem adapter ou `--external-confirmed`; nunca simule sucesso da acao externa. Retry confirmado usa exatamente `--conversation <id>` quando houver ID e `--continue` apenas quando nao houver. Veja `lifecycle-telemetry.md` e `assets/executor-control-config.schema.json`.

### Politica de quota

- `QUOTA_EXHAUSTED` no Antigravity/AGY:
  - registre evidencia, `conversationId`, modelo resolvido, uso e retry seguro;
  - nao retente automaticamente enquanto a quota continuar indisponivel;
  - se o fallback for seguro, redelegue para Codex com `--effort medium`;
  - se mudar muito a natureza da entrega, peca confirmacao do usuario.

- `AUTH_REQUIRED` no Antigravity/AGY:
  - marque `BLOCKED`;
  - registre evidencia;
  - oriente o usuario a rodar `agy` interativamente uma vez.

- `AGY_MISSING` no Antigravity/AGY:
  - marque `BLOCKED`;
  - registre evidencia;
  - publique os passos de instalacao.

- `TIMEOUT` no Antigravity/AGY:
  - registre evidencia;
  - aumente timeout, reduza escopo ou quebre a task antes de insistir.

- `QUOTA_EXHAUSTED` no Codex durante implementacao, ajuste pontual ou handoff:
  - nao tente trocar modelo fixo;
  - marque `BLOCKED`;
  - registre evidencia;
  - peca decisao ao usuario.

- `QUOTA_EXHAUSTED` no Codex durante review back-end:
  - faca review interno read-only no orquestrador;
  - salve o resultado em `review/review-final.md`;
  - nao edite codigo produtivo.

### Politica de sandbox Codex

- `NU1301`, falha ao acessar registry externo, restore sem rede ou pacote ausente do cache local:
  - marque `BLOCKED`;
  - registre comando, erro e pacote necessario;
  - peca decisao do usuario antes de alterar plano ou dependencia.

- `UnauthorizedAccessException` ou erro equivalente ao escrever fora do working directory permitido:
  - marque `BLOCKED`;
  - registre working directory efetivo e caminho que falhou;
  - peca decisao do usuario para ajustar o diretorio permitido, mover a execucao para a raiz correta ou redefinir o escopo.

- Para UI sem dependencia de rede, mantenha AGY como executor primario. So faca handoff para Codex se o bloqueio AGY estiver documentado e o sandbox Codex permitir a escrita necessaria.

## Fase 7 - Integracao

Para cada worktree isolada concluida, marque `ready` (commit recuperavel) e integre serialmente na branch de integracao. O root produtivo deve estar limpo fora dos metadados do orquestrador. Em conflito, persista `CONFLICT` e pare; nao aborte, escolha lado ou limpe a worktree silenciosamente.

```bash
node "${CLAUDE_SKILL_DIR}/scripts/orchestration-worktree.mjs" ready --dir ".orchestration/<nome>" --task <ID>
node "${CLAUDE_SKILL_DIR}/scripts/orchestration-worktree.mjs" integrate --dir ".orchestration/<nome>" --task <ID>
```

Valide:

- aderencia a especificacao (PRD/spec) ingerida;
- aderencia ao contrato;
- wire format;
- casing JSON;
- serializacao real;
- arquivos alterados fora do escopo;
- build (compilacao/typecheck/lint) sem erros.

Use programmatic intelligence para a parte mecanica e persista os evidence IDs na task/gate:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/inspect-diff.mjs" --root "." --dir ".orchestration/<nome>" --task <ID> --base <commitBefore>
node "${CLAUDE_SKILL_DIR}/scripts/validate-task-scope.mjs" --root "." --dir ".orchestration/<nome>" --task <ID>
node "${CLAUDE_SKILL_DIR}/scripts/collect-test-results.mjs" --root "." --input <resultado> --dir ".orchestration/<nome>" --task <ID> --persist-knowledge --command "<comando>"
```

Depois de cada outcome/review, projete a telemetria metadata-only; chamadas repetidas sao idempotentes por event ID:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/orchestration-telemetry.mjs" project --dir ".orchestration/<nome>"
```

Nao gere projeto de testes automatizados como parte da integracao. A validacao de que cada requisito (`RF`/`CA`) foi implementado corretamente e responsabilidade do review de codigo (Fases 8 e 9), nao de uma suite de testes.

**Monte a matriz de rastreabilidade RF/CA → evidência aqui, nao no relatorio final.** Percorra cada `RF`/`CA` do escopo da especificacao e registre, em `report/implementation-report.md` secao 13, a task que o implementou e o arquivo/trecho de evidencia. Um `RF` sem entrega correspondente (ou com `// TODO`/placeholder/stub no caminho do requisito) e uma lacuna que precisa ser **sinalizada agora** — nao silenciosamente absorvida como "lacuna conhecida" no relatorio final sem passar pelo gate de review. Essa matriz alimenta diretamente as Fases 8 e 9.

Se precisar ajuste, delegue para Codex com `--effort medium` (back-end) ou AGY (front-end), conforme a categoria.

## Fase 8 - Review back-end pos-implementacao (Codex)

> **Ignorar quando nao houver back-end:** Se nao houver nenhuma task `BACKEND_ONLY`, `DATABASE_ONLY` nem fatia back-end de `FULLSTACK`, pule a Fase 8 e registre `review/review-final.md` com a nota `"Sem back-end: review back-end nao aplicavel"`.

Objetivo da fase: validar a implementacao **back-end** final contra a especificacao, os contratos, as tasks executadas e os retornos dos subagentes. Esta fase e read-only: nao edite codigo durante o review. Codex revisa **apenas back-end** — nunca front-end. Se houver defeitos, volte para a Fase 7 para integrar ajustes ou redelegar correcao.

### 8.1 Preparar pacote de review

Antes de delegar ao Codex ou fazer review interno, monte um pacote de contexto com:

- especificacao original (PRD/spec) ingerida na Fase 1;
- `plan/tasks-classification.md`, `plan/waves.md` e contratos em `contracts/*.md`;
- `run/monitoring.md`, `report/workflow-log.md` e `report/subagents-context.md`;
- resumo dos arquivos back-end alterados;
- comandos de build e validacoes executadas no back-end;
- falhas, bloqueios, fallbacks e decisoes do usuario durante a execucao.

### 8.2 Fluxo principal

- delegue ao Codex com `--effort high`;
- informe que o review e somente leitura e restrito ao back-end (controllers, services, repositorios, DTOs, migrations, contratos do lado servidor);
- exija achados com severidade, arquivo/trecho quando aplicavel, impacto e correcao esperada;
- salve o resultado em `review/review-final.md`.

O prompt do review back-end deve pedir verificacao explicita de:

- aderencia a especificacao e ao escopo back-end;
- **cada criterio de aceite (`CA`) das tasks back-end validado por inspecao direta do codigo** — a validacao do requisito e responsabilidade deste review, nao de uma suite de testes gerada;
- contratos API, wire format, status codes, casing JSON e serializacao real no lado servidor;
- auth/autorizacao, validacoes e tratamento de erro no back-end;
- migrations, persistencia, indices e integridade referencial quando houver banco;
- build back-end sem erros;
- arquivos alterados fora do escopo;
- regressao potencial em fluxos existentes do back-end.

### 8.3 Fluxo de fallback

- se o review Codex vier com `QUOTA_EXHAUSTED`, o orquestrador faz review interno read-only do back-end;
- registre no proprio `review/review-final.md` que o review foi fallback interno do orquestrador por indisponibilidade de quota do Codex;
- mantenha as mesmas secoes obrigatorias do fluxo principal.

### 8.4 Resultado e loop de correcao

`review/review-final.md` deve terminar com uma decisao:

- `APROVADO`: pode seguir para a Fase 9;
- `APROVADO_COM_RESSALVAS`: pode seguir somente se as ressalvas forem documentadas como nao bloqueantes;
- `REPROVADO`: nao avance; volte para a Fase 7 ou redelegue ajustes ao Codex.

**`REPROVADO` obrigatorio quando:** um `RF`/`CA` do escopo back-end nao tem evidencia na matriz de rastreabilidade (secao 13 do `report/implementation-report.md`), ou o caminho de codigo desse requisito contem `// TODO`, `NotImplementedException`, stub vazio ou placeholder equivalente. Isso vale mesmo que o build passe e nenhum outro achado de severidade tenha sido levantado — requisito nao implementado nao e "ressalva nao bloqueante", e reprovacao.

## Fase 9 - Review front-end pos-implementacao (AGY)

> **Ignorar quando nao houver front-end:** Se nao houver nenhuma task `FRONTEND_ONLY` nem fatia front-end de `FULLSTACK`, pule a Fase 9 e registre `review/review-frontend.md` com a nota `"Sem front-end: review front-end nao aplicavel"`. Se nao existir `review/review-frontend.md`, basta registrar a ausencia em `report/workflow-log.md`.

Objetivo da fase: validar a implementacao **front-end** final. O review e feito pelo **AGY** com `--read-only --format json --model pro-high --effort high`. Codex nunca participa desta fase.

### 9.1 Preparar pacote de review

Monte um pacote de contexto com:

- especificacao original (PRD/spec) ingerida na Fase 1;
- `plan/tasks-classification.md`, `plan/waves.md` e contratos em `contracts/*.md`;
- `report/subagents-context.md` das tasks front-end;
- resumo dos arquivos front-end alterados;
- comandos de build/typecheck/lint executados no front-end.

### 9.2 Fluxo principal

- delegue ao `cc-antigravity-plugin:antigravity-agent` com `--read-only --format json --model pro-high --effort high` e inclua `--timeout <agyTimeout>` quando o usuario o definiu;
- informe que o review e somente leitura — o AGY nao modifica arquivos;
- exija achados com severidade, arquivo/trecho quando aplicavel, impacto e correcao esperada;
- salve o resultado em `review/review-frontend.md`.

O prompt do review front-end deve pedir verificacao explicita de:

- aderencia a especificacao e ao escopo front-end;
- **cada criterio de aceite (`CA`) das tasks front-end validado por inspecao direta do codigo/comportamento** — nao delegue essa validacao a uma suite de testes; o revisor confirma o requisito olhando a implementacao (e, quando aplicavel, a Fase 9.5 exercitando o fluxo num navegador real);
- consumo correto do contrato API/UI: wire format, casing JSON e serializacao real contra o TypeScript consumidor;
- estados de UI tratados (loading, erro, empty, sucesso);
- tipagem TypeScript, build, typecheck e lint;
- acessibilidade e consistencia visual quando aplicavel;
- arquivos alterados fora do escopo;
- regressao potencial em telas/fluxos existentes.

### 9.3 Fluxo de fallback

- se o review AGY vier com `QUOTA_EXAUSTED`, `AUTH_REQUIRED`, `AGY_MISSING` ou `TIMEOUT`, o orquestrador faz review interno read-only do front-end;
- registre em `review/review-frontend.md` que o review foi fallback interno do orquestrador por indisponibilidade do AGY, com o status cru retornado pelo bridge;
- mantenha as mesmas secoes obrigatorias do fluxo principal.

### 9.4 Resultado e loop de correcao

`review/review-frontend.md` deve terminar com uma decisao:

- `APROVADO`: pode seguir para a Fase 10;
- `APROVADO_COM_RESSALVAS`: pode seguir somente se as ressalvas forem documentadas como nao bloqueantes;
- `REPROVADO`: nao avance; volte para a Fase 7 e redelegue a correcao ao AGY.

**`REPROVADO` obrigatorio quando:** um `RF`/`CA` do escopo front-end nao tem evidencia na matriz de rastreabilidade (secao 13 do `report/implementation-report.md`), ou o componente correspondente contem `// TODO`, texto placeholder fixo (ex.: copy em ingles genérico onde o requisito pede conteudo real do tenant/dominio) ou estado vazio nao implementado. Isso vale mesmo que o build/typecheck/lint passem — requisito nao implementado nao e "ressalva nao bloqueante", e reprovacao.

Se houver achados bloqueantes em qualquer das fases de review (8 ou 9):

1. registre os achados em `run/monitoring.md` e `report/workflow-log.md`;
2. crie ou atualize tasks de correcao com agente responsavel pela categoria;
3. execute a correcao pela Fase 7;
4. repita o review focando nas areas alteradas e nos achados anteriores.

## Fase 9.5 - Verificacao E2E no navegador real (OBRIGATORIA para front separado do back)

> **Por que esta fase existe.** Review de codigo, `dotnet build`, `npm run build`, `tsc` e `curl` sao **cegos** a uma classe inteira de defeitos de integracao runtime. Em um caso real, tres rodadas de review deram "APROVADO" e a vitrine publica inteira estava quebrada no navegador — porque nenhum review tinha aberto um browser de verdade. Ver a regra 17 do `SKILL.md` para os tres defeitos concretos (CORS ausente, tenant nao resolvido a partir do browser, casing de resposta divergente que falha silenciosamente com 200).

**Quando roda:** sempre que houver task `FRONTEND_ONLY` ou fatia front-end de `FULLSTACK` **e** o front-end for servido como deploy/origem separada do back-end (SPA/Next.js/etc. chamando uma API em outra porta/host). Quando nao ha front-end, ou o front e server-rendered sem chamadas cross-origin, registre "N/A" e siga.

**Como conduzir (o orquestrador faz diretamente, read-only sobre a app rodando):**

1. **Suba a app de verdade** (ex.: `docker compose up --build`) e confirme os servicos saudaveis. Se subir a stack falhar, isso ja e um achado bloqueante — nao existe "APROVADO" para uma app que nao sobe.
2. **Credenciais de seed/demo para fluxos autenticados.** Antes de tentar logar, confira se o PRD/spec documenta credenciais conhecidas de seed (ver seção "Observabilidade & Operação" do PRD). Se documentadas, use-as para exercitar os `UC-*` que exigem login. Se o ambiente tem seed/demo mas **nenhuma credencial documentada** (ex.: senha só como hash sem plaintext registrado), isso e uma lacuna real: registre-a explicitamente em `review/e2e-verification.md`, e prefira resolvê-la (redefinir a senha do seed para um valor conhecido e documentá-lo, com uma correção pela Fase 7) a simplesmente pular os fluxos autenticados. Só marque os fluxos autenticados como não verificados se resolver a credencial estiver fora do escopo da correção.
3. **Dirija os fluxos de usuario criticos** (os `UC-*`/caminhos-felizes da especificacao, **incluindo os que exigem login** quando a credencial estiver disponível) num navegador real via **Playwright MCP** (ou ferramenta equivalente): navegue, preencha formularios, clique, submeta.
4. **Em cada fluxo, verifique:**
   - console e network **sem erros de CORS** nem `net::ERR_FAILED`;
   - cada requisicao de API retorna 2xx **e a UI reflete o dado real** — desconfie de "200 mas a tela ficou vazia/inalterada", que e o sintoma classico de casing divergente ou campo `undefined`;
   - o **efeito final** de cada acao aconteceu de fato (o redirect abriu a aba/rota, o item entrou no carrinho, o registro apareceu na lista, o estado mudou) — nao apenas que a chamada retornou;
   - resolucao **multi-tenant / por host** funciona a partir do browser (o front informa o tenant certo ao back);
   - estados de tela (vazio/carregando/erro/sucesso) se comportam como especificado.
5. **Capture evidencia**: screenshot e/ou o resumo de console+network dos fluxos exercitados, salvos em `.orchestration/<slug>/review/e2e-verification.md` (e screenshots em `.orchestration/<slug>/review/screenshots/`).

**Achados desta fase sao BLOQUEANTES** como qualquer review: registre em `run/monitoring.md`/`report/workflow-log.md`, crie tasks de correcao, corrija pela Fase 7 e **re-verifique no navegador** antes de aprovar. So depois que os fluxos criticos passarem no navegador o orquestrador pode marcar a entrega como `DONE`. Se a ferramenta de navegador nao estiver disponivel no ambiente, **nao invente aprovacao**: registre a limitacao e marque o `report/handoff.json` como `PARTIAL` com o gap explicito ("verificacao E2E no navegador nao executada").

## Fases 10, 11 e 12 - Relatorio, entrega duravel e learning

Entregaveis obrigatorios (salve na **raiz de execucao do agente**, `.orchestration/<slug>/`):

- `report/workflow-log.md`
- `report/subagents-context.md`
- `report/implementation-report.md`
- `report/handoff.json` — manifesto de handoff do estagio orchestrador (ver `references/handoff-contract.md`)
- `learning/learning-report.md` — candidatos comprovados extraidos na Fase 12; nenhuma promocao automatica
- `state.json` + `events.jsonl` — estado/auditoria da execucao (nao entram no vocabulario de artefatos do handoff)

### Gravar `report/handoff.json` (para o Executor)

Ao fechar, grave `.orchestration/<slug>/report/handoff.json` com:

- `handoffVersion: 1`, `stage: "orchestrador"`, `slug` (sem `-vN`), `producer` (plugin + version), `artifactRoot: ".orchestration/<slug>"`, `status` (`DONE`/`PARTIAL`/`BLOCKED`), `summary`, timestamps.
- `upstream`: em modo conjunto, aponta o `handoff.json` do Pensador (`.pensador/<slug>-vN/handoff.json`); em modo independente, `null`.
- `artifacts[]`: uma entrada por role do vocabulario Orchestrador (secao 5 do handoff contract) — `implementation-report`, `tasks-classification`, `waves`, `api-contracts`, `review-final`, `review-frontend`, `monitoring`, `workflow-log`, `subagents-context` (+ `openspec-change` quando aplicavel), com `path` relativo ao `artifactRoot`.
- `nextStage`: `consumer: "cc-executor-subagents"`, `entrypoint: "/executor"`, `instructions` orientando review plano-vs-entrega e ajustes finos.

O relatorio final deve citar:

- se houve auto-remediacao no preflight;
- quais contratos foram criados;
- quais validacoes de wire format e serializacao foram feitas;
- se houve fallback de review interno (back-end por `QUOTA_EXHAUSTED` no Codex; front-end por indisponibilidade do AGY);
- para cada delegacao AGY com `agyParallel: yes`: numero de subagentes Gemini nativos e Conversation IDs reportados pelo AGY;
- contagem de tokens por agente, nos tres lugares previstos pelos templates: tabela consolidada em `report/implementation-report.md` secao "11a. Uso de tokens por agente", detalhe por agente/papel em `report/subagents-context.md` secao "Uso de Tokens por Agente" (alem do campo `Tokens usados` de cada bloco de subagente), e o total da execucao em `report/workflow-log.md` secao 1. As duas tabelas devem fechar no mesmo total. Quando houver fan-out, os tokens reportados pelo AGY sao o agregado da sessao — nao some os subagentes Gemini por fora. Dado nao reportado pelo agente ou nao exposto pela plataforma e `N/A`, nunca `0`.

Na Fase 10, finalize reports/handoff e marque os gates `reports`/`handoff` com evidence IDs de arquivo. Na Fase 11, prepare a mensagem e instrucoes de negocio em artefato duravel, marque `delivery` e conclua a fase, mas **nao publique sucesso ainda**.

Na Fase 12, extraia somente candidates suportados pelo event log/reviews:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/orchestration-learning.mjs" run \
  --dir ".orchestration/<slug>"

node "${CLAUDE_SKILL_DIR}/scripts/orchestrator-knowledge.mjs" history-project \
  --dir ".orchestration/<slug>"

node "${CLAUDE_SKILL_DIR}/scripts/orchestration-telemetry.mjs" project \
  --dir ".orchestration/<slug>"

node "${CLAUDE_SKILL_DIR}/scripts/orchestration-state.mjs" audit \
  --dir ".orchestration/<slug>"

node "${CLAUDE_SKILL_DIR}/scripts/orchestration-state.mjs" run \
  --dir ".orchestration/<slug>" --status DONE

node "${CLAUDE_SKILL_DIR}/scripts/orchestration-state.mjs" verify \
  --dir ".orchestration/<slug>"
```

`audit.complete` precisa ser `true`; falha de gate/integridade bloqueia a entrega. Nao corrija `revision`/`lastEventId` manualmente; reproduza o event log ou restaure um backup coerente. O `report/handoff.json` so pode usar `DONE` quando as tasks obrigatorias estiverem `DONE`, cada task tiver evidence plan e os gates aplicaveis tiverem passado com evidencia; `UNKNOWN`, `STALLED` ou `BLOCKED` pendente exige `PARTIAL`/`BLOCKED` com resumo explicito. Um gate `waivable` (hoje so `browserE2E`) marcado `N/A` via `--required false` aparece em `audit.waivedGates` e por si so ja forca `audit.complete: false` — dispensar a verificacao com motivo documentado nao e o mesmo que ela ter passado; o handoff sai `PARTIAL`, nunca `DONE`, ate o usuario decidir disponibilizar a ferramenta, aceitar formalmente a limitacao (registrando isso fora do gate) ou reverter a dispensa. Projete history/telemetry novamente depois do evento `RUN_STATUS_UPDATED(DONE)` para capturar o terminal e so entao publique a mensagem preparada na Fase 11.

### Contagem de tokens

Cada subagente deve incluir no retorno:

```
Tokens usados: input=<N> output=<N> cache_read=<N> total=<N>
```

O orquestrador coleta esses valores, preenche as tabelas de tokens nos tres entregaveis finais e calcula o total consolidado de toda a execucao. Use `N/A` quando o agente nao reportar ou a plataforma nao expuser o dado.
