# Estado persistente, lifecycle e resume

Este documento é o contrato operacional de `state.json`, `events.jsonl`, completion gates, cancelamento e `/orchestrator resume`.

## Arquivos e fontes de verdade

Cada `.orchestration/<slug>/` contém:

```text
state.json                 snapshot materializado
events.jsonl               fonte append-only da run
lifecycle-probe.json       último conjunto normalizado de probes
executor-results/          respostas externas persistidas antes do consumo
evidence/                  resultados determinísticos vinculáveis às tasks
learning-report.md         saída obrigatória da Fase 12
```

`events.jsonl` é a fonte reconstruível da run. `state.json` é uma projeção otimizada para leitura. Nunca edite nenhum dos dois manualmente.

## O que versionar

O orquestrador escreve dois diretórios no projeto do usuário: `.orchestration/` (por run) e `.orchestrator/` (por projeto). Eles não têm o mesmo destino no Git, e tratar todos igual causa problema real — banco SQLite em WAL gera conflito binário a cada commit, e um `git clean -fdx` durante uma wave destrói worktrees em execução.

| Caminho | Git | Por quê |
|---|---|---|
| `.orchestration/<slug>/events.jsonl` | **versionar** | fonte de verdade da run; permite `resume` e auditoria em outra máquina |
| `.orchestration/<slug>/*.md`, `handoff.json`, `contracts/` | **versionar** | artefatos de decisão e entrega |
| `.orchestration/<slug>/state.json` | opcional | projeção de `events.jsonl`; reconstruível por replay |
| `.orchestration/<slug>/executor-results/`, `evidence/`, `screenshots/` | opcional | saída bruta redigida; versionar só se a auditoria exigir |
| `.orchestrator/project-memory.md` | **versionar** | fatos validados que entram no contexto inicial |
| `.orchestrator/learned/` | **versionar** | recipes curadas; conhecimento deliberado, não derivado |
| `.orchestrator/knowledge.db` | **versionar com cuidado** | fonte das lessons/recipes; binário, faça commit com a run parada |
| `.orchestrator/history.db`, `telemetry.jsonl` | **ignorar** | projeções reconstruíveis (`history-project --rebuild`, `telemetry project`) |
| `.orchestrator/worktrees/` | **ignorar sempre** | worktrees Git ativas; versionar ou limpar quebra a wave em execução |
| `.orchestrator/backups/` | **ignorar** | backups locais do Curator; o rollback é operação local |
| `*.db-wal`, `*.db-shm` | **ignorar sempre** | arquivos transitórios do SQLite em WAL |

Sugestão de `.gitignore` do projeto:

```gitignore
.orchestrator/worktrees/
.orchestrator/backups/
.orchestrator/history.db
.orchestrator/telemetry.jsonl
*.db-wal
*.db-shm
```

Se o projeto preferir não versionar nada do orquestrador, ignore `.orchestration/` e `.orchestrator/` por inteiro e aceite a consequência explícita: `resume`, memória de projeto e histórico passam a ser locais àquela máquina.

## Invariantes

1. O evento é sincronizado em disco antes da troca atômica do snapshot.
2. Resultado de executor é persistido antes de alterar estado ou responder ao usuário.
3. Perda de ownership produz `UNKNOWN`; nunca presume `FAILED` ou `DONE`.
4. `DONE` exige evidência local: arquivo esperado/produzido, validação passando, delta de commit ou evidence ID durável.
5. Run terminal (`DONE`/`CANCELLED`) é imutável e seu `runId` não pode ser reutilizado.
6. Task removida da classificação continua bloqueando o fechamento até `scope REMOVE|REINSTATE` explícito.
7. A run não fecha pela agregação das tasks. `run DONE` exige tasks, Fase 12, artefatos e completion gates.
8. Stall mede ausência de progresso, não duração total.

Esses invariantes adaptam os padrões de persist-before-delivery, ownership indeterminado e progress-aware timeout estudados no Hermes. A rastreabilidade das fontes está em `hermes-adaptation.md`.

## Estados

Tasks usam apenas:

```text
PENDING RUNNING DONE FAILED BLOCKED STALLED CANCELLED UNKNOWN
```

Runs usam:

```text
PENDING RUNNING DONE FAILED BLOCKED STALLED CANCELLED UNKNOWN
```

Sinais operacionais permanecem em `reasonCode`, preservando a grafia recebida (`QUOTA_EXHAUSTED`, `QUOTA_EXAUSTED`, `AUTH_REQUIRED`, `AGY_MISSING`, `TIMEOUT`, `NEEDS_SYNC`).

## Contrato mínimo de task

Toda task classificada precisa declarar:

- `category`, `complexity`, executor/modelo quando aplicável;
- `expectedFiles` ou `validationPlan` (evidence plan minimo);
- `allowedPaths` para escopo/worktree;
- `contractRequired` e `contractIds` quando houver troca front-back.

O estado também preserva `attemptHistory`, `sessionId`/`conversationId`, commits, evidências, lease e workspace. Recuperação de `STALLED`/`UNKNOWN` para uma sessão ainda viva mantém a tentativa; retry confirmado abre uma tentativa nova.

