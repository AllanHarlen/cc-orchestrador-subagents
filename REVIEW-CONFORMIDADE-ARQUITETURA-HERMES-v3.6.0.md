# Review de conformidade — Arquitetura inspirada no Hermes × v3.6.0

**Projeto:** `cc-orchestrador-subagents`  
**Versão analisada:** `3.6.0`  
**Data:** 2026-08-17  
**Referência:** proposta de evolução em 11 itens, iniciando por State Engine + `/orchestrator resume`  
**Veredito do primeiro marco:** **PARCIALMENTE CONFORME — CHANGES REQUESTED**  
**Veredito da arquitetura completa:** **INCOMPLETA POR DESENHO**; os itens posteriores foram explicitamente adiados.

## 1. Conclusão executiva

A implementação atual não tentou entregar os 11 itens de uma vez. Ela concentrou a v3.6.0 no primeiro marco e aproveitou parte do item 5:

- State Engine persistente;
- `state.json` e `events.jsonl`;
- lifecycle canônico;
- `UNKNOWN` após perda de ownership;
- heartbeat, `STALLED` e grace period;
- reconciliação por Git, arquivos, validações e probe externo;
- `/orchestrator resume [runId]`;
- replay e verificação de integridade.

Essa decisão de escopo é coerente com a ordem proposta. O próprio documento `references/persistent-state.md` declara que memória de projeto, FTS5, learning, recipes, Curator, worktrees e routing adaptativo pertencem a incrementos posteriores.

Contudo, o primeiro marco ainda não pode ser considerado completamente conforme porque possui falhas nos invariantes de run:

1. uma run vazia e ainda na Fase 1 pode virar `DONE`;
2. uma run `DONE` pode voltar a `RUNNING` por checkpoint de fase;
3. uma task removida da classificação deixa de bloquear o fechamento;
4. uma run corrompida pode ser ocultada e substituída silenciosamente por uma run antiga;
5. uma run pode virar `CANCELLED` mantendo task/executor `RUNNING`;
6. um probe `DONE` pode concluir uma task sem nenhuma evidência local configurada.

Portanto:

- como **fundação de persistência**, a versão é forte;
- como **state machine terminal e resiliente**, ainda precisa de correções;
- como implementação da **arquitetura completa**, entrega apenas uma parte inicial, conforme planejado.

## 2. Visão consolidada de conformidade

| Item | Capacidade proposta | Estado atual | Conformidade |
|---:|---|---|---|
| 1 | State Engine + `/orchestrator resume` | Implementação substancial, com gaps críticos de lifecycle e adapters externos manuais | **PARCIAL / BLOQUEADA** |
| 2 | Project Memory comprovada por fontes | Ausente | **NÃO IMPLEMENTADO** |
| 3 | Histórico SQLite/FTS5 pesquisável | Ausente | **NÃO IMPLEMENTADO** |
| 4 | Programmatic Tool Calling / scripts de inteligência | Apenas a fundação determinística do State Engine | **FUNDAÇÃO APENAS** |
| 5 | Lifecycle Manager de subagentes | Heartbeat/stall/grace implementados; coleta e ações externas ainda manuais | **PARCIAL** |
| 6 | Phase 12 — Learning | Nome reservado no código, mas fase executável e relatório ausentes | **NÃO IMPLEMENTADO** |
| 7 | Learned Recipes | Ausente | **NÃO IMPLEMENTADO** |
| 8 | Curator | Ausente | **NÃO IMPLEMENTADO** |
| 9 | Worktrees por task | Ausente | **NÃO IMPLEMENTADO** |
| 10 | Adaptive Model Escalation | Existe heurística estática, sem aprendizado histórico | **NÃO IMPLEMENTADO** |
| 11 | Observabilidade/telemetria | Eventos e contadores por run existem; camada agregada não existe | **FUNDAÇÃO APENAS** |

Resumo quantitativo por categoria:

