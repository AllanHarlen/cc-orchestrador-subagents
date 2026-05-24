# Monitoramento da execução - <NOME DA MUDANÇA>

## Legenda de status

| Status | Significado |
|---|---|
| `PENDING` | task identificada, ainda não delegada |
| `RUNNING` | agente rodando |
| `PAUSED` | usuário pediu pausa |
| `CANCELLED` | usuário cancelou |
| `BLOCKED` | precisa decisão do orquestrador ou do usuário |
| `NEEDS_SYNC` | contrato divergiu |
| `DONE` | agente concluiu |
| `FAILED` | agente falhou |
| `QUOTA_EXHAUSTED` | agente parou por quota/rate limit/capacidade |
| `REVIEWED` | passou pelo review final |

## Task <ID> - <TÍTULO>

- **Categoria:** `<FULLSTACK | BACKEND_ONLY | FRONTEND_ONLY | ...>`
- **contractRequired:** `<yes | no>`
- **Status:** `<PENDING>`
- **Dependências:** `<nenhuma | lista>`
- **Agentes:**
  - Back-end: `codex:codex-rescue` (Codex padrao da conta, `--effort medium`)
  - Front-end: `cc-antigravity-plugin:antigravity-agent` (`gemini-3.1-pro-low` ou `gemini-3.5-flash-medium`)
- **Contrato:** `<contracts/T1.md | N/A>`
- **Wire format validado:** `<sim | nao | pendente>`
- **Riscos atuais:** `<texto>`
- **Supervisão operacional:**
  - Motivo atual: `<nenhum | cota | tool | escrita | task lenta | bloqueio>`
  - Evidência: `<mensagem curta>`
  - Arquivos parciais: `<lista | nenhum>`
  - Fallback escolhido: `<nenhum | codex effort medium | review interno do orquestrador | decisão do usuário>`
  - Próxima ação: `<aguardar | check-in | redelegar | pedir decisão | integrar>`

## Política de quota

- `QUOTA_EXHAUSTED` no Antigravity/AGY: registrar evidência e avaliar fallback para Codex.
- `QUOTA_EXHAUSTED` no Codex em implementação ou ajuste: marcar `BLOCKED` e pedir decisão.
- `QUOTA_EXHAUSTED` no Codex em review: registrar fallback de review interno read-only do orquestrador em `review-final.md`.

## Log de eventos

| Timestamp | Task | Evento |
|---|---|---|
| `<ts>` | `<T1>` | delegado |
| `<ts>` | `<T1>` | SLOW_CHECKIN |
| `<ts>` | `<T1>` | QUOTA_EXHAUSTED - agente: `<antigravity|codex>`; fallback: `<acao>` |
| `<ts>` | `<T1>` | NEEDS_SYNC - contrato atualizado |
| `<ts>` | `<T1>` | DONE |
