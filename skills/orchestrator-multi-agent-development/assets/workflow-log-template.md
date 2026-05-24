# Log de Workflow do Orquestrador - <NOME DA MUDANCA>

> Entregavel final obrigatorio. Salve em `openspec/changes/<nome>/workflow-log.md`.
> Este arquivo registra a execucao completa do orquestrador por fase. Use `monitoring.md` como fonte viva de eventos de ondas/subagentes e consolide aqui a linha do tempo auditavel.

## 1. Metadados da Execucao

- **Mudanca:** `<nome>`
- **Modo de execucao:** `<orchestrator | goal>`
- **Comando usado:** `<escreva /orchestrator ou /goal>`
- **Status final:** `<DONE | DONE_WITH_PENDING_ITEMS | BLOCKED | PAUSED | CANCELLED | FAILED>`
- **Inicio:** `<timestamp ou N/A>`
- **Fim:** `<timestamp ou N/A>`
- **Orquestrador:** `Claude Sonnet 4.6 medium`
- **Artefatos principais:**
  - `openspec/changes/<nome>/proposal.md`
  - `openspec/changes/<nome>/design.md`
  - `openspec/changes/<nome>/tasks.md`
  - `openspec/changes/<nome>/monitoring.md`
  - `openspec/changes/<nome>/workflow-log.md`
  - `openspec/changes/<nome>/subagents-context.md`
  - `openspec/changes/<nome>/implementation-report.md`

## 2. Resumo Executivo do Workflow

<Explique em 3-6 linhas como a execucao evoluiu: preflight, planejamento, review, ondas de subagentes, validacoes, falhas relevantes e status final. Se o workflow foi interrompido, indique a fase e a condicao de retomada.>

## 3. Linha do Tempo por Fase

| Fase | Status | Inicio/Fim | O que aconteceu | Artefatos atualizados | Falhas/observacoes |
|---|---|---|---|---|---|
| `-1 Goal autonomy` | `<N/A | DONE | BLOCKED>` | `<ts>` | `<usado ou N/A>` | `<links>` | `<observacao>` |
| `0 Preflight` | `<DONE | FAILED>` | `<ts>` | `<resultado do preflight>` | `<N/A>` | `<falhas se houver>` |
| `1 Entendimento` | `<status>` | `<ts>` | `<resumo>` | `<proposal/design/tasks se aplicavel>` | `<falhas se houver>` |
| `2 OpenSpec` | `<status>` | `<ts>` | `<mudanca criada/atualizada>` | `<proposal/design/tasks/specs>` | `<falhas se houver>` |
| `3 Planejamento` | `<status>` | `<ts>` | `<plano elaborado>` | `<proposal/design/tasks>` | `<falhas se houver>` |
| `3.5 Gate de suficiencia` | `<status>` | `<ts>` | `<checklist preenchido>` | `<plan-sufficiency-check.md>` | `<falhas se houver>` |
| `4 Review do plano` | `<status>` | `<ts>` | `<decisao Codex>` | `<review-codex.md>` | `<APROVADO/REPROVADO e ajustes>` |
| `5 Consolidacao` | `<status>` | `<ts>` | `<ajustes do plano>` | `<proposal/design/tasks/specs>` | `<decisoes rejeitadas se houver>` |
| `6 Classificacao` | `<status>` | `<ts>` | `<tasks classificadas>` | `<tasks-classification.md>` | `<falhas se houver>` |
| `7 Paralelizacao` | `<status>` | `<ts>` | `<ondas definidas>` | `<waves.md>` | `<restricoes>` |
| `8 Contratos` | `<status>` | `<ts>` | `<contratos criados>` | `<contracts/*.md>` | `<duvidas/decisoes>` |
| `9 Delegacao paralela` | `<status>` | `<ts>` | `<subagentes lancados>` | `<monitoring.md>` | `<falhas se houver>` |
| `10 Monitoramento` | `<status>` | `<ts>` | `<eventos principais>` | `<monitoring.md>` | `<SLOW_CHECKIN/cota/tools>` |
| `11 Integracao` | `<status>` | `<ts>` | `<entregas consolidadas>` | `<subagents-context.md>` | `<divergencias/fallbacks>` |
| `12 Review final` | `<status>` | `<ts>` | `<decisao Codex>` | `<review-final.md>` | `<bloqueantes se houver>` |
| `13 Verificacao OpenSpec` | `<status>` | `<ts>` | `<verify/sync/archive>` | `<specs/arquivo de archive>` | `<falhas se houver>` |
| `14 Contexto e relatorios` | `<status>` | `<ts>` | `<entregaveis finais>` | `<workflow-log/subagents-context/implementation-report>` | `<pendencias>` |
| `15 Instrucoes de negocio` | `<status>` | `<ts>` | `<instrucoes entregues>` | `<implementation-report.md>` | `<observacao>` |

