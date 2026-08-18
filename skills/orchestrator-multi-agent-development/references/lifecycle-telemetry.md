# Lifecycle Manager e telemetria

## Adapters de executor

Status Codex/AGY são normalizados por adapters conservadores. Payload desconhecido é `UNKNOWN`, nunca sucesso. O lifecycle aceita snapshots (`--codex-file`, `--agy-file`) ou um adapter de controle executável sem shell:

```json
{
  "codex": {
    "probe": { "command": "codex-control", "args": ["status", "{sessionId}"] },
    "interrupt": { "command": "codex-control", "args": ["stop", "{sessionId}"] },
    "dispatch": { "command": "codex-control", "args": ["retry", "{taskId}"] }
  }
}
```

Placeholders disponíveis em `args` e `cwd`: `taskId`, `executor`, `sessionId`, `conversationId`, `attempt`, `projectRoot`, `artifactDir`, `reason`. `command` é fixo, nunca interpolado; a execução usa `shell: false`; `cwd` deve permanecer dentro do projeto. Timeout, buffer e o resultado estruturado devolvido ao contexto têm limites explícitos (o último, 128 KiB). stdout JSON é preferido; stderr/output são limitados e secrets conhecidos são redigidos. O schema está em `assets/executor-control-config.schema.json`.

O lifecycle persiste a resposta em `run/executor-results/` antes de heartbeat/reconcile. `interrupt` e `retry` exigem adapter ou confirmação explícita de uma ação externa já realizada.

## Scheduler

```bash
node "${CLAUDE_SKILL_DIR}/scripts/orchestration-lifecycle.mjs" tick --dir <run> --adapter-config <json>
node "${CLAUDE_SKILL_DIR}/scripts/orchestration-lifecycle.mjs" watch --dir <run> --interval-seconds 30 --max-ticks 100
```

Progresso renova heartbeat e lease; silêncio produz `STALLED`, grace e depois `INTERRUPT_THEN_RECONCILE`. Retry é proibido antes de reconciliar e confirmar que a sessão antiga não está viva.

## Telemetria privacy-first

`.orchestrator/telemetry.jsonl` registra apenas metadados allowlisted: IDs, categorias, modelo, tentativa, timestamps, duração, resultado, reason code/fingerprint, review, regressões e contadores. Os objetos `metadata` e `validationSummary` também são fechados por chave; prompt, conteúdo, diff, source code, secrets, credentials, raw output e qualquer campo arbitrário são recusados inclusive quando aninhados.

```bash
node "${CLAUDE_SKILL_DIR}/scripts/orchestration-telemetry.mjs" project --dir <run>
node "${CLAUDE_SKILL_DIR}/scripts/orchestration-telemetry.mjs" report --detailed
node "${CLAUDE_SKILL_DIR}/scripts/orchestration-telemetry.mjs" compact --retention-days 365
```

Compactação é dry-run por padrão e cria backup antes de aplicar. O schema é `assets/telemetry-event.schema.json`.

## OTLP

`otlp-preview` gera OTLP/HTTP JSON de logs sem conteúdo do usuário. `otlp-export --endpoint` faz envio somente quando explicitamente invocado. HTTPS é obrigatório fora de localhost, salvo `--allow-insecure` consciente.
