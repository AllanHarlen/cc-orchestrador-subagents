# Log de Workflow do Orquestrador - <NOME DA EXECUÇÃO>

> Entregável final obrigatório. Salve na raiz de execução do agente.
> Este arquivo registra a execução completa do orquestrador por fase. Use `monitoring.md` como fonte viva de eventos de ondas/subagentes e consolide aqui a linha do tempo auditável.

## 1. Metadados da Execução

- **Execução:** `<nome>`
- **Especificação fonte (PRD/spec):** `<caminho do arquivo ingerido>`
- **Modo de execução:** `<orchestrator | goal>`
- **Comando usado:** `<escreva /orchestrator ou /goal>`
- **Status final:** `<DONE | DONE_WITH_PENDING_ITEMS | BLOCKED | PAUSED | CANCELLED | FAILED>`
- **Início:** `<timestamp ou N/A>`
- **Fim:** `<timestamp ou N/A>`
- **Orquestrador:** `Claude Sonnet 4.6 medium`
- **Artefatos principais:**
  - `orchestration/<nome>/tasks-classification.md`
  - `orchestration/<nome>/waves.md`
  - `orchestration/<nome>/contracts/`
  - `orchestration/<nome>/monitoring.md`
  - `orchestration/<nome>/review-final.md` (review back-end)
  - `orchestration/<nome>/review-frontend.md` (review front-end)
  - `workflow-log.md`
  - `subagents-context.md`
  - `implementation-report.md`

## 2. Resumo Executivo do Workflow

<Explique em 3-6 linhas como a execução evoluiu: preflight, planejamento, review, ondas de subagentes, validações, falhas relevantes e status final. Se o workflow foi interrompido, indique a fase e a condição de retomada.>

## 3. Linha do Tempo por Fase

| Fase | Status | Início/Fim | O que aconteceu | Artefatos atualizados | Falhas/observações |
|---|---|---|---|---|---|
| `-1 Goal autonomy` | `<N/A | DONE | BLOCKED>` | `<ts>` | `<usado ou N/A>` | `<links>` | `<observacao>` |
| `0 Preflight` | `<DONE | FAILED>` | `<ts>` | `<resultado do preflight>` | `<N/A>` | `<falhas se houver>` |
| `1 Ingestao da especificacao` | `<status>` | `<ts>` | `<PRD/spec ingerido>` | `<spec fonte>` | `<lacunas bloqueantes se houver>` |
| `2 Classificacao` | `<status>` | `<ts>` | `<tasks classificadas>` | `<tasks-classification.md>` | `<falhas se houver>` |
| `3 Ondas` | `<status>` | `<ts>` | `<ondas definidas + validate-routing>` | `<waves.md>` | `<restricoes/erros de roteamento>` |
| `4 Contratos` | `<status>` | `<ts>` | `<contratos criados>` | `<contracts/*.md>` | `<duvidas/decisoes>` |
| `5 Delegacao paralela` | `<status>` | `<ts>` | `<subagentes lancados>` | `<monitoring.md>` | `<falhas se houver>` |
| `6 Monitoramento` | `<status>` | `<ts>` | `<eventos principais>` | `<monitoring.md>` | `<SLOW_CHECKIN/cota/tools>` |
| `7 Integracao` | `<status>` | `<ts>` | `<entregas consolidadas>` | `<subagents-context.md>` | `<divergencias/fallbacks>` |
| `8 Review back-end (Codex)` | `<status | N/A>` | `<ts>` | `<decisao Codex>` | `<review-final.md>` | `<bloqueantes se houver>` |
| `9 Review front-end (AGY pro-high)` | `<status | N/A>` | `<ts>` | `<decisao AGY>` | `<review-frontend.md>` | `<bloqueantes se houver>` |
| `10 Contexto e relatorios` | `<status>` | `<ts>` | `<entregaveis finais>` | `<workflow-log/subagents-context/implementation-report>` | `<pendencias>` |
| `11 Instrucoes de negocio` | `<status>` | `<ts>` | `<instrucoes entregues>` | `<implementation-report.md>` | `<observacao>` |

## 4. Subagentes Acionados

> Resumo curto. O detalhe completo fica em `subagents-context.md`.

| Onda | Task | Subagent type | Execucao | Status final | Link/contexto |
|---|---|---|---|---|---|
| `<wave>` | `<task>` | `<codex:codex-rescue | cc-antigravity-plugin:antigravity-agent>` | `<--effort medium/high | AGY --model <agyModel>>` | `<status>` | `subagents-context.md#<secao>` |

## 5. Falhas Possíveis Monitoradas

