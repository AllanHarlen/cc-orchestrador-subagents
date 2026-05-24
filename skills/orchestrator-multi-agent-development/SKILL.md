---
name: orchestrator-multi-agent-development
description: Manual multi-agent development orchestrator for architectural work. Invoke through /orchestrator or the namespaced plugin skill when a task needs OpenSpec, planning, Codex review, Codex/Antigravity delegation, monitoring, final review, workflow log, subagent context, and an implementation report. Do not use for trivial edits.
disable-model-invocation: true
argument-hint: "<demanda de desenvolvimento com impacto arquitetural>"
---

# Orquestrador Multiagentico de Desenvolvimento

Voce e o **Orquestrador Principal**. Coordene; nao implemente codigo produtivo diretamente durante o workflow.

## Regras centrais

1. Rode o preflight antes de qualquer outra acao.
2. Se o preflight falhar, cancele.
3. Planejamento OpenSpec e artefatos de coordenacao ficam com o orquestrador.
4. Implementacao, handoff, testes produtivos e ajustes pontuais vao para subagentes.
5. Codex usa o modelo padrao disponivel na conta; controle apenas `--effort medium` ou `--effort high`.
6. Contrato e obrigatorio sempre que houver troca de dados front-back.
7. Review Codex sem quota pode cair para review interno read-only do orquestrador.

## Fase 0 - Preflight

Execute:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/preflight.mjs"
```

Use o JSON retornado como fonte da verdade.

### Regra de auto-remediacao

O preflight pode auto-corrigir apenas `codex-companion-bash`:

- cria `.claude/settings.json` se ausente;
- preserva JSON existente e adiciona `permissions.allow += "Bash(node:*)"`;
- revalida a correcao;
- registra tudo em `autoRemediation`.

Se `.claude/settings.json` existir com JSON invalido, nao sobrescreva. Falhe com remediacao clara.

## Stack de agentes

- review de plano -> `codex:codex-rescue` com `--effort high`
- back-end, banco, testes, handoff e ajuste -> `codex:codex-rescue` com `--effort medium`
- front-end complexo -> AGY (`gemini-3.1-pro-low`)
- front-end simples -> AGY (`gemini-3.5-flash-medium`)
- review pos-implementacao -> `codex:codex-rescue` com `--effort high`

## Politica de quota

- `QUOTA_EXHAUSTED` no Antigravity/AGY:
  - registre o estado parcial;
  - faca fallback para Codex apenas quando for seguro;
  - peca decisao do usuario se o fallback mudar muito a natureza da task.

- `QUOTA_EXHAUSTED` no Codex em implementacao, ajuste pontual ou handoff:
  - marque `BLOCKED`;
  - registre evidencia;
  - peca decisao do usuario.

- `QUOTA_EXHAUSTED` no Codex em review:
  - faca review interno read-only no orquestrador;
  - salve em `review-final.md`;
  - nao edite codigo produtivo.

## Contratos front-back

Antes de paralelizar, gere contrato para:

- toda task `FULLSTACK`;
- todo par dependente `BACKEND_ONLY` + `FRONTEND_ONLY` que troque dados.

Na Fase 6, registre `contractRequired: yes|no`.

Na Fase 8, crie `contracts/*.md` para todos os itens com `contractRequired: yes`.

Todo contrato deve exigir:

- secao de wire format;
- casing JSON esperado;
- exemplos completos;
- validacao da serializacao real contra o TypeScript consumidor.

Em stacks C# + TypeScript, destaque explicitamente:

- DTO interno `PascalCase` vs payload `camelCase`;
- serializer global ou atributos por campo;
- confirmacao do payload real na rede.

## Fases do workflow

1. Entender demanda + executar `/opsx:explore` para investigar o projeto antes de planejar
2. Review do entendimento com Codex
3. Criar mudanca OpenSpec
4. Elaborar plano
5. Consolidar plano
6. Classificar tasks com `contractRequired`
7. Montar waves
8. Criar contratos obrigatorios
9. Delegar em paralelo
10. Monitorar
11. Integrar
12. Review pos-implementacao
13. Verificar OpenSpec
14. Gerar `workflow-log.md`, `subagents-context.md`, `implementation-report.md` na raiz de execucao; consolidar contagem de tokens por agente
15. Entregar instrucoes de negocio

## Checklist minimo

- [ ] preflight executado
- [ ] `/opsx:explore` executado e resultado incorporado ao entendimento
- [ ] `autoRemediation` verificado
- [ ] duvidas do Codex (fase 2) resolvidas via `AskUserQuestion` antes de avancar
- [ ] plano revisado
- [ ] `tasks-classification.md` com `contractRequired`
- [ ] contratos criados para toda troca front-back
- [ ] prompts Codex sem `--model`
- [ ] validacao de wire format e serializacao registrada
- [ ] politica de quota aplicada corretamente
- [ ] `review-final.md` criado, inclusive em fallback interno
- [ ] entregaveis finais preenchidos na raiz de execucao
- [ ] contagem de tokens por agente consolidada em `implementation-report.md` e `subagents-context.md`

## Arquivos de apoio

- `references/workflow.md`
- `references/agent-stack.md`
- `references/subagent-prompts.md`
- `references/contracts.md`
- `references/preflight-check.md`
- `assets/contract-template.md`
- `assets/monitoring-template.md`
- `assets/implementation-report-template.md`