## Completion gates

Os gates persistidos são:

| Gate | Fase | Regra |
|---|---:|---|
| `backendReview` | 8 | obrigatório quando existe back-end |
| `frontendReview` | 9 | obrigatório quando existe front-end |
| `browserE2E` | 9.5 | obrigatório sempre que existe front-end; `N/A` é a única waiver de aplicabilidade e exige motivo explícito |
| `reports` | 10 | sempre obrigatório |
| `handoff` | 10 | sempre obrigatório |
| `delivery` | 11 | sempre obrigatório |
| `learning` | 12 | sempre obrigatório |

`DONE` exige evidence ID/arquivo. Um gate não obrigatório pode ser `N/A` somente com motivo.

A aplicabilidade derivada por categoria responde apenas "existe front-end?". Um run só de front-end (SPA consumindo API separada já existente) é exatamente o caso da Fase 9.5 e mantém o gate `PENDING`. Quando front/back não usam origens separadas, registre a decisão arquitetural de forma explícita: `gate --gate browserE2E --status N/A --required false --reason "<topologia comprovada>"`. A topologia é julgamento do orquestrador e precisa ficar no motivo — nunca é inferida silenciosamente da mistura de categorias. Nenhum outro gate obrigatório aceita override.

## CLI do State Engine

```bash
STATE="${CLAUDE_SKILL_DIR}/scripts/orchestration-state.mjs"

node "$STATE" init --slug <slug> --dir .orchestration/<slug> --phase 1
node "$STATE" sync --dir .orchestration/<slug>
node "$STATE" phase --dir .orchestration/<slug> --phase 5 --status RUNNING
node "$STATE" task --dir .orchestration/<slug> --task BE-01 --status RUNNING \
  --executor codex --session-id <id>
node "$STATE" heartbeat --dir .orchestration/<slug> --task BE-01 \
  --api-calls 7 --tool-calls 13 --current-tool Edit --in-tool true
node "$STATE" gate --dir .orchestration/<slug> --gate backendReview \
  --status DONE --evidence file:review-final.md
node "$STATE" audit --dir .orchestration/<slug>
node "$STATE" verify --dir .orchestration/<slug>
node "$STATE" run --dir .orchestration/<slug> --status DONE
```

Outros comandos: `scope`, `lease`, `workspace`, `sweep`, `reconcile`, `resume`, `cancel`, `status`.

## Resume e corrupção

`/orchestrator resume` seleciona a run ativa mais recente. `/orchestrator resume <runId>` seleciona exatamente a identidade pedida.

Ordem obrigatória:

1. localizar a run; a run mais recente corrompida retorna `RUN_CORRUPT` e nunca causa fallback silencioso;
2. adquirir lock, reparar tail incompleto e reproduzir eventos;
3. converter ownership interrompido de `RUNNING` para `UNKNOWN`;
4. persistir probes normalizados de Codex/AGY;
5. reconciliar executor, Git, arquivos e validações;
6. recuperar worktrees e leases;
7. reconstruir `currentWave` e `resumeFromPhase` pela sequência explícita `1..9, 9.5, 10..12`;
8. continuar somente após uma decisão comprovada.

O adapter desconhecido retorna `UNKNOWN`. `executorStatus=DONE` sem corroboração local retorna `UNKNOWN/COLLECT_LOCAL_EVIDENCE`.

## Heartbeat, lease e stall

Defaults:

- ocioso fora de tool: `450s`;
- dentro de tool: `1200s`;
- grace period: `120s`;
- lease: `900s`, renovada somente com atividade observável.

Use o lifecycle manager para polling contínuo e controle real quando houver adapter:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/orchestration-lifecycle.mjs" watch \
  --dir .orchestration/<slug> --adapter-config .orchestrator/executor-control.json \
  --interval-seconds 30
```

Sem adapter estável, o orquestrador executa a ação pela integração instalada, persiste seu retorno e usa `--external-confirmed`; nunca marca interrupt/dispatch apenas por intenção.

## Cancelamento

Cancelamento é protocolo, não atribuição direta:

1. `cancel --reason` impede novos dispatches;
2. tasks ativas viram `UNKNOWN` e recebem pedido de interrupção;
3. cada executor é consultado/reconciliado;
4. somente quando todas as tasks forem terminais a run pode virar `CANCELLED`.

```bash
node "${CLAUDE_SKILL_DIR}/scripts/orchestration-lifecycle.mjs" cancel \
  --dir .orchestration/<slug> --reason "pedido do usuário" \
  --adapter-config .orchestrator/executor-control.json --finalize
```

## Integridade final

`audit` recusa conclusão quando faltar task, resolução de escopo, evidence, gate, Fase 12 ou qualquer artefato obrigatório (`workflow-log.md`, `subagents-context.md`, `implementation-report.md`, `handoff.json`, `learning-report.md`). `verify` compara snapshot e replay byte-semanticamente. Ambos precisam passar antes de `run DONE`.
