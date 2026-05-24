# Relatorio de implementacao - <NOME DA MUDANCA>

> Entregavel obrigatorio. Salve em `implementation-report.md` na raiz de execucao do agente (diretorio de trabalho atual no momento de invocar o orchestrador).

## 1. Resumo executivo

<2-4 frases>

## 2. Objetivo da mudanca

<texto>

## 3. Preflight

- `status:` `<ok|failed>`
- `autoRemediation.attempted:` `<true|false>`
- `autoRemediation.changed:` `<true|false>`
- `autoRemediation.action:` `<none|created-settings-json|updated-settings-json|blocked-...>`
- `autoRemediation.revalidated:` `<true|false>`

## 4. Artefatos OpenSpec utilizados

- `openspec/changes/<nome>/proposal.md`
- `openspec/changes/<nome>/design.md`
- `openspec/changes/<nome>/tasks.md`
- `openspec/changes/<nome>/tasks-classification.md`
- `openspec/changes/<nome>/waves.md`
- `openspec/changes/<nome>/contracts/`
- `openspec/changes/<nome>/monitoring.md`
- `openspec/changes/<nome>/review-entendimento.md`
- `openspec/changes/<nome>/review-final.md`
- `workflow-log.md` *(raiz de execucao)*
- `subagents-context.md` *(raiz de execucao)*
- `implementation-report.md` *(raiz de execucao)*

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
- Modelo: AGY (`gemini-3.1-pro-low` ou `gemini-3.5-flash-medium`)

### Review pos-implementacao
- Modelo: Codex padrao da conta ou fallback interno do orquestrador
- Effort: High

## 6. Tasks executadas

Para cada task:

- categoria;
- `contractRequired`;
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

## 8. Decisoes tecnicas

- `<decisao>`: `<motivo>`

## 9. Ajustes apos review

- `<ajuste>` - driver: `<fase 4 | fase 12>`

## 10. Riscos identificados

- `<risco>`

## 11. Resumo dos subagentes

| Task | Subagent type | Modelo | Status | Resumo | Riscos |
|---|---|---|---|---|---|
| `<T1>` | `codex:codex-rescue` | `Codex padrao da conta` | `<status>` | `<resumo>` | `<riscos>` |

## 11a. Uso de tokens por agente

> Valores reportados pelos subagentes. Use `N/A` quando o agente nao informou ou a plataforma nao expoe o dado.

| Agente | Tipo | Task | Input | Output | Cache Read | Total |
|---|---|---|---|---|---|---|
| Orquestrador | Claude Sonnet 4.6 | (coordenacao) | `<N>` | `<N>` | `<N>` | `<N>` |
| `<agente>` | `<codex|gemini>` | `<task>` | `<N>` | `<N>` | `<N>` | `<N>` |
| **TOTAL** | — | — | `<N>` | `<N>` | `<N>` | `<N>` |

## 12. Testes e validacoes

- build;
- testes;
- validacao manual;
- validacao de wire format;
- validacao de serializacao;
- typecheck/lint.

## 13. Criterios de aceite

- [ ] `<criterio>`

## 14. Instrucoes de negocio para o usuario

### O que mudou para o negocio
<texto>

### Como homologar
<texto>

### Regras e limites
<texto>

### Impactos operacionais
<texto>

### Proximo passo recomendado
<texto>

## 15. Pendencias

- `<pendencia>` ou `Nenhuma`

## 16. Review final

- origem: `<Codex | fallback interno do orquestrador>`
- arquivo: `review-final.md`
- houve `QUOTA_EXHAUSTED` no review Codex?: `<sim|nao>`

## 17. Conclusao

<pronto para merge | pronto para homologacao | bloqueado>