- **0 itens totalmente conformes**;
- **1 item substancial, mas bloqueado por defeitos**;
- **1 item parcialmente implementado**;
- **2 itens com fundação reutilizável**;
- **7 itens não implementados**.

Isso não significa que a v3.6.0 deveria ter implementado tudo. Significa que, comparada à arquitetura final, ela é corretamente um primeiro incremento, não o produto completo.

## 3. Item 1 — Estado persistente e `/orchestrator resume`

### 3.1 Matriz detalhada

| Requisito da proposta | Situação | Evidência/observação |
|---|---|---|
| Criar `.orchestration/<slug>/state.json` | **SIM** | Snapshot versionado e materializado pelo State Engine |
| Criar `.orchestration/<slug>/events.jsonl` | **SIM** | Log append-only com revision e UUID |
| Persistir run ID, fase, status, wave e tasks | **SIM** | Campos presentes no snapshot e schema |
| Persistir executor, attempt, session/conversation IDs e commits | **SIM** | Campos presentes no lifecycle de task |
| `/orchestrator resume` | **SIM** | Seleciona a run ativa mais recente |
| `/orchestrator resume <runId>` | **SIM** | Seleção por run ID ou slug |
| Carregar e reparar estado | **SIM** | Replay, snapshot inválido/ausente/divergente e tail truncado |
| Reconciliar com Git | **SIM** | HEAD, branch, dirty files e diff desde `commitBefore` |
| Consultar Codex jobs | **PARCIAL** | O slash command orienta a consulta; não existe adapter determinístico no engine |
| Consultar AGY conversations | **PARCIAL** | Mesmo modelo de probe manual; não há adapter integrado |
| Verificar arquivos produzidos | **PARCIAL** | Existência é verificada quando arquivos são fornecidos; classificação não exige `expectedFiles` |
| Executar/verificar testes | **PARCIAL** | O engine consome resultados no probe; não descobre nem executa comandos de validação |
| Reconstruir wave | **SIM** | Primeira wave com task não terminal |
| Continuar da última fase segura | **PARCIAL** | `lastSafePhase + 1` existe, mas após Fase 11 aponta para Learning não implementado |
| Estados canônicos completos | **SIM** | `PENDING/RUNNING/DONE/FAILED/BLOCKED/STALLED/CANCELLED/UNKNOWN` |
| Crash com executor ativo vira `UNKNOWN` | **SIM** | `RUNNING -> UNKNOWN`, sem presumir falha |
| Não reexecutar cegamente | **SIM NO WORKFLOW** | Prompt e recomendações proíbem retry antes de reconciliar |
| Persistir terminal antes da entrega | **PARCIAL** | CLI/workflow exigem; adapters de executor não tornam isso tecnicamente obrigatório |
| Resultado `DONE/FAILED/REEXECUTE` após evidências | **PARCIAL** | Recomendações existem, mas `DONE` pode ocorrer sem evidência local |
| Timeout e stall estruturados | **PARCIAL** | Stall é estruturado; `TIMEOUT` é reduzido diretamente a `FAILED` e perde reasonCode bruto |

### 3.2 O que está bem implementado

#### Write-ahead e snapshot

O engine valida a mutação em memória, persiste o evento e sincroniza o arquivo antes de substituir o snapshot. Um crash entre evento e snapshot é recuperado pelo replay.

Também foram implementados:

- lock exclusivo com token e PID;
- recuperação de lock stale;
- revision monotônica;
- detecção de gap e duplicata;
- validação de run ID entre eventos;
- evento inicial obrigatório;
- reparo da última linha truncada;
- replay determinístico no `verify`.

#### Semântica de `UNKNOWN`

Esse é o ponto mais fiel à proposta. Quando o processo dono desaparece:

```text
RUNNING
  -> UNKNOWN
  -> reconcile
  -> DONE / FAILED / BLOCKED / RUNNING / decisão de reexecução
```

Git diff ou arquivo isolado não promovem a task para `DONE`. O engine retorna recomendações como:

