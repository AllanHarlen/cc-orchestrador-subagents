# Handoff Contract — Pensador → Orchestrador → Executor

Contrato de comunicacao entre os tres plugins do workflow de desenvolvimento. Define como cada estagio publica seus artefatos e como o estagio seguinte os descobre, le e confia neles. Este documento e identico nos tres plugins (`cc-pensador`, `cc-orchestrador-subagents`, `cc-executor-subagents`) e e a fonte da verdade do handoff.

`HANDOFF_VERSION = 1`.

---

## 1. Cadeia do workflow

```text
Pensador            Orchestrador                 Executor
(PRD/Spec)   ─────▶ (planeja + implementa) ─────▶ (review + valida)
.pensador/          .orchestration/              .executor/
```

- **Pensador** gera o PRD/Spec e artefatos de produto/arquitetura.
- **Orchestrador** ingere os artefatos do Pensador, planeja, delega e implementa.
- **Executor** ingere os artefatos do Orchestrador (e, por rastreabilidade, do Pensador), faz review plano-vs-entrega e validacao.

Cada estagio e **produtor** para o proximo e **consumidor** do anterior.

---

## 2. Raizes de artefatos (todas ocultas, com ponto)

| Estagio | Raiz | Identidade |
|---|---|---|
| Pensador | `.pensador/<slug>-vN/` | `slug` + versao local `-vN` |
| Orchestrador | `.orchestration/<slug>/` | `slug` (sem versao) |
| Executor | `.executor/<demanda_slug>/artefatos/` | `demanda_slug` da demanda de review |

Regra absoluta: nenhum artefato `.md`/`.json` de coordenacao na raiz do projeto. Tudo vive sob a raiz oculta do estagio.

### Correlacao por `slug`

O `slug` e a chave que liga os tres estagios. Deriva da demanda original (kebab-case, sem acentos). O Pensador acrescenta `-vN`; o Orchestrador e o Executor usam o `slug` base (sem `-vN`). Exemplo real:

```text
.pensador/locadora-veiculos-multitenant-v1/   (slug = locadora-veiculos-multitenant, v1)
.orchestration/locadora-veiculos-multitenant/ (mesmo slug, sem versao)
.executor/review-locadora-veiculos-.../        (demanda_slug proprio do review)
```

---

## 3. Manifesto de handoff: `handoff.json`

Cada produtor grava um `handoff.json` na raiz da sua pasta de artefatos ao concluir. Esse arquivo e a **ancora unica de descoberta**: o consumidor le o `handoff.json` do estagio anterior antes de qualquer outra coisa.

### Envelope comum

```json
{
  "handoffVersion": 1,
  "stage": "pensador | orchestrador | executor",
  "slug": "locadora-veiculos-multitenant",
  "producer": { "plugin": "cc-pensador", "version": "2.5.1" },
  "artifactRoot": ".pensador/locadora-veiculos-multitenant-v1",
  "status": "DONE | PARTIAL | BLOCKED",
  "createdAt": "2026-06-18T15:40:00.000Z",
  "updatedAt": "2026-06-18T15:40:00.000Z",
  "summary": "Resumo de 1-3 frases do que foi produzido.",
  "upstream": {
    "stage": "pensador",
    "handoffPath": ".pensador/<slug>-vN/handoff.json"
  },
  "artifacts": [
    { "role": "prd", "path": "prd.md", "required": true, "description": "PRD/Spec consolidado" }
  ],
  "nextStage": {
    "consumer": "cc-orchestrador-subagents",
    "entrypoint": "/orchestrador",
    "instructions": "Ingerir os artefatos e implementar o plano."
  }
}
```

- `upstream` e `null` no Pensador (primeiro estagio).
- `artifacts[].path` e **relativo a `artifactRoot`**.
- `artifacts[].role` segue o vocabulario por estagio (secao 4).
- `status: BLOCKED` ou `PARTIAL` deve trazer `summary` explicando o bloqueio; o consumidor entao pergunta ao usuario antes de prosseguir.