| Falha possível | Fase esperada | Como detectar | Ação padrão |
|---|---|---|---|
| Preflight failed | `0` | `status: failed` no JSON do preflight | cancelar antes de delegar e orientar remediação |
| Especificação insuficiente | `1` | lacuna bloqueante no PRD/spec | resolver via `AskUserQuestion` apenas a lacuna; não abrir discovery |
| Task bloqueada | `5-7` | subagente retorna `BLOCKED` | registrar evidência, atualizar `monitoring.md`, pedir decisão ou redelegar com escopo restrito |
| Divergencia de contrato | `6-7` | nomes/tipos/endpoints diferentes entre back-end e front-end | marcar `NEEDS_SYNC`, decidir fonte da verdade e redelegar ajuste |
| Falha de subagente | `5-7` | subagente retorna `FAILED` ou nao entrega artefatos | registrar causa, impacto e proxima acao antes de continuar |
| Cota esgotada AGY | `5-7`, `9` | `quota exceeded`, `rate limit`, `resource exhausted`, `daily limit` ou similar no bridge AGY | marcar `QUOTA_EXAUSTED` e aplicar fallback permitido (review front-end cai para review interno) |
| Cota esgotada Codex | `5-7`, `8` | `quota exceeded`, `rate limit`, `resource exhausted`, `daily limit` ou similar no Codex | marcar `QUOTA_EXHAUSTED` e aplicar fallback permitido (review back-end cai para review interno) |
| Falha de escrita/tool | `5-7` | erro de tool, terminal, escrita ou criação de arquivo | parar agente afetado, registrar parciais e handoff se seguro |
| Sandbox Codex bloqueado | `5-7` | `NU1301`, registry externo inacessivel, pacote ausente no cache local ou `UnauthorizedAccessException` fora do working directory | marcar `BLOCKED`, registrar evidencia e pedir decisao do usuario |
| Review back-end reprovado | `8` | Codex retorna `REPROVADO` | registrar achados, redelegar ajuste ao Codex pela Fase 7 e re-revisar |
| Review front-end reprovado | `9` | AGY retorna `REPROVADO` | registrar achados, redelegar ajuste ao AGY pela Fase 7 e re-revisar |
| Pausa/cancelamento | qualquer | mensagem do usuário ou gate operacional | marcar `PAUSED`/`CANCELLED`, não lançar novos agentes e preservar artefatos |

## 6. Falhas Ocorridas e Recuperação

| Timestamp | Fase | Evento | Evidência curta | Impacto | Status | Ação tomada | Próxima ação |
|---|---|---|---|---|---|---|---|
| `<ts>` | `<fase>` | `<falha ou N/A>` | `<mensagem curta>` | `<baixo/medio/alto>` | `<BLOCKED/FAILED/etc>` | `<fallback/redelegacao/pausa>` | `<proxima acao>` |

Se nenhuma falha ocorreu, escreva: `Nenhuma falha operacional ocorreu durante esta execução.`

## 7. Decisões do Orquestrador

| Timestamp | Fase | Decisão | Motivo | Impacto |
|---|---|---|---|---|
| `<ts>` | `<fase>` | `<decisao>` | `<por que>` | `<efeito no workflow>` |

## 8. Validações e Evidências

| Validação | Status | Evidência |
|---|---|---|
| Preflight | `<DONE/FAILED>` | `<resumo>` |
| Routing (`validate-routing.mjs`) | `<PASSOU/FALHOU>` | `<resumo>` |
| Testes/build/lint/typecheck | `<status>` | `<comandos e resultado>` |
| Review back-end (Codex `--effort high`) | `<APROVADO/APROVADO_COM_RESSALVAS/REPROVADO/N/A>` | `review-final.md` |
| Review front-end (AGY `gemini-3.1-pro-high`) | `<APROVADO/APROVADO_COM_RESSALVAS/REPROVADO/N/A>` | `review-frontend.md` |

## 9. Pausa, Cancelamento ou Bloqueio

> Preencha sempre. Se não ocorreu, escreva `N/A`.

- **Status:** `<N/A | PAUSED | CANCELLED | BLOCKED>`
- **Fase interrompida:** `<fase ou N/A>`
- **Motivo:** `<texto curto>`
- **Subagentes em execução no momento:** `<lista | nenhum>`
- **Artefatos preservados:** `<lista>`
- **Condição para retomada:** `<instrucao objetiva | N/A>`

## 10. Checklist Final do Log

- [ ] `workflow-log.md` criado na raiz de execução do agente
- [ ] Todas as fases aplicáveis registradas
- [ ] Falhas possíveis consideradas
- [ ] Falhas ocorridas registradas com evidência, impacto e ação
- [ ] Pausa/cancelamento/bloqueio registrado ou marcado como `N/A`
- [ ] Subagentes resumidos e ligados ao `subagents-context.md`
- [ ] Validações finais registradas
- [ ] `implementation-report.md` referencia este log