- `VERIFY_BEFORE_REEXECUTE`;
- `REEXECUTE_AFTER_CONFIRMING_SESSION_IS_GONE`;
- `INSPECT_PARTIAL_THEN_RETRY`;
- `RESOLVE_BLOCKER`.

#### Integridade

O State Engine consegue:

- reconstruir snapshot ausente;
- substituir snapshot com schema inválido;
- detectar snapshot válido, mas divergente do log;
- reparar tail de evento incompleto;
- recusar entrega quando snapshot e replay não correspondem.

### 3.3 Gaps bloqueantes do Item 1

#### A. `DONE` não representa conclusão do workflow

`updateRunStatus(DONE)` verifica apenas tasks ainda presentes na fonte. Não exige:

- Fase 11 concluída;
- reviews executados ou `N/A`;
- E2E executado ou `N/A`;
- relatórios e handoff produzidos;
- existência de ao menos uma task.

Uma run vazia na Fase 1 pode virar `DONE`.

**Impacto:** o snapshot terminal pode contradizer o workflow e o handoff.

#### B. Terminalidade de run não é global

`resume` recusa runs `DONE/CANCELLED`, mas `phase` consegue alterar uma run `DONE` para `RUNNING`. `init` também devolve silenciosamente uma run terminal existente com `created: false`.

**Impacto:** a mesma identidade pode representar duas execuções e o histórico deixa de ser confiável.

#### C. Desaparecimento de escopo

`sync` preserva uma task removida como `sourcePresent: false`, mas `run DONE` deixa de considerá-la obrigatória.

**Impacto:** apagar a task do Markdown equivale a removê-la do gate sem decisão explícita.

#### D. Run corrompida pode ser ocultada

`findRunDirectory` captura erros de carregamento e ignora o diretório. A seleção automática pode retomar uma run antiga; a seleção por ID responde `RUN_NOT_FOUND` em vez de `RUN_CORRUPT`.

**Impacto:** o orquestrador pode continuar a execução errada.

#### E. Cancelamento não é reconciliável

É possível marcar a run `CANCELLED` enquanto uma task continua `RUNNING`. Depois disso, `resume` recusa a run por ser terminal.

**Impacto:** um executor pode continuar produzindo mudanças sem que o State Engine permita reconciliá-lo.

#### F. `DONE` externo pode não possuir corroboração

Se a classificação não fornecer arquivos esperados e o probe não fornecer validações, `executorStatus: DONE` promove a task diretamente:

```json
{
  "status": "DONE",
  "filesChecked": 0,
  "validationsPass": null
}
```

**Impacto:** a garantia “resultado autoritativo coerente com evidência local” torna-se vacuamente verdadeira.

### 3.4 Correções necessárias para concluir o Item 1

1. Criar `RUN_TRANSITIONS` independente de `TASK_TRANSITIONS`.
2. Bloquear toda mutação normal em run terminal.
3. Persistir gates obrigatórios com `DONE/FAILED/BLOCKED/N/A`.
4. Exigir finalização completa antes de `run DONE`.
5. Bloquear fechamento quando `missingFromSource` não estiver resolvido explicitamente.
6. Diferenciar `RUN_NOT_FOUND` de `RUN_CORRUPT`.
7. Impedir fallback automático para uma run antiga quando a mais recente falha ao carregar.
8. Tornar cancelamento um protocolo: interromper, reconciliar, persistir tasks e somente então fechar.
9. Exigir evidência suficiente para `UNKNOWN -> DONE`.
10. Tornar `expectedFiles`/`validationPlan` parte do contrato de classificação.
11. Implementar adapters determinísticos para status Codex e AGY quando as integrações expuserem APIs estáveis.
12. Preservar `reasonCode` bruto de quota/auth/timeout durante reconciliação.

## 4. Item 2 — Project Memory

**Estado:** **NÃO IMPLEMENTADO**.

Não existem:

```text
.orchestrator/project-memory.md
.orchestrator/knowledge.db
.orchestrator/learned/
```

