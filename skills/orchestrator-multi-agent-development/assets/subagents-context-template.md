# Contexto Consolidado dos Subagentes — <NOME DA MUDANÇA>

> Entregável obrigatório. Salve em `openspec/changes/<nome>/subagents-context.md`.
> Use este arquivo para preservar o resumo operacional de todos os subagentes Codex/Gemini executados. Não registre subagentes Claude Code, porque o orquestrador não os executa neste fluxo.

## Resumo Geral

- **Mudança:** `<nome>`
- **Status final:** `<concluída | concluída com pendências | bloqueada>`
- **Ondas executadas:** `<N>`
- **Subagentes executados:** `<N total>`
- **Subagentes por tipo:**
  - `codex:codex-rescue`: `<N>`
  - `cc-gemini-plugin:gemini-agent`: `<N>`
- **Fallbacks/handoffs realizados:** `<nenhum | resumo>`
- **Pendências globais:** `<nenhuma | lista curta>`

## Linha do Tempo

| Timestamp | Onda | Task | Subagent type | Modelo | Evento | Status |
|---|---|---|---|---|---|---|
| `<ts>` | `<wave>` | `<task>` | `<codex/gemini>` | `<modelo>` | `<delegado/DONE/BLOCKED/...>` | `<status>` |

## Contexto por Subagente

### <AGENTE ID OU DESCRIÇÃO> — <TASK ID>

- **Onda:** `<wave>`
- **Task:** `<ID e título>`
- **Subagent type:** `<codex:codex-rescue | cc-gemini-plugin:gemini-agent>`
- **Modelo:** `<gpt-5.4-codex | gpt-5.5-codex | gemini-3-pro | gemini-3-flash>`
- **Status final:** `<DONE | BLOCKED | FAILED | QUOTA_EXHAUSTED | NEEDS_SYNC>`
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
| `<risco/pendência>` | `<task/agente>` | `<baixo/médio/alto>` | `<ação>` | `<owner>` |

## Contexto para Retomada

<Explique em 5-10 linhas o estado atual da mudança para alguém retomar sem reler todos os retornos dos subagentes. Inclua o que já foi integrado, o que foi validado, o que ainda exige decisão e quais arquivos/contratos são fonte da verdade.>
