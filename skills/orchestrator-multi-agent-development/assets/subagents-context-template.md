# Contexto Consolidado dos Subagentes - <NOME DA MUDANCA>

> Entregavel obrigatorio. Salve em `openspec/changes/<nome>/subagents-context.md`.
> Use este arquivo para preservar o resumo operacional de todos os subagentes Codex/Antigravity executados. Nao registre subagentes Claude Code, porque o orquestrador nao os executa neste fluxo.

## Resumo Geral

- **Mudanca:** `<nome>`
- **Status final:** `<concluida | concluida com pendencias | bloqueada | pausada | cancelada>`
- **Ondas executadas:** `<N>`
- **Subagentes executados:** `<N total>`
- **Subagentes por tipo:**
  - `codex:codex-rescue`: `<N>`
  - `cc-antigravity-plugin:antigravity-agent`: `<N>`
- **Fallbacks/handoffs realizados:** `<nenhum | resumo>`
- **Gate do usuario:** `<ok | pausado | cancelado>`
- **Pendencias globais:** `<nenhuma | lista curta>`

## Linha do Tempo

| Timestamp | Onda | Task | Subagent type | Modelo | Evento | Status |
|---|---|---|---|---|---|---|
| `<ts>` | `<wave>` | `<task>` | `<codex/antigravity>` | `<modelo>` | `<delegado/DONE/BLOCKED/...>` | `<status>` |

## Contexto por Subagente

### <AGENTE ID OU DESCRICAO> - <TASK ID>

- **Onda:** `<wave>`
- **Task:** `<ID e titulo>`
- **Subagent type:** `<codex:codex-rescue | cc-antigravity-plugin:antigravity-agent>`
- **Modelo:** `<Codex padrao da conta | gemini-3.1-pro-low | gemini-3.5-flash-medium>`
- **Status final:** `<DONE | BLOCKED | FAILED | QUOTA_EXHAUSTED | NEEDS_SYNC | PAUSED | CANCELLED>`
- **Tokens usados:**
  - Input: `<N ou N/A>`
  - Output: `<N ou N/A>`
  - Cache read: `<N ou N/A>`
  - Total: `<N ou N/A>`
- **Resumo entregue:** `<2-5 linhas>`
- **Arquivos criados/alterados:**
  - `<caminho>`
- **Decisoes relevantes:**
  - `<decisao tecnica ou UI/UX>`
- **Testes/validacoes reportados:**
  - `<comando ou validacao>: <resultado>`
- **Pendencias reportadas:** `<nenhuma | lista>`
- **Riscos reportados:** `<nenhum | lista>`
- **Evidencia operacional:** `<mensagem curta quando houve falha/cota/bloqueio>`
- **Acao do orquestrador:** `<integrado | redelegado | contrato ajustado | decisao do usuario | pendente>`

## Decisoes Cruzadas Entre Subagentes

> Use quando back-end/front-end divergirem ou quando um handoff mudar a execucao.

- **Contexto:** `<task/contrato/arquivo>`
- **Divergencia ou descoberta:** `<descricao>`
- **Decisao do orquestrador:** `<decisao>`
- **Motivo:** `<por que essa decisao preserva o contrato/negocio>`
- **Subagentes impactados:** `<lista>`

## Riscos e Pendencias Consolidados

| Item | Origem | Impacto | Proxima acao | Owner |
|---|---|---|---|---|
| `<risco/pendencia>` | `<task/agente>` | `<baixo/medio/alto>` | `<acao>` | `<owner>` |

## Contexto para Retomada

<Explique em 5-10 linhas o estado atual da mudanca para alguem retomar sem reler todos os retornos dos subagentes. Inclua o que ja foi integrado, o que foi validado, o que ainda exige decisao e quais arquivos/contratos sao fonte da verdade.>

## Cancelamento ou Pausa pelo Usuario

> Preencha apenas quando o gate de interrupcao disparar.

- **Status:** `<PAUSED | CANCELLED>`
- **Motivo informado pelo usuario:** `<texto curto>`
- **Fase interrompida:** `<fase>`
- **Subagentes em execucao no momento:** `<lista | nenhum>`
- **Subagentes concluidos antes da interrupcao:** `<lista | nenhum>`
- **Artefatos preservados:** `<proposal/design/tasks/contracts/monitoring/etc.>`
- **Condicao para retomada:** `<nova aprovacao do plano | contrato revisto | nova instrucao explicita | outra>`
