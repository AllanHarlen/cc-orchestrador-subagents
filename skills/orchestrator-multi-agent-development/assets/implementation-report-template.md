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

## 4. Artefatos OpenSpec utilizados

- `proposal.md`
- `design.md`
- `tasks.md`
- `tasks-classification.md`
- `waves.md`
- `contracts/`
- `monitoring.md`
- `review-codex.md`
- `review-final.md`
- `workflow-log.md`
- `subagents-context.md`

## 5. Agentes utilizados

### Orquestrador
- Modelo: Claude Sonnet 4.6
- Effort: Medium

### Review de plano
- Modelo: Codex padrao da conta
- Effort: High

### Back-end
- Modelo: Codex padrao da conta
- Effort: Medium

### Front-end
- Agente: AGY (`cc-antigravity-plugin:antigravity-agent`, sem `--model`)

### Review pos-implementação
- Modelo: Codex padrao da conta ou fallback interno do orquestrador
- Effort: High

## 6. Tasks executadas

Para cada task:

- categoria;
- `contractRequired`;
- `assignedAgent`;
- execucao (`--effort` no Codex; AGY sem `--model`);
- resultado de `validate-routing.mjs`;
- status;
- agentes;
- arquivos alterados;
- testes;
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

- `<ajuste>` - driver: `<fase 4 | fase 12>`

## 10. Riscos identificados

- `<risco>`

## 11. Resumo dos subagentes

| Task | Subagent type | Execucao | Status | Resumo | Riscos |
|---|---|---|---|---|---|
| `<T1>` | `codex:codex-rescue` | `<--effort medium/high | AGY sem --model>` | `<status>` | `<resumo>` | `<riscos>` |

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

- origem: `<Codex | fallback interno do orquestrador>`
- arquivo: `review-final.md`
- houve `QUOTA_EXHAUSTED` no review Codex?: `<sim|nao>`

## 17. Conclusão

<pronto para merge | pronto para homologacao | bloqueado>