O consumidor nunca adivinha caminhos: descobre tudo via `handoff.json`. Se o `handoff.json` estiver ausente (execucao de versao antiga), faz fallback para descoberta por convencao (secao 5) e avisa o usuario.

---

## 4. Vocabulario de `role` por estagio

### Pensador (`stage: pensador`)
| role | arquivo padrao | required |
|---|---|---|
| `prd` | `prd.md` | sim |
| `userhistory` | `userhistory.md` | sim |
| `architecture` | `architecture.md` | quando houver ARCH |
| `communication-contract` | `comunication_json.md` | quando `backendConfirmed` |
| `codebase-memory` | `codebase-memory.md` | opcional |
| `shared-agents` | `shared-agents/` | opcional |

### Orchestrador (`stage: orchestrador`)
| role | arquivo padrao | required |
|---|---|---|
| `implementation-report` | `implementation-report.md` | sim |
| `tasks-classification` | `tasks-classification.md` | sim |
| `waves` | `waves.md` | sim |
| `api-contracts` | `contracts/` | quando houver troca front-back |
| `review-final` | `review-final.md` | sim |
| `review-frontend` | `review-frontend.md` | quando houver front |
| `monitoring` | `monitoring.md` | sim |
| `workflow-log` | `workflow-log.md` | sim |
| `subagents-context` | `subagents-context.md` | sim |
| `openspec-change` | `openspec/changes/<nome>/` | quando OpenSpec for usado |

### Executor (`stage: executor`)
| role | arquivo padrao | required |
|---|---|---|
| `initial-plan-baseline` | `initial-plan-baseline.md` | quando houver plano pre-definido |
| `execution-brief` | `execution-brief.md` | quando 2+ agentes |
| `plan-vs-output-review` | `plan-vs-output-review.md` | quando houver plano pre-definido |
| `implementation-report` | `implementation-report.md` | sim |
| `workflow-log` | `workflow-log.md` | sim |
| `subagents-context` | `subagents-context.md` | sim |
| `monitoring` | `monitoring.md` | sim |
| `screenshots` | `screenshots/` | quando houver validacao visual |

---

## 5. Descoberta pelo consumidor (fallback sem `handoff.json`)

### Orchestrador ingere Pensador
1. Procure `.pensador/*/handoff.json`. Para multiplos `slug`, confirme com o usuario qual demanda implementar.
2. Para o mesmo `slug` com varias versoes `-vN`, **use a maior versao** (mais recente). Confirme via `AskUserQuestion` se houver duvida.
3. Sem `handoff.json`: leia `.pensador/<slug>-vN/.pensador-progress.json` (`checkpointVersion: 2`) e o array `artifacts`.
4. Ingira na ordem: `prd` → `userhistory` → `architecture` → `communication-contract`. Use o `communication-contract` como base dos contratos API/UI da Fase 8.

### Executor ingere Orchestrador
1. Procure `.orchestration/<slug>/handoff.json`.
2. Sem `handoff.json`: leia `.orchestration/<slug>/implementation-report.md` + `tasks-classification.md` + `waves.md` + `contracts/`.
3. Para rastreabilidade, siga `upstream` ate o `handoff.json` do Pensador e use o `prd`/`communication-contract` como baseline do review plano-vs-entrega.
4. Registre as fontes em `plano_predefinido_fonte` no `.executor/checkpoint.json`.

---

## 6. Regras de confianca e versao

- O consumidor **confia** nos artefatos `DONE` do produtor sem reimplementar o trabalho dele.
- `handoffVersion` diferente da suportada: avise o usuario e degrade para descoberta por convencao.
- O produtor nunca escreve dentro da raiz de outro estagio.
- O consumidor nunca edita artefatos do produtor; ele referencia e produz os seus.
- Quando `status: BLOCKED` no upstream, o consumidor para e pede decisao do usuario antes de prosseguir.
