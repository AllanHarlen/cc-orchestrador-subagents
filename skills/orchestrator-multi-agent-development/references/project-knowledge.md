# Project Memory e histórico pesquisável

O contexto persistente do projeto fica separado da fonte de verdade de cada run:

```text
.orchestrator/
  project-memory.md       projeção pequena, sempre carregável
  knowledge.db            fatos, evidências, lessons e recipes
  history.db              projeção reconstruível das runs + FTS5
  learned/                recipes versionadas
```

Requer Node.js `>=22.13.0`, `node:sqlite` e FTS5; o preflight valida essa capacidade.

## Regra de prova

Somente fatos `VALIDATED` entram em `project-memory.md`. Fontes aceitas:

- `FILE` ou `CONTRACT` existente dentro do projeto, com SHA-256;
- `TEST` com status positivo;
- `RUN_EVENT` durável;
- declaração explícita `USER`.

Uma fonte alterada torna o fato `STALE`. Valores conflitantes para a mesma seção/chave ficam `CONFLICT` e são excluídos. Fatos podem ser `REVOKED` e pinados. Inferência provável nunca entra na memória.

## Bootstrap antes da classificação

```bash
node "${CLAUDE_SKILL_DIR}/scripts/orchestrator-knowledge.mjs" init --root .
node "${CLAUDE_SKILL_DIR}/scripts/inspect-project.mjs" --root . --persist-knowledge
node "${CLAUDE_SKILL_DIR}/scripts/orchestrator-knowledge.mjs" audit --root .
```

Leia `project-memory.md` junto com PRD/handoff antes de gerar `tasks-classification.md`. A projeção é limitada por quantidade/tamanho; detalhes antigos permanecem pesquisáveis, não no prompt permanente.

## Comandos de fatos

```bash
node "${CLAUDE_SKILL_DIR}/scripts/orchestrator-knowledge.mjs" fact-add \
  --section Conventions --key JsonCasing --value camelCase \
  --source-type FILE --source-ref src/Api/Program.cs
node "${CLAUDE_SKILL_DIR}/scripts/orchestrator-knowledge.mjs" fact-list
node "${CLAUDE_SKILL_DIR}/scripts/orchestrator-knowledge.mjs" fact-revoke --id <id> --reason <motivo>
node "${CLAUDE_SKILL_DIR}/scripts/orchestrator-knowledge.mjs" fact-pin --id <id>
```

Os scripts `inspect-project`, `inspect-contract` e `collect-test-results` podem materializar fatos quando executados com `--persist-knowledge`; os dois últimos só registram contratos válidos/testes passando.

## History + FTS5

`history.db` não é uma segunda fonte de verdade. O projector idempotente lê `state.json`, `events.jsonl` e artefatos das runs e popula:

```text
runs tasks events evidence failures solutions reviews models agents documents
```

`documents_fts` usa FTS5 e triggers de sincronização. O banco pode ser apagado e reconstruído:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/orchestrator-knowledge.mjs" history-project --rebuild
node "${CLAUDE_SKILL_DIR}/scripts/orchestrator-knowledge.mjs" history-search "NU1301"
node "${CLAUDE_SKILL_DIR}/scripts/orchestrator-knowledge.mjs" history-browse
```

Projete a run depois de cada tick terminal/review e antes da Fase 12. Use busca para decisões já vistas; não injete o histórico completo no contexto.
