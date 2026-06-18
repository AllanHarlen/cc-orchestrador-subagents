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
6. AGY recebe `--model <agyModel>` no bridge do plugin; o bridge aplica isso via `~/.gemini/antigravity-cli/settings.json` sem repassar a flag para o binario `agy`.
7. Contrato e obrigatorio sempre que houver troca de dados front-back.
8. Review Codex sem quota pode cair para review interno read-only do orquestrador.
9. O roteamento de implementacao e decidido pela **categoria da task**, nao pela aparencia do trabalho. Toda task `FRONTEND_ONLY` vai para Antigravity/AGY; Codex so assume front-end em fallback operacional registrado.
10. Limites de sandbox Codex como rede externa bloqueada, pacote ausente do cache local ou escrita fora do working directory permitido sao bloqueios operacionais: registre evidencia e peca decisao do usuario.
11. `--parallel` e `--subagent-model` sao **modificadores de execucao** da delegacao AGY, nao criterios de roteamento. A categoria da task continua decidindo o agente; o fan-out nativo Gemini e apenas uma otimizacao interna da sessao AGY.
12. Ajustes Obrigatorios marcados como "hipotese nao verificavel" na Fase 2 exigem investigacao de codigo (Read/Grep nos arquivos relevantes) antes de avancar para Fase 3 — nenhuma hipotese fica travada como verdade no `design.md` sem evidencia do repositorio.
13. Antes de delegar para AGY, monte o prompt completo e meça os caracteres. Se exceder 28.000 chars, divida a task em subtasks por entregaveis antes de delegar — nunca envie prompt acima do limite.
14. Quando toda a atividade for `FRONTEND_ONLY` (todas as tasks classificadas como tal), o Codex nao participa do fluxo: a Fase 2 e substituida por review interno do orquestrador e a Fase 12 nao delega para Codex — o orquestrador faz review interno read-only diretamente.
15. **Ingestao upstream (Pensador):** antes de planejar, procure artefatos do Pensador em `.pensador/<slug>-vN/` e ingira-os conforme `references/handoff-contract.md`. O PRD/Spec, a arquitetura e o `comunication_json.md` do Pensador sao a fonte de verdade do plano; nao reabra decisoes ja fechadas pelo Pensador sem decisao explicita do usuario.
16. **Raiz de artefatos:** todos os artefatos de coordenacao e entregaveis finais do orquestrador ficam sob `.orchestration/<slug>/` (raiz oculta, com ponto). Nunca grave artefatos de coordenacao na raiz do projeto. Specs do OpenSpec continuam sob `openspec/changes/<nome>/`; os artefatos de coordenacao e o `handoff.json` ficam em `.orchestration/<slug>/`.

## Fase 0 - Preflight

