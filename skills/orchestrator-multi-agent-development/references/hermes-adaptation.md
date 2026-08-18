# Rastreabilidade da adaptação do Hermes

Fonte auditada: [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent), commit [`aeabff6`](https://github.com/NousResearch/hermes-agent/tree/aeabff6aec6fe0e8a32ed96cf76b9a692eaf705f), em 2026-08-17. O projeto é público e licenciado sob MIT. Esta implementação é própria, em Node.js, e não copia a arquitetura inteira nem assume compatibilidade de API.

| Padrão estudado | Fonte Hermes | Adaptação local |
|---|---|---|
| resultado de background durável antes da entrega | [`tools/delegate_tool.py`](https://github.com/NousResearch/hermes-agent/blob/aeabff6aec6fe0e8a32ed96cf76b9a692eaf705f/tools/delegate_tool.py) | evento write-ahead, `executor-results/`, probe antes de reconcile |
| heartbeat/stall por atividade | [`tools/delegate_tool.py`](https://github.com/NousResearch/hermes-agent/blob/aeabff6aec6fe0e8a32ed96cf76b9a692eaf705f/tools/delegate_tool.py) | counters, activity timestamp, thresholds separados, grace, lease |
| SQLite, migrations, WAL e FTS | [`hermes_state.py`](https://github.com/NousResearch/hermes-agent/blob/aeabff6aec6fe0e8a32ed96cf76b9a692eaf705f/hermes_state.py) | `knowledge.db`/`history.db`, migrations, WAL, busy timeout, FTS5 triggers |
| busca de sessões sem carregar tudo no prompt | [`tools/session_search_tool.py`](https://github.com/NousResearch/hermes-agent/blob/aeabff6aec6fe0e8a32ed96cf76b9a692eaf705f/tools/session_search_tool.py) | projector reconstruível + `history-search` |
| execução programática condensada | [`tools/code_execution_tool.py`](https://github.com/NousResearch/hermes-agent/blob/aeabff6aec6fe0e8a32ed96cf76b9a692eaf705f/tools/code_execution_tool.py) | oito scripts determinísticos com output versionado/evidence IDs |
| memória curta separada do histórico | [`tools/memory_tool.py`](https://github.com/NousResearch/hermes-agent/blob/aeabff6aec6fe0e8a32ed96cf76b9a692eaf705f/tools/memory_tool.py) | `project-memory.md` validada + databases pesquisáveis |
| curator, pin, backup e rollback | [`agent/curator.py`](https://github.com/NousResearch/hermes-agent/blob/aeabff6aec6fe0e8a32ed96cf76b9a692eaf705f/agent/curator.py), [`agent/curator_backup.py`](https://github.com/NousResearch/hermes-agent/blob/aeabff6aec6fe0e8a32ed96cf76b9a692eaf705f/agent/curator_backup.py) | recipes `ACTIVE/STALE/ARCHIVED`, contradictions, dry-run, hashes e rollback |

Diferenças deliberadas:

- `events.jsonl` continua fonte de verdade da run; SQLite é projeção, não substituto.
- aprendizado gera candidates; nunca altera a skill nem ativa regra sem validação independente.
- adapters externos são configuráveis porque Codex/AGY não expõem uma API universal estável neste plugin.
- routing adaptativo é conservador e estratificado para reduzir viés por complexidade.
- telemetria rejeita conteúdo do usuário e exporta apenas metadados allowlisted.