Também não existe modelo para:

- fato validado;
- fonte/evidência;
- confidence;
- data de validação;
- invalidação de fato;
- conflito entre fontes;
- política de inclusão no contexto inicial.

O workflow continua partindo essencialmente do PRD/handoff e dos artefatos da run. Não há projeção automática de arquitetura, convenções, comandos de validação ou pitfalls persistentes do projeto.

### Requisitos mínimos recomendados

Cada fato deveria possuir algo equivalente a:

```json
{
  "factId": "frontend.framework",
  "value": "React + TypeScript",
  "status": "VALIDATED",
  "source": {
    "type": "FILE",
    "path": "package.json",
    "fingerprint": "sha256:..."
  },
  "validatedAt": "...",
  "invalidatedAt": null
}
```

Fontes permitidas:

- arquivo versionado;
- projeto/configuração;
- contrato;
- teste bem-sucedido;
- resultado determinístico;
- declaração explícita do usuário.

Inferências não comprovadas não devem entrar no `project-memory.md`.

## 5. Item 3 — Histórico pesquisável de execuções

**Estado:** **NÃO IMPLEMENTADO**.

Não existem:

- `.orchestrator/history.db`;
- schema SQLite;
- índices FTS5;
- comando `search_history`;
- projeção de `events.jsonl` para histórico global;
- tabelas de runs, failures, solutions, reviews, models ou agents.

O `events.jsonl` é uma boa fonte futura, mas ainda é local à run e não oferece busca cross-run.

### Arquitetura recomendada

Não transformar `history.db` em segunda fonte de verdade. Usá-lo como **projeção reconstruível**:

```text
events.jsonl de todas as runs
        -> projector idempotente por eventId/revision
        -> history.db
        -> FTS5
        -> search_history(query)
```

Campos importantes para busca:

- error fingerprint (`NU1301`, stack/code);
- causa;
- tentativas;
- solução;
- resultado;
- executor/modelo;
- task type/complexity;
- arquivos/contratos relacionados;
- run ID e timestamps.

## 6. Item 4 — Programmatic Tool Calling

**Estado:** **FUNDAÇÃO APENAS**.

O State Engine comprova o padrão desejado:

- script Node determinístico;
- leitura de muitos artefatos;
- resultado JSON condensado;
- menor dependência de raciocínio LLM para mecânica.

Porém, não existe a camada proposta:

```text
scripts/intelligence/
  inspect-project.mjs
  inspect-contract.mjs
  inspect-api-ui.mjs
  inspect-diff.mjs
  validate-wire-format.mjs
  validate-task-scope.mjs
  collect-test-results.mjs
  reconcile-run.mjs
```

Também não existe regra operacional executável para converter:

```text
>= 3 Greps/Reads
ou loop sobre arquivos
ou comparação mecânica
    -> script determinístico
```

### Próximo incremento recomendado

Começar por scripts com maior retorno e menor ambiguidade:

1. `inspect-project.mjs`;
2. `collect-test-results.mjs`;
3. `validate-task-scope.mjs`;
4. `validate-wire-format.mjs`;
5. `inspect-api-ui.mjs`.

Todo script deveria:

- receber argumentos explícitos;
- emitir JSON versionado;
- possuir schema de saída;
- limitar tamanho do resultado;
- nunca modificar código produtivo;
- produzir evidence IDs consumíveis pelo State Engine.

## 7. Item 5 — Lifecycle Manager dos subagentes

**Estado:** **PARCIALMENTE IMPLEMENTADO**.

### Implementado

- `RUNNING`;
- `lastActivityAt`;
- `apiCalls`;
- `toolCalls`;
- `currentTool`;
- `inTool`;
- `attempt`;
- heartbeat somente com mudança observável;
- threshold idle e in-tool separados;
- `STALLED`;
- grace period;
- recuperação `STALLED -> RUNNING`;
- recomendações de interrupt/reconcile/cancel-or-retry.

### Não implementado

