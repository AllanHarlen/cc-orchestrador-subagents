# Monitoramento da execução - <NOME DA MUDANÇA>

## Legenda de status

| Status | Significado |
|---|---|
| `PENDING` | task identificada, ainda não delegada |
| `RUNNING` | agente rodando |
| `DONE` | agente concluiu |
| `FAILED` | agente falhou |
| `BLOCKED` | precisa decisão, permissão ou mudança externa |
| `STALLED` | ficou sem progresso além do threshold; ainda não é falha |
| `CANCELLED` | usuário/orquestrador cancelou explicitamente |
| `UNKNOWN` | resultado não determinável após interrupção/crash |

`PAUSED` é estado do run. `NEEDS_SYNC`, `QUOTA_EXHAUSTED`, `QUOTA_EXAUSTED`, `AUTH_REQUIRED`, `AGY_MISSING`, `TIMEOUT` e `REVIEWED` ficam em `reasonCode`/evidência, mapeados para um estado canônico.

- **Run ID:** `<runId de state.json>`
- **Revisão persistida:** `<revision>`
- **Fase / última fase segura:** `<phase> / <lastSafePhase>`
- **Wave atual:** `<currentWave>`
- **Project Memory / history audit:** `<VALIDATED | STALE/CONFLICT pendente>` / `<projectedAt>`
- **Lifecycle adapter:** `<config/path | manual UNKNOWN-safe fallback>`
- **Telemetry projection:** `<eventos / updatedAt>`

## Completion gates

| Gate | Required | Status | Evidence / motivo |
|---|---:|---|---|
| `backendReview` | `<true|false>` | `<status>` | `<evidence|N/A>` |
| `frontendReview` | `<true|false>` | `<status>` | `<evidence|N/A>` |
| `browserE2E` | `<true|false>` | `<status>` | `<evidence|waiver arquitetural>` |
| `reports` / `handoff` / `delivery` / `learning` | `true` | `<status>` | `<evidence>` |

## Task <ID> - <TÍTULO>

- **Categoria:** `<FULLSTACK | BACKEND_ONLY | FRONTEND_ONLY | ...>`
- **contractRequired:** `<yes | no>`
- **assignedAgent:** `<codex:codex-rescue | cc-antigravity-plugin:antigravity-coder | ambos>` (review usa `antigravity-agent`, somente leitura)
- **Execucao:** `<Codex --effort medium/high | AGY --model <agyModel>>`
- **Modelo / source / evidence:** `<modelo>` / `<user|heuristic|adaptive>` / `<agyModelEvidence|N/A>`
- **Routing validado:** `<sim | nao | pendente>`
- **Status:** `<PENDING>`
- **reasonCode:** `<N/A | QUOTA_EXHAUSTED | AUTH_REQUIRED | TIMEOUT | NEEDS_SYNC | ...>`
- **Attempt:** `<0>`
- **Attempt history:** `<lista resumida | nenhuma>`
- **Session ID / Conversation ID:** `<id | N/A>`
- **Lease owner / expiry:** `<owner|N/A>` / `<ts|N/A>`
- **Workspace:** `<shared|isolated>` — `<path|N/A>` / branch `<branch|N/A>` / integration `<status>`
- **commitBefore / commitAfter:** `<sha | N/A>` / `<sha | N/A>`
- **startedAt / lastActivityAt:** `<ts | N/A>` / `<ts | N/A>`
- **apiCalls / toolCalls / currentTool:** `<N>` / `<N>` / `<tool | N/A>`
- **Dependências:** `<nenhuma | lista>`
- **Agentes:**
  - Back-end: `codex:codex-rescue` (Codex padrao da conta, `--effort medium`)
  - Front-end: `cc-antigravity-plugin:antigravity-coder` (AGY com `--model <agyModel>`)
