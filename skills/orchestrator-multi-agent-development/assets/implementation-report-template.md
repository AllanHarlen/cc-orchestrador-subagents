# Relatório de implementação - <NOME DA MUDANÇA>

## 1. Resumo executivo

<2-4 frases>

- **Run ID / revisão final:** `<runId>` / `<revision>`
- **Retomadas:** `<N>`
- **Última fase segura / wave final:** `<lastSafePhase>` / `<currentWave>`
- **Integridade do estado:** `<PASS | FAIL>`
- **Completion audit / Phase 12:** `<complete=true|false>` / `<DONE|status>`
- **Project Memory / history / telemetry:** `<audit>` / `<projectedAt>` / `<eventCount>`

## 2. Objetivo da mudança

<texto>

## 3. Preflight

- `status:` `<ok|failed>`
- `autoRemediation.attempted:` `<true|false>`
- `autoRemediation.changed:` `<true|false>`
- `autoRemediation.action:` `<none|created-settings-json|updated-settings-json|blocked-...>`
- `autoRemediation.revalidated:` `<true|false>`

## 4. Artefatos utilizados

- especificação fonte (PRD/spec): `<caminho>`
- `.orchestration/<nome>/tasks-classification.md`
- `.orchestration/<nome>/waves.md`
- `.orchestration/<nome>/contracts/`
- `.orchestration/<nome>/monitoring.md`
- `.orchestration/<nome>/review-final.md` (review back-end)
- `.orchestration/<nome>/review-frontend.md` (review front-end)
- `.orchestration/<nome>/workflow-log.md`
- `.orchestration/<nome>/subagents-context.md`
- `.orchestration/<nome>/state.json`
- `.orchestration/<nome>/events.jsonl`
- `.orchestration/<nome>/learning-report.md`
- `.orchestration/<nome>/evidence/`
- `.orchestrator/project-memory.md` (projecao validada usada na classificacao)
- `.orchestrator/history.db` / `.orchestrator/telemetry.jsonl` (projecoes cross-run)

## 5. Agentes utilizados

### Orquestrador
- Modelo: Claude Sonnet 4.6
- Effort: Medium

### Back-end
- Modelo: Codex padrao da conta
- Effort: Medium

### Front-end
- Agente: AGY (`cc-antigravity-plugin:antigravity-coder`, com `--model <agyModel>`)
- Fan-out: `<agyParallel: yes|no>` — subagentes Gemini nativos: `<N | N/A>` | Conversation IDs: `<lista | N/A>`

### Review back-end pos-implementação
- Agente: Codex padrao da conta (`codex:codex-rescue`) ou fallback interno do orquestrador
- Effort: High
- Escopo: somente back-end

### Review front-end pos-implementação
- Agente: AGY (`cc-antigravity-plugin:antigravity-agent`, `--model gemini-3.1-pro-high`) ou fallback interno do orquestrador
- Escopo: somente front-end

## 6. Tasks executadas

Para cada task:

- categoria;
- `contractRequired`;
- `assignedAgent`;
- execucao (`--effort` no Codex; AGY com `--model <agyModel>`);
- model source/evidence (`user|heuristic|adaptive`, `agyModelEvidence`);
- resultado de `validate-routing.mjs`;
- evidence plan (`expectedFiles`, `validationPlan`) e `allowedPaths`;
- worktree/branch/base/head/integration e lease;
- attempt history, executor result persistido e evidence IDs;
- status;
- agentes;
- arquivos alterados;
- testes;
- limites de sandbox Codex se houver;
- pendencias.

## 7. Contratos implementados

Para cada contrato:

- endpoint;
- metodo;
- wire format;
- casing JSON;
- exemplos completos;
- validacao de serializacao real contra TypeScript.

## 8. Decisões técnicas

- `<decisao>`: `<motivo>`

## 9. Ajustes após review

- `<ajuste>` - driver: `<fase 8 (review back-end) | fase 9 (review front-end)>`

## 10. Riscos identificados

- `<risco>`

## 10a. Bloqueios operacionais

- Sandbox Codex: `<nenhum | rede externa bloqueada | pacote ausente no cache | escrita fora do working directory | N/A>`
- Evidencia: `<comando/erro/caminho ou N/A>`
- Decisao do usuario: `<texto ou N/A>`

## 11. Resumo dos subagentes

| Task | Subagent type | Execucao | Fan-out | Status | Resumo | Riscos |
|---|---|---|---|---|---|---|
| `<T1>` | `codex:codex-rescue` | `<--effort medium/high \| AGY --model <agyModel> [--parallel]>` | `<N subagentes \| N/A>` | `<status>` | `<resumo>` | `<riscos>` |