- coleta automática de heartbeat de Codex;
- coleta automática de heartbeat de AGY;
- adapter de status de session/conversation;
- interrupção real do executor pelo lifecycle manager;
- cancelamento real;
- retry real;
- lease/ownership renovável;
- tratamento de crash durante cancelamento;
- política de timeout preservando causa e reasonCode;
- scheduler contínuo de sweeps.

Hoje o engine persiste lifecycle, mas o orquestrador ainda precisa observar ferramentas e alimentar os dados manualmente.

### Conclusão do item

O componente atual é um **Lifecycle State Store + Stall Detector**, ainda não um Lifecycle Manager completo.

## 8. Item 6 — Self-improvement e Phase 12

**Estado:** **NÃO IMPLEMENTADO**.

Existe apenas:

```js
12: "learning"
```

Não existem:

- fase descrita no workflow;
- `learning-report.md`;
- extração de falhas e soluções;
- candidate lessons;
- confidence/reuse potential;
- validação de lição;
- promoção controlada para recipe;
- proteção contra alteração automática do `SKILL.md`.

Além de incompleta, a reserva atual produz um bug: crash após Fase 11 retorna `resumeFromPhase: 12`, mas não há instrução executável para essa fase.

### Recomendação

Até a fase existir, retomar após Fase 11 em uma ação determinística de finalização. Quando implementada, a ordem mais segura é:

```text
Phase 10 reports
Phase 11 delivery/final gates
Phase 12 learning candidate generation
run DONE
```

Se learning não puder bloquear a entrega, registrar claramente se é gate obrigatório ou pós-processamento recuperável.

## 9. Item 7 — Learned Recipes

**Estado:** **NÃO IMPLEMENTADO**.

Não existem:

- diretório de recipes;
- schema;
- trigger matcher;
- confidence;
- contadores de uso/sucesso/falha;
- política automática;
- comando de inspeção;
- vínculo recipe → evidence/run.

### Dependências antes de implementar

1. Histórico pesquisável;
2. Learning candidates;
3. Evidence model;
4. Identidade estável para error fingerprints;
5. política de conflitos e precedência.

Uma recipe nunca deveria executar somente por similaridade textual. O trigger precisa ser determinístico e a action deve ter escopo permitido explícito.

## 10. Item 8 — Curator

**Estado:** **NÃO IMPLEMENTADO**.

Não existem comandos:

```text
/orchestrator knowledge status
/orchestrator knowledge pin <recipe>
/orchestrator knowledge archive <recipe>
/orchestrator knowledge rollback
```

Também não existe lifecycle:

- `ACTIVE`;
- `STALE`;
- `ARCHIVED`;
- pinning;
- backup;
- rollback;
- detecção de regras contraditórias.

O Curator depende de Learned Recipes reais e não deve ser antecipado antes delas.

## 11. Item 9 — Isolamento por worktrees

**Estado:** **NÃO IMPLEMENTADO**.

As waves oferecem isolamento lógico, mas todos os executores ainda operam no mesmo working tree.

Não existem:

- `git worktree` por task;
- branches efêmeras por task;
- integração automática;
- detecção determinística de shared files;
- merge/rebase/cherry-pick controlado;
- cleanup de worktree;
- recovery de worktree após crash.

### Dependências recomendadas

Antes de worktrees, o State Engine precisa persistir:

- `workspacePath`;
- branch;
- base commit;
- head da task;
- integration status;
- conflicts;
- cleanup status.

O gate sugerido permanece válido:

```text
sharedFiles == 0 -> parallel + isolated worktree
sharedFiles > 0  -> mesma wave proibida ou integração serial
```

## 12. Item 10 — Adaptive Model Escalation

**Estado:** **NÃO IMPLEMENTADO**.

O plugin possui routing estático por heurística:

- `flash-medium` padrão;
- `flash-high` para design system;
- `pro-low` para complexidade/contratos/risco;
- `pro-high` para casos críticos;
- override do usuário;
- validação de allowlist e piso de fidelidade.