- **Contrato:** `<contracts/T1.md | N/A>`
- **Expected files / validation plan / allowed paths:** `<listas>`
- **Evidence IDs / executor result:** `<lista>` / `<run/executor-results/...|N/A>`
- **Wire format validado:** `<sim | nao | pendente>`
- **Riscos atuais:** `<texto>`
- **Supervisão operacional:**
  - Motivo atual: `<nenhum | cota | tool | escrita | task lenta | bloqueio>`
  - Evidência: `<mensagem curta>`
  - Sandbox Codex: `<N/A | rede externa bloqueada | pacote ausente no cache | escrita fora do working directory | nenhum>`
  - Arquivos parciais: `<lista | nenhum>`
  - Fallback escolhido: `<nenhum | codex effort medium | review interno do orquestrador | decisão do usuário>`
  - Próxima ação: `<aguardar | check-in | redelegar | pedir decisão | integrar>`

## Política de heartbeat, stall e UNKNOWN

- Atualize heartbeat somente quando houver progresso observável; poll sem mudança não renova `lastActivityAt`.
- Defaults: 450s sem progresso fora de tool, 1200s dentro de tool, 120s de grace period.
- `STALLED` aciona interrupção + reconciliação; não aciona retry imediato.
- Ao retomar uma sessão interrompida, `RUNNING -> UNKNOWN` antes de consultar executor, Git, arquivos e validações.
- Git diff ou arquivo existente isoladamente não autoriza `DONE`.
- Adapter desconhecido ou indisponivel mantem `UNKNOWN`; interrupt/retry/cancel exigem adapter ou confirmacao externa explicita.
- Telemetria registra somente metadados allowlisted, nunca prompt/conteudo/diff/source/raw output/secrets.

## Política de quota

- `QUOTA_EXAUSTED` no Antigravity/AGY em implementação: registrar evidência e avaliar fallback para Codex.
- `AUTH_REQUIRED`, `AGY_MISSING` e `TIMEOUT` no Antigravity/AGY: registrar evidência, marcar bloqueio operacional e definir a próxima ação.
- `QUOTA_EXHAUSTED` no Codex em implementação ou ajuste: marcar `BLOCKED` e pedir decisão.
- `QUOTA_EXHAUSTED` no Codex em review back-end: registrar fallback de review interno read-only do orquestrador em `review/review-final.md`.
- `QUOTA_EXAUSTED`/`AUTH_REQUIRED`/`AGY_MISSING`/`TIMEOUT` no AGY em review front-end (`gemini-3.1-pro-high`): registrar fallback de review interno read-only do orquestrador em `review/review-frontend.md`.

## Política de sandbox Codex

- Rede externa bloqueada para pacote/restore: marcar `BLOCKED`, registrar comando, pacote e erro.
- Pacote ausente no cache local: marcar `BLOCKED`, registrar dependencia.
- Escrita fora do working directory permitido: marcar `BLOCKED`, registrar working directory e caminho alvo.
- UI sem dependencia de rede segue preferencialmente com Antigravity/AGY.

## Log de eventos

| Timestamp | Task | Evento |
|---|---|---|
| `<ts>` | `<T1>` | delegado |
| `<ts>` | `<T1>` | HEARTBEAT - apiCalls=`<N>` toolCalls=`<N>` currentTool=`<tool>` |
| `<ts>` | `<T1>` | STALLED - quiet=`<N>s` threshold=`<N>s` grace=`<N>s` |
| `<ts>` | `<T1>` | UNKNOWN - owner session interrompida; reconciliacao pendente |
| `<ts>` | `<T1>` | RECONCILED - `<DONE | RUNNING | FAILED | BLOCKED | STALLED | CANCELLED | UNKNOWN>`; evidencia=`<resumo>` |
| `<ts>` | `<T1>` | SLOW_CHECKIN |
| `<ts>` | `<T1>` | QUOTA_EXAUSTED - agente: `<antigravity>`; model: `<agyModel>`; retry: `<--continue|n/a>`; fallback: `<acao>` |
| `<ts>` | `<T1>` | QUOTA_EXHAUSTED - agente: `<codex>`; fallback: `<acao>` |
| `<ts>` | `<T1>` | BLOCKED - sandbox Codex: `<rede externa | pacote ausente | escrita fora do working directory>` |
| `<ts>` | `<T1>` | NEEDS_SYNC - contrato atualizado |
| `<ts>` | `<T1>` | DONE |