## 4. Subagentes Acionados

> Resumo curto. O detalhe completo fica em `openspec/changes/<nome>/subagents-context.md`.

| Onda | Task | Subagent type | Modelo | Status final | Link/contexto |
|---|---|---|---|---|---|
| `<wave>` | `<task>` | `<codex:codex-rescue | cc-antigravity-plugin:antigravity-agent>` | `<modelo>` | `<status>` | `subagents-context.md#<secao>` |

## 5. Falhas Possiveis Monitoradas

| Falha possivel | Fase esperada | Como detectar | Acao padrao |
|---|---|---|---|
| Preflight failed | `0` | `status: failed` no JSON do preflight | cancelar antes de criar OpenSpec e orientar remediacao |
| Plano reprovado | `4` | Codex retorna `REPROVADO` | consolidar ajustes na Fase 5 e re-revisar se o escopo mudou muito |
| Task bloqueada | `9-11` | subagente retorna `BLOCKED` | registrar evidencia, atualizar `monitoring.md`, pedir decisao ou redelegar com escopo restrito |
| Divergencia de contrato | `10-11` | nomes/tipos/endpoints diferentes entre back-end e front-end | marcar `NEEDS_SYNC`, decidir fonte da verdade e redelegar ajuste |
| Falha de subagente | `9-11` | subagente retorna `FAILED` ou nao entrega artefatos | registrar causa, impacto e proxima acao antes de continuar |
| Cota esgotada | `9-11` | `quota exceeded`, `rate limit`, `resource exhausted`, `daily limit` ou similar | marcar `QUOTA_EXHAUSTED` e aplicar fallback permitido |
| Falha de escrita/tool | `9-11` | erro de tool, terminal, escrita ou criacao de arquivo | parar agente afetado, registrar parciais e handoff para Codex se seguro |
| Pausa/cancelamento | qualquer | mensagem do usuario ou gate operacional | marcar `PAUSED`/`CANCELLED`, nao lancar novos agentes e preservar artefatos |
| Verificacao OpenSpec reprovada | `13` | `/openspec-verify-change` falha | registrar problemas e voltar para integracao/ajuste antes de arquivar |

## 6. Falhas Ocorridas e Recuperacao

| Timestamp | Fase | Evento | Evidencia curta | Impacto | Status | Acao tomada | Proxima acao |
|---|---|---|---|---|---|---|---|
| `<ts>` | `<fase>` | `<falha ou N/A>` | `<mensagem curta>` | `<baixo/medio/alto>` | `<BLOCKED/FAILED/etc>` | `<fallback/redelegacao/pausa>` | `<proxima acao>` |

Se nenhuma falha ocorreu, escreva: `Nenhuma falha operacional ocorreu durante esta execucao.`

## 7. Decisoes do Orquestrador

| Timestamp | Fase | Decisao | Motivo | Impacto |
|---|---|---|---|---|
| `<ts>` | `<fase>` | `<decisao>` | `<por que>` | `<efeito no workflow>` |

## 8. Validacoes e Evidencias

| Validacao | Status | Evidencia |
|---|---|---|
| Preflight | `<DONE/FAILED>` | `<resumo>` |
| Review de plano | `<APROVADO/APROVADO COM AJUSTES/REPROVADO>` | `review-codex.md` |
| Testes/build/lint/typecheck | `<status>` | `<comandos e resultado>` |
| Review pos-implementacao | `<APROVADO/REPROVADO/N/A>` | `review-final.md` |
| OpenSpec verify/sync/archive | `<status>` | `<comandos e resultado>` |

## 9. Pausa, Cancelamento ou Bloqueio

> Preencha sempre. Se nao ocorreu, escreva `N/A`.

- **Status:** `<N/A | PAUSED | CANCELLED | BLOCKED>`
- **Fase interrompida:** `<fase ou N/A>`
- **Motivo:** `<texto curto>`
- **Subagentes em execucao no momento:** `<lista | nenhum>`
- **Artefatos preservados:** `<lista>`
- **Condicao para retomada:** `<instrucao objetiva | N/A>`

## 10. Checklist Final do Log

- [ ] `workflow-log.md` criado em `openspec/changes/<nome>/workflow-log.md`
- [ ] Todas as fases aplicaveis registradas
- [ ] Falhas possiveis consideradas
- [ ] Falhas ocorridas registradas com evidencia, impacto e acao
- [ ] Pausa/cancelamento/bloqueio registrado ou marcado como `N/A`
- [ ] Subagentes resumidos e ligados ao `subagents-context.md`
- [ ] Validacoes finais registradas
- [ ] `implementation-report.md` referencia este log