Isso é uma boa baseline, mas não é adaptativo. Não existem:

- histórico por task type/modelo;
- first-pass success rate;
- review failure rate;
- duração média;
- regressions;
- retry outcome;
- comparação causal entre modelo inicial e escalado;
- router baseado em telemetria.

### Dependências

Adaptive routing deve vir depois de:

1. telemetria normalizada;
2. histórico suficiente;
3. definição de task features;
4. controle de viés por complexidade;
5. mínimo de amostras e fallback heurístico.

Sem isso, porcentagens de sucesso podem apenas refletir que modelos melhores receberam tasks mais difíceis ou mais fáceis.

## 13. Item 11 — Observabilidade

**Estado:** **FUNDAÇÃO APENAS**.

### Fundação disponível

O sistema já produz dados úteis por run:

- event type;
- timestamps;
- executor;
- attempt;
- task category;
- API/tool calls;
- stall;
- status e reason;
- Git heads;
- validations;
- review/report artifacts.

### Ausente

Não existem:

- `.orchestrator/telemetry.jsonl`;
- schema de telemetry;
- projector cross-run;
- duração normalizada;
- first-pass success;
- review result normalizado;
- regression count;
- model usado por attempt no State Engine;
- dashboards/queries;
- export OTLP;
- política de privacidade e redaction;
- retenção/compactação.

O `events.jsonl` pode alimentar telemetry futura, mas seus payloads atuais foram desenhados para recuperação, não para analytics estável.

### Recomendação

Criar uma projeção separada e reconstruível:

```text
events.jsonl
    -> telemetry projector
    -> telemetry.jsonl ou SQLite
    -> métricas agregadas
```

Evitar exportar prompts, conteúdo de arquivos ou dados do usuário. Priorizar IDs, categorias, estados, duração, contadores e fingerprints.

## 14. Conformidade com a arquitetura-alvo

| Camada da arquitetura proposta | Situação atual |
|---|---|
| PRD/spec como entrada | **IMPLEMENTADO** |
| Project Memory antes da classificação | **AUSENTE** |
| Orchestrator | **IMPLEMENTADO** |
| State Engine | **IMPLEMENTADO COM GAPS** |
| Tasks/waves/checkpoints | **IMPLEMENTADO** |
| Heartbeat/resume | **IMPLEMENTADO PARCIALMENTE** |
| Codex/AGY | **IMPLEMENTADO** |
| Workspace isolado por agente | **AUSENTE** |
| Integration | **IMPLEMENTADO NO WORKFLOW** |
| Programmatic Validation | **AUSENTE** |
| Review | **IMPLEMENTADO** |
| E2E | **IMPLEMENTADO NO WORKFLOW** |
| Telemetry | **AUSENTE; HÁ EVENTOS-FONTE** |
| Learning Engine | **AUSENTE** |
| Project Memory output | **AUSENTE** |
| Learned Recipes | **AUSENTE** |
| Curator | **AUSENTE** |

## 15. Ordem de implementação revisada

A ordem original continua boa, com um passo zero necessário:

### Passo 0 — estabilizar a v3.6.0

- terminalidade de run;
- completion gates;
- task removida da fonte;
- corrupção na seleção de resume;
- cancelamento reconciliável;
- evidência mínima para `DONE`;
- reason codes corretos;
- finalização pós-Fase 11;
- testes adversariais.

### Passo 1 — Project Knowledge Core

Implementar em conjunto:

- evidence model;
- `project-memory.md`;
- `knowledge.db`;
- projector de eventos;
- `history.db` + FTS5;
- comandos read-only de busca.

### Passo 2 — Programmatic Validation

- `inspect-project`;
- `collect-test-results`;
- `validate-task-scope`;
- `validate-wire-format`;
- `inspect-api-ui`.

### Passo 3 — Lifecycle Manager completo

- adapters Codex/AGY;
- heartbeat automático;
- leases;
- interrupt/cancel;
- retry após reconciliação;
- scheduler de sweep.