## 12. Validações

> Nem o orquestrador nem os subagentes geram projeto/suite de testes automatizados como entregavel desta execucao. A validacao de que cada requisito foi implementado corretamente esta na secao 13 (Criterios de aceite), verificada por review de codigo — nao aqui.

- build;
- validacao manual;
- validacao de wire format;
- validacao de serializacao;
- typecheck/lint.
- `inspect-diff` / `validate-task-scope`;
- `inspect-api-ui` / `validate-wire-format`;
- resultados condensados em `.orchestration/<nome>/evidence/`.

## 13. Matriz de rastreabilidade (RF/CA → evidência)

> Obrigatoria. Cobre **todo** `RF`/`CA` do PRD/spec ingerido no escopo desta execucao — nao apenas uma amostra. Um `RF` sem linha aqui e uma lacuna nao declarada.

| RF | CA | Task(s) | Evidência (arquivo:linha ou trecho) | Status |
|---|---|---|---|---|
| `<RF-01>` | `<CA-01>` | `<T1, T2>` | `<caminho/arquivo.ext:linha ou trecho que satisfaz o criterio>` | `<implementado \| parcial \| pendente>` |

Regras:

- **`// TODO`, `NotImplementedException`, placeholder de texto fixo ou stub vazio no caminho de um `RF` do escopo e achado BLOQUEANTE**, nao uma nota de rodapé — trate como reprovação no review (Fase 8/9), nao apenas como "lacuna conhecida" registrada e esquecida.
- Status `parcial` ou `pendente` exige uma linha em "Lacunas conhecidas" explicando o motivo e se foi decisão consciente (com aprovação do usuário) ou pendência real.
- Esta matriz e a fonte usada pelas Fases 8/9 para a checagem "cada CA validado por inspecao direta do codigo" — monte-a **durante a integração (Fase 7)**, não retroativamente ao fechar o relatório.

## 14. Instruções de negócio para o usuário

### O que mudou para o negócio
<texto>

### Como homologar
<texto>

### Regras e limites
<texto>

### Impactos operacionais
<texto>

### Próximo passo recomendado
<texto>

## 15. Pendências

- `<pendencia>` ou `Nenhuma`

## 16. Review final

### Review back-end
- origem: `<Codex | fallback interno do orquestrador | N/A (sem back-end)>`
- arquivo: `review-final.md`
- decisão: `<APROVADO | APROVADO_COM_RESSALVAS | REPROVADO | N/A>`
- houve `QUOTA_EXHAUSTED` no review Codex?: `<sim|nao>`

### Review front-end
- origem: `<AGY gemini-3.1-pro-high | fallback interno do orquestrador | N/A (sem front-end)>`
- arquivo: `review-frontend.md`
- decisão: `<APROVADO | APROVADO_COM_RESSALVAS | REPROVADO | N/A>`
- houve `QUOTA_EXAUSTED`/`AUTH_REQUIRED`/`AGY_MISSING`/`TIMEOUT` no review AGY?: `<sim|nao>`

## 17. Estado persistente, observabilidade e learning

### Completion gates

| Gate | Required | Status | Evidence / waiver |
|---|---:|---|---|
| `backendReview` | `<bool>` | `<status>` | `<id>` |
| `frontendReview` | `<bool>` | `<status>` | `<id>` |
| `browserE2E` | `<bool>` | `<status>` | `<id ou motivo arquitetural>` |
| `reports` | `true` | `<status>` | `<id>` |
| `handoff` | `true` | `<status>` | `<id>` |
| `delivery` | `true` | `<status>` | `<id>` |
| `learning` | `true` | `<status>` | `<id>` |

- Lifecycle adapter/probes: `<resumo>`
- Worktrees integradas/conflitos/cleanup: `<resumo>`
- Telemetria privacy-first: `<task outcomes / attempts / routing decisions>`
- Router adaptativo: `<decisoes e strata | nao usado por amostra insuficiente>`
- Candidate lessons: `<N>`; promovidas automaticamente: `0`
- Recipes consultadas/aplicadas/outcomes: `<lista | nenhuma>`
- Curator: `<dry-run/status/contradicoes/backups>`
- History projetado apos `RUN_STATUS_UPDATED(DONE)`: `<sim|nao>`

## 18. Conclusão

<pronto para merge | pronto para homologacao | bloqueado>
