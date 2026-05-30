# Contexto Consolidado dos Subagentes - <NOME DA MUDANÇA>

> Entregável obrigatório. Salve em `openspec/changes/<nome>/subagents-context.md`.
> Use este arquivo para preservar o resumo operacional de todos os subagentes Codex/Antigravity executados. Não registre subagentes Claude Code, porque o orquestrador não os executa neste fluxo.

## Resumo Geral

- **Mudança:** `<nome>`
- **Status final:** `<concluída | concluída com pendências | bloqueada | pausada | cancelada>`
- **Ondas executadas:** `<N>`
- **Subagentes executados:** `<N total>`
- **Subagentes por tipo:**
  - `codex:codex-rescue`: `<N>`
  - `cc-antigravity-plugin:antigravity-agent`: `<N>`
- **Fallbacks/handoffs realizados:** `<nenhum | resumo>`
- **Gate do usuário:** `<ok | pausado | cancelado>`
- **Pendências globais:** `<nenhuma | lista curta>`

## Linha do Tempo

| Timestamp | Onda | Task | Subagent type | Execucao | Evento | Status |
|---|---|---|---|---|---|---|
| `<ts>` | `<wave>` | `<task>` | `<codex/antigravity>` | `<--effort medium/high | AGY --model <agyModel> [--parallel] [--subagent-model <model>]>` | `<delegado/DONE/BLOCKED/...>` | `<status>` |

## Contexto por Subagente

### <AGENTE ID OU DESCRIÇÃO> - <TASK ID>

- **Onda:** `<wave>`
- **Task:** `<ID e título>`
- **Subagent type:** `<codex:codex-rescue | cc-antigravity-plugin:antigravity-agent>`
- **Execucao:** `<--effort medium/high | AGY --model <agyModel> [--parallel] [--subagent-model <model>]>`
- **Fan-out Gemini:** `<agyParallel: yes|no>`
- **Subagentes Gemini nativos:** `<N | N/A>`
- **Conversation IDs dos subagentes:** `<lista | N/A>`
- **Status final:** `<DONE | BLOCKED | FAILED | QUOTA_EXHAUSTED | QUOTA_EXAUSTED | AUTH_REQUIRED | AGY_MISSING | TIMEOUT | NEEDS_SYNC | PAUSED | CANCELLED>`
- **Tokens usados:**
  - Input: `<N ou N/A>`
  - Output: `<N ou N/A>`
  - Cache read: `<N ou N/A>`
  - Total: `<N ou N/A>`
- **Resumo entregue:** `<2-5 linhas>`
- **Arquivos criados/alterados:**
  - `<caminho>`
- **Decisões relevantes:**
  - `<decisão técnica ou UI/UX>`
- **Testes/validações reportados:**
  - `<comando ou validação>: <resultado>`
- **Pendências reportadas:** `<nenhuma | lista>`
- **Riscos reportados:** `<nenhum | lista>`
- **Evidência operacional:** `<mensagem curta quando houve falha/cota/bloqueio>`
- **Limites de sandbox Codex:** `<N/A | nenhum | rede externa bloqueada | pacote ausente no cache | escrita fora do working directory>`
- **Ação do orquestrador:** `<integrado | redelegado | contrato ajustado | decisão do usuário | pendente>`

## Decisões Cruzadas Entre Subagentes

> Use quando back-end/front-end divergirem ou quando um handoff mudar a execução.

- **Contexto:** `<task/contrato/arquivo>`
- **Divergência ou descoberta:** `<descrição>`
- **Decisão do orquestrador:** `<decisão>`
- **Motivo:** `<por que essa decisão preserva o contrato/negócio>`
- **Subagentes impactados:** `<lista>`

## Riscos e Pendências Consolidados

| Item | Origem | Impacto | Próxima ação | Owner |
|---|---|---|---|---|
| `<risco/pendência>` | `<task/agente>` | `<baixo/medio/alto>` | `<ação>` | `<owner>` |

## Contexto para Retomada

<Explique em 5-10 linhas o estado atual da mudança para alguém retomar sem reler todos os retornos dos subagentes. Inclua o que já foi integrado, o que foi validado, o que ainda exige decisão e quais arquivos/contratos são fonte da verdade.>

## Cancelamento ou Pausa pelo Usuário

> Preencha apenas quando o gate de interrupção disparar.

- **Status:** `<PAUSED | CANCELLED>`
- **Motivo informado pelo usuário:** `<texto curto>`
- **Fase interrompida:** `<fase>`
- **Subagentes em execução no momento:** `<lista | nenhum>`
- **Subagentes concluídos antes da interrupção:** `<lista | nenhum>`
- **Artefatos preservados:** `<proposal/design/tasks/contracts/monitoring/etc.>`
- **Condição para retomada:** `<nova aprovação do plano | contrato revisto | nova instrução explícita | outra>`
