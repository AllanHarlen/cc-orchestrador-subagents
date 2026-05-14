# Relatório de Implementação — <NOME DA MUDANÇA>

> Entregável final obrigatório. Salve em `openspec/changes/<nome>/implementation-report.md`.

## 1. Resumo Executivo

<2-4 frases. O que foi entregue, qual o impacto, qual o status (pronto para merge, homologação, ajustes pendentes).>

## 2. Objetivo da Mudança

<Problema resolvido ou melhoria entregue. Pode replicar o "Objetivo" do proposal.md.>

## 3. Artefatos OpenSpec Utilizados

- `openspec/changes/<nome>/proposal.md`
- `openspec/changes/<nome>/design.md`
- `openspec/changes/<nome>/tasks.md`
- `openspec/changes/<nome>/specs/` (lista de specs deltas)
- `openspec/changes/<nome>/contracts/` (lista de contratos por task FULLSTACK)
- `openspec/changes/<nome>/monitoring.md`
- `openspec/changes/<nome>/review-codex.md` (review do plano)
- `openspec/changes/<nome>/review-final.md` (review pós-implementação)

## 4. Agentes Utilizados

### Orquestrador
- **Modelo:** Claude Sonnet 4.6
- **Effort:** Medium
- **Papel:** coordenação, decisão, consolidação e relatório

### Planejamento
- **Modelo:** Claude Sonnet 4.6
- **Effort:** High
- **Subagent type:** `Plan`
- **Papel:** elaboração do plano inicial OpenSpec

### Review de Plano
- **Modelo:** Codex gpt-5.5
- **Effort:** High
- **Subagent type:** `codex:codex-rescue`
- **Papel:** revisão crítica do plano antes da execução

### Back-end
- **Modelo:** Codex gpt-5.4
- **Effort:** Medium
- **Subagent type:** `codex:codex-rescue`
- **Skills referenciadas:** <ex.: csharp-pro, dotnet-backend-patterns, postgresql>
- **Papel:** implementação back-end

### Front-end
- **Modelo:** Gemini 3 / Gemini 3 Flash (conforme complexidade)
- **Subagent type:** `cc-gemini-plugin:gemini-agent`
- **Skills referenciadas:** frontend-developer, ui-ux-designer (+ accessibility quando aplicável)
- **Papel:** implementação de UI

### Review pós-implementação
- **Modelo:** Codex gpt-5.5
- **Effort:** High
- **Subagent type:** `codex:codex-rescue`
- **Papel:** validação final antes do merge

## 5. Tasks Executadas

### Task T1 — <Nome>
- **Categoria:** <FULLSTACK / BACKEND_ONLY / ...>
- **Status:** Concluída
- **Agentes:**
  - <agente 1>
  - <agente 2, se houver>
- **Resumo:** <2-4 linhas>
- **Arquivos alterados:**
  - `<caminho>`
  - `<caminho>`
- **Testes:**
  - <teste>: <resultado>
- **Pendências:** <nenhuma | lista>

### Task T2 — <Nome>
- ...

## 6. Contratos Implementados

### Contrato T1 — <endpoint>
- **Método:** <GET/POST/...>
- **URL:** `<...>`
- **Request:** <resumo>
- **Response:** <resumo>
- **Validações:** <resumo>
- **Permissões:** <resumo>

### Contrato T2 — ...

## 7. Decisões Técnicas

> Listar decisões importantes tomadas durante a implementação. Para cada uma: contexto, opções consideradas, escolha, motivo.

- **<decisão>**: <descrição curta>
  - Contexto: <...>
  - Opções: <a, b, c>
  - Escolha: <a>
  - Motivo: <...>

## 8. Ajustes Realizados Após Review

> Mudanças feitas após revisão do Codex (fase 4) e após review pós-implementação (fase 12).

- <ajuste 1> — driver: <fase 4 / fase 12>
- <ajuste 2> — driver: <...>

## 9. Riscos Identificados

> Riscos remanescentes que valem destaque para quem for fazer merge/deploy.

- <risco> — probabilidade <baixa/média/alta>, impacto <baixo/médio/alto>, mitigação proposta: <...>

## 10. Testes e Validações

| Tipo | Status | Observação |
|---|---|---|
| Build back-end | ✅ / ❌ | <...> |
| Build front-end | ✅ / ❌ | <...> |
| Testes unitários | ✅ / ❌ | <cobertura, n. de testes> |
| Testes de integração | ✅ / ❌ | <...> |
| Testes e2e | ✅ / ❌ | <...> |
| Validação manual | ✅ / ❌ | <quem validou, em que ambiente> |
| Validação visual | ✅ / ❌ | <screenshots ou link> |
| Lint / typecheck | ✅ / ❌ | <...> |
| Security check | ✅ / ❌ | <...> |

## 11. Critérios de Aceite

> Replicar do proposal.md e marcar status.

- [x] <critério 1>
- [x] <critério 2>
- [ ] <critério pendente — motivo + plano>

## 12. Pendências

> Pendências reais. Se nada, escreva "Nenhuma".

- <pendência 1> — owner: <quem> — prazo: <quando>
- <pendência 2> — ...

## 13. Conclusão

> Informar se a mudança está pronta para:
> - merge na main;
> - homologação;
> - ajustes pendentes (e quais).

<Frase final.>

---

## Apêndice A — Comandos OpenSpec executados

```
/openspec-new-change <nome>
/openspec-ff-change <nome>
... (planejamento e implementação)
/openspec-verify-change <nome>
/openspec-sync-specs <nome>          # se aplicável
/openspec-archive-change <nome>
```

## Apêndice B — Comandos de subagente disparados

| Fase | Subagent type | Modelo | Prompt resumido |
|---|---|---|---|
| 3 | `Plan` | Claude Sonnet 4.6 High | gerar plano OpenSpec |
| 4 | `codex:codex-rescue` | Codex gpt-5.5 high | revisão do plano |
| 9 | `codex:codex-rescue` × N | Codex gpt-5.4 medium | implementações back-end |
| 9 | `cc-gemini-plugin:gemini-agent` × N | Gemini 3 / 3 Flash | implementações front-end |
| 12 | `codex:codex-rescue` | Codex gpt-5.5 high | review pós-implementação |