Execute:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/preflight.mjs"
```

Use o JSON retornado como fonte da verdade.

Se a execucao foi iniciada com `--agy-model <modelo>`, valide a allowlist e preserve a escolha como override do usuario. Caso contrario, o orquestrador deve atribuir `agyModel` por heuristica:

- `gemini-3.5-flash-medium` por padrao;
- `gemini-3.1-pro-low` para tasks front-end complexas, multi-rota, multi-arquivo, com contrato API/UI delicado ou risco alto de regressao;
- `gemini-3.1-pro-high` apenas em casos criticos.

**Heuristica de fan-out (agyParallel):**

- Se a execucao foi iniciada com `--agy-parallel`, registre `agyParallel: yes` e `agyParallelSource: user` em todas as tasks AGY.
- Se a execucao foi iniciada com `--agy-subagent-model <modelo>`, valide o modelo contra a allowlist, registre `agySubagentModel: <modelo>` e ligue `agyParallel: yes` automaticamente.
- Caso contrario, avalie por heuristica: se uma task `FRONTEND_ONLY` ou a fatia front-end de `FULLSTACK` lista **dois ou mais entregaveis independentes** nos criterios de aceite — e nenhum deles compartilha arquivo central, depende de contrato pendente ou schema em mudanca —, registre `agyParallel: yes` e `agyParallelSource: heuristic`.
- `agySubagentModel` padrao: `inherit` (omite `--subagent-model`; subagentes usam o mesmo `agyModel` da sessao principal).

### Regra de auto-remediacao

O preflight pode auto-corrigir apenas `codex-companion-bash`:

- cria `.claude/settings.json` se ausente;
- preserva JSON existente e adiciona `permissions.allow += "Bash(node:*)"`;
- revalida a correcao;
- registra tudo em `autoRemediation`.

Se `.claude/settings.json` existir com JSON invalido, nao sobrescreva. Falhe com remediacao clara.

## Fase 0.5 - Ingestao de artefatos do Pensador (upstream)

Execute logo apos o preflight e antes de entender a demanda. Esta fase aplica o `references/handoff-contract.md` no papel de **consumidor** do estagio Pensador.

1. **Descobrir o handoff.** Procure `.pensador/*/handoff.json`.
   - Se houver varios `slug` distintos, use `AskUserQuestion` para confirmar qual demanda implementar.
   - Para o mesmo `slug` com varias versoes `-vN`, escolha a **maior versao** (mais recente); confirme via `AskUserQuestion` se houver duvida.
   - Se nao houver `handoff.json` (execucao Pensador antiga), faca fallback: leia `.pensador/<slug>-vN/.pensador-progress.json` e use o array `artifacts`.
   - Se nao houver nenhum diretorio `.pensador/`, registre que a demanda e greenfield (sem upstream) e siga para a Fase 1 normalmente.
2. **Validar versao.** Se `handoffVersion` for diferente de `1`, avise o usuario e degrade para descoberta por convencao.
3. **Ingerir na ordem:** `prd` → `userhistory` → `architecture` → `communication-contract`. Trate `prd`/`userhistory` como o escopo aprovado, `architecture` como restricoes alvo e `communication-contract` (`comunication_json.md`) como **base obrigatoria dos contratos API/UI da Fase 8**.
4. **Derivar `slug` e raiz.** Adote o `slug` base do handoff (sem `-vN`) como identidade do orquestrador. Toda a coordenacao vai para `.orchestration/<slug>/`.
5. **Respeitar decisoes upstream.** Nao reabra decisoes de produto/arquitetura ja fechadas pelo Pensador sem decisao explicita do usuario. Se o `status` do handoff do Pensador for `BLOCKED` ou `PARTIAL`, pare e peca decisao ao usuario antes de planejar.
6. **Registrar a fonte.** Anote em `monitoring.md` e no `handoff.json` final o `artifactRoot` do Pensador ingerido (campo `upstream`).

## Stack de agentes

- review de plano -> `codex:codex-rescue` com `--effort high`
- back-end, banco, testes, handoff e ajuste -> `codex:codex-rescue` com `--effort medium`
- front-end, incluindo setup Vite/React, rotas, servicos API, tipos TypeScript, componentes e UX -> AGY com `--model <agyModel>` escolhido por override do usuario ou heuristica
- review pos-implementacao -> `codex:codex-rescue` com `--effort high`

## Politica de sandbox Codex

Trate como `BLOCKED` operacional no Codex:

- restore/instalacao de pacotes sem acesso a rede externa, como NuGet `NU1301` em `https://api.nuget.org/v3/index.json`;
- pacote necessario ausente do cache local;
- `UnauthorizedAccessException` ou erro equivalente ao escrever fora do working directory permitido.

Nao tente contornar o sandbox com retries longos, troca arbitraria de ferramenta ou escrita em caminho alternativo fora do escopo. Registre a evidencia em `monitoring.md`, `workflow-log.md` e `subagents-context.md`, depois peca decisao do usuario. Para UI sem dependencia de rede, preserve AGY como executor primario.

## Politica de quota

- `QUOTA_EXAUSTED` no Antigravity/AGY:
  - registre o estado parcial;
  - faca fallback para Codex apenas quando for seguro;
  - peca decisao do usuario se o fallback mudar muito a natureza da task.
- `AUTH_REQUIRED` no Antigravity/AGY:
  - marque bloqueio operacional;
  - oriente o usuario a rodar `agy` interativamente uma vez;
  - mantenha a evidencia em `monitoring.md`.
- `AGY_MISSING` no Antigravity/AGY:
  - marque bloqueio operacional;
  - registre a remediacao de instalacao;
  - nao redelegue sem decisao consciente.
- `TIMEOUT` no Antigravity/AGY:
  - registre evidencia operacional;
  - ajuste timeout, escopo ou decomposicao da task antes de repetir.

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

0.5. Ingerir artefatos do Pensador em `.pensador/<slug>-vN/` (handoff upstream)
1. Entender demanda + executar `/opsx:explore` para investigar o projeto antes de planejar
2. Review do entendimento com Codex
3. Criar mudanca OpenSpec
4. Elaborar plano
5. Consolidar plano
6. Classificar tasks com `contractRequired`
7. Montar waves
8. Validar roteamento e criar contratos obrigatorios
9. Delegar em paralelo
10. Monitorar
11. Integrar
12. Review pos-implementacao
13. Verificar OpenSpec
14. Gerar `workflow-log.md`, `subagents-context.md`, `implementation-report.md` e `handoff.json` em `.orchestration/<slug>/`; consolidar contagem de tokens por agente
15. Entregar instrucoes de negocio

## Checklist minimo

- [ ] preflight executado
- [ ] artefatos do Pensador ingeridos de `.pensador/<slug>-vN/` (ou registrado greenfield sem upstream)
- [ ] `communication-contract` do Pensador usado como base dos contratos da Fase 8 (quando houver back-end)
- [ ] `/opsx:explore` executado e resultado incorporado ao entendimento
- [ ] duvidas pendentes do `/opsx:explore` resolvidas via `AskUserQuestion` antes de avancar para 1.2
- [ ] `autoRemediation` verificado
- [ ] atividade classificada como FRONTEND_ONLY na Fase 1 → Codex excluido do fluxo (fases 2 e 12 com review interno); caso contrario, seguir fluxo normal com Codex
- [ ] duvidas do Codex (fase 2) resolvidas via `AskUserQuestion` antes de avancar (N/A se FRONTEND_ONLY)
- [ ] hipoteses nao verificaveis dos Ajustes Obrigatorios (fase 2) investigadas no repositorio (Read/Grep) antes de escrever `design.md` (N/A se FRONTEND_ONLY)
- [ ] plano revisado
- [ ] `tasks-classification.md` com `contractRequired`
- [ ] `tasks-classification.md` e `waves.md` com agente derivado da categoria
- [ ] `validate-routing.mjs` executado antes da delegacao
- [ ] contratos criados para toda troca front-back
- [ ] prompts Codex sem `--model`
- [ ] prompts AGY com `--model <agyModel>` coerente com override ou heuristica
- [ ] prompts AGY verificados contra o limite de 28.000 chars antes da delegacao; tasks que excedem foram divididas em subtasks por entregaveis
- [ ] tasks AGY com dois ou mais entregaveis independentes registram `agyParallel` e `agyParallelSource`
- [ ] `agySubagentModel` (quando diferente de `inherit`) esta na allowlist de modelos AGY
- [ ] bloqueios de sandbox Codex tratados como `BLOCKED` com evidencia
- [ ] validacao de wire format e serializacao registrada
- [ ] politica de quota aplicada corretamente
- [ ] `review-final.md` criado, inclusive em fallback interno
- [ ] entregaveis finais preenchidos em `.orchestration/<slug>/`
- [ ] `handoff.json` gravado em `.orchestration/<slug>/` para consumo do Executor
- [ ] contagem de tokens por agente consolidada em `implementation-report.md` e `subagents-context.md`
- [ ] `tasks-classification.md` e `waves.md` registram `agyModel` e `agyModelSource` nas tasks AGY

## Arquivos de apoio

- `references/handoff-contract.md`
- `references/workflow.md`
- `references/agent-stack.md`
- `references/subagent-prompts.md`
- `references/contracts.md`
- `references/preflight-check.md`
- `assets/contract-template.md`
- `assets/monitoring-template.md`
- `assets/implementation-report-template.md`
