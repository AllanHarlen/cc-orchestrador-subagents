# Relatório de implementação - <NOME DA MUDANÇA>

## 1. Resumo executivo

<2-4 frases>

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
- `orchestration/<nome>/tasks-classification.md`
- `orchestration/<nome>/waves.md`
- `orchestration/<nome>/contracts/`
- `orchestration/<nome>/monitoring.md`
- `orchestration/<nome>/review-final.md` (review back-end)
- `orchestration/<nome>/review-frontend.md` (review front-end)
- `workflow-log.md`
- `subagents-context.md`

## 5. Agentes utilizados

### Orquestrador
- Modelo: Claude Sonnet 4.6
- Effort: Medium

### Back-end
- Modelo: Codex padrao da conta
- Effort: Medium

### Front-end
- Agente: AGY (`cc-antigravity-plugin:antigravity-agent`, com `--model <agyModel>`)
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
- resultado de `validate-routing.mjs`;
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

## 12. Testes e validações

- build;
- testes;
- validacao manual;
- validacao de wire format;
- validacao de serializacao;
- typecheck/lint.

## 13. Critérios de aceite

- [ ] `<criterio>`

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

## 17. Conclusão

<pronto para merge | pronto para homologacao | bloqueado>