### Passo 4 — Telemetry

- schema mínimo e privacy-first;
- projeção cross-run;
- métricas por executor/modelo/task type;
- queries e relatórios.

### Passo 5 — Learning

- Phase 12 formal;
- candidate lessons;
- evidence/confidence;
- `learning-report.md`;
- nenhuma alteração automática do `SKILL.md`.

### Passo 6 — Recipes e Curator

- recipes versionadas;
- trigger determinístico;
- usage/outcome counters;
- active/stale/archived;
- pin/archive/rollback.

### Passo 7 — Worktrees

- workspace por task;
- base/head/integration no state;
- detecção de shared files;
- merge e cleanup recuperáveis.

### Passo 8 — Adaptive Router

- features da task;
- histórico mínimo;
- modelo estatístico simples e auditável;
- fallback para heurística;
- exploração controlada, nunca aleatória em task crítica.

## 16. Eventos que deveriam ser preparados agora para os próximos itens

Antes de construir memória, telemetry e adaptive routing, vale evoluir o contrato de eventos para registrar de forma normalizada:

```text
taskType
complexity
executor
model
attempt
startedAt
completedAt
durationMs
result
reasonCode
errorFingerprint
reviewResult
regressions
validationSummary
filesChangedCount
contractIds
evidenceIds
workspaceId
```

Esses campos não precisam ficar todos sempre no prompt. Eles devem alimentar projeções determinísticas.

## 17. Critério de aceite por marco

### Marco 1 — State Engine

Pode ser considerado concluído quando:

- os gaps bloqueantes do Item 1 estiverem corrigidos;
- status de Codex/AGY possuir adapter ou fallback `UNKNOWN` explícito;
- cancelamento e corrupção forem recuperáveis;
- completion gates forem executáveis, não apenas documentais;
- testes adversariais passarem.

### Marco 2 — Memory + History

Pode ser considerado concluído quando:

- todo fato possuir fonte comprovável;
- fatos inválidos puderem ser revogados;
- history for reconstruível dos eventos;
- FTS retornar run/task/evidência;
- nenhuma inferência não validada entrar na memória sempre carregada.

### Marco 3 — Intelligence Scripts

Pode ser considerado concluído quando:

- comparações mecânicas relevantes tiverem scripts;
- outputs forem pequenos, versionados e testados;
- scripts não modificarem código produtivo;
- evidence IDs integrarem State Engine e History.

### Marco 4 — Learning System

Pode ser considerado concluído quando:

- learning produzir candidates, não regras globais automáticas;
- recipes exigirem evidência e confidence;
- Curator controlar acúmulo e contradição;
- rollback for testado.

### Marco 5 — Adaptive Engineering System

Pode ser considerado concluído quando:

- worktrees isolarem tasks elegíveis;
- telemetry medir qualidade e velocidade;
- model routing usar histórico com amostra mínima;
- decisões adaptativas forem explicáveis e auditáveis.

## 18. Veredito final

### Contra a primeira implementação proposta

**Resultado:** **PARCIALMENTE CONFORME — CHANGES REQUESTED**.

A maior parte da mecânica desejada existe, especialmente persistência, replay, `UNKNOWN`, heartbeat, stall e resume. Os gaps restantes não são cosméticos: atingem terminalidade, seleção da run correta, cancelamento e prova de conclusão.

### Contra os 11 itens completos

**Resultado:** **INCOMPLETO POR DESENHO**.

A versão atual deve ser tratada como a fundação do sistema, não como o sistema acumulativo completo. Project Memory, histórico, intelligence scripts, telemetry, learning, recipes, Curator, worktrees e adaptive routing ainda precisam ser implementados.

### Recomendação de release

Não iniciar os próximos componentes em cima de invariantes frágeis de run. Primeiro corrigir o Marco 1 e transformar seus eventos em uma fonte confiável; depois construir memória, histórico e telemetria como projeções dessa base.
