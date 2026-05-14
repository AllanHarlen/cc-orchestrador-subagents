# Monitoramento da Execução — <NOME DA MUDANÇA>

> Atualize este arquivo conforme os subagentes em background notificam conclusão. Não faça polling.

## Legenda de status

| Status | Significado |
|---|---|
| `PENDING` | task identificada, ainda não delegada |
| `RUNNING` | agente rodando em background |
| `BLOCKED` | agente reportou bloqueio, precisa de input do orquestrador ou usuário |
| `NEEDS_SYNC` | contrato divergiu entre back-end e front-end, precisa alinhar |
| `DONE` | agente concluiu, aguardando integração na fase 11 |
| `FAILED` | agente falhou, pode precisar redelegar com ajuste |
| `REVIEWED` | passou pelo review pós-implementação (fase 12) |

## Onda 1 — <Resumo da onda>

### Task T1 — <Título>

- **Categoria:** <FULLSTACK / BACKEND_ONLY / FRONTEND_ONLY / ...>
- **Status:** `RUNNING`
- **Dependências:** nenhuma
- **Agentes:**
  - Back-end: `codex:codex-rescue` (Codex gpt-5.4 medium)
  - Front-end: `cc-gemini-plugin:gemini-agent` (Gemini 3 pro)
- **Contrato:** `contracts/T1.md`
- **Riscos atuais:** <ex.: possível conflito no DTO de resposta>
- **Última atualização:**
  - `<timestamp>` — back-end criou entidade + repository
  - `<timestamp>` — front-end iniciou tela de listagem

### Task T2 — <Título>

- **Categoria:** BACKEND_ONLY
- **Status:** `DONE`
- **Dependências:** nenhuma
- **Agentes:**
  - Back-end: `codex:codex-rescue` (Codex gpt-5.4 medium)
- **Resumo da entrega:** `<2 linhas>`
- **Arquivos alterados:** `<lista>`
- **Pendências reportadas:** `<nenhuma | lista>`

## Onda 2 — <Resumo>

> Inicia quando Onda 1 estiver totalmente DONE/REVIEWED.

### Task T3 — <Título>

- **Categoria:** FULLSTACK
- **Status:** `PENDING`
- **Dependências:** T1, T2
- **Agentes previstos:**
  - Back-end: `codex:codex-rescue`
  - Front-end: `cc-gemini-plugin:gemini-agent` (Gemini 3 flash)
- **Contrato:** a gerar antes de delegar

## Log de eventos

| Timestamp | Task | Evento |
|---|---|---|
| `<ts>` | T1 | delegado (dupla) |
| `<ts>` | T2 | delegado (back-end only) |
| `<ts>` | T2 | DONE — relatório curto: <link> |
| `<ts>` | T1 | NEEDS_SYNC — campo `status` divergente |
| `<ts>` | T1 | contrato atualizado, ambos redelegados |
| `<ts>` | T1 | DONE |

## Resumo agregado

- Tasks totais: `<N>`
- Em PENDING: `<N>`
- Em RUNNING: `<N>`
- Em DONE: `<N>`
- Em REVIEWED: `<N>`
- Em FAILED: `<N>`
- Em BLOCKED / NEEDS_SYNC: `<N>`
