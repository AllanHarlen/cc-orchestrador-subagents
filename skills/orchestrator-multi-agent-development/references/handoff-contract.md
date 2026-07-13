# Handoff Contract — Pensador → Orchestrador → Executor

Contrato de atuacao conjunta entre os tres plugins do workflow de desenvolvimento. Define os papeis de cada estagio, como cada um publica seus artefatos e como o estagio seguinte os descobre, le e confia neles. **Este documento e identico nos tres plugins** (`cc-pensador`, `cc-orchestrador-subagents`, `cc-executor-subagents`) e e a **fonte da verdade** do handoff. Qualquer alteracao aqui deve ser replicada verbatim nos tres repositorios.

`HANDOFF_VERSION = 1`.

---

## 1. Cadeia do workflow e papeis

```text
Pensador               Orchestrador                   Executor
(PENSA)         ─────▶  (CONSTROI)             ─────▶  (CORRIGE + AJUSTES FINOS)
PRD / Spec /            planeja, delega e              review plano-vs-entrega,
Open Design             implementa em ondas            correcoes e validacao final
.pensador/              .orchestration/                .executor/
```

| Estagio | Papel | Verbo | Responsabilidade central |
|---|---|---|---|
| **Pensador** (`cc-pensador`) | Pensa | Elaborar | Transforma a demanda em PRD ou Spec (OpenSpec) + artefatos de produto, arquitetura, contrato de API e design (Open Design). Nao implementa codigo. |
| **Orchestrador** (`cc-orchestrador-subagents`) | Constroi | Implementar | Ingere os artefatos do Pensador (ou um PRD/spec avulso), classifica tasks, monta ondas, gera contratos front-back, delega a Codex/AGY em paralelo, integra e revisa. Usado para **desenvolvimento complexo**. |
| **Executor** (`cc-executor-subagents`) | Corrige e faz os ajustes finos | Refinar/validar | Ingere a entrega do Orchestrador como baseline, faz review plano-vs-entrega (Codex high), aplica correcoes, hotfixes, ajustes finos e validacao. Usado para **features pequenas, hotfix e o polimento final** do que o Orchestrador construiu. |

Cada estagio e **produtor** para o proximo e **consumidor** do anterior. Nenhum estagio reabre o trabalho do anterior: ele **confia**, referencia e produz a sua propria camada.

---

## 2. Modos de operacao: independente e conjunto

Cada plugin funciona **isoladamente** (recebendo a demanda direto do usuario) **ou em conjunto** (consumindo o `handoff.json` do estagio anterior). O `handoff.json` upstream e o unico sinal que distingue os dois modos.

| Plugin | Modo independente (sem upstream) | Modo conjunto (com upstream) |
|---|---|---|
| **Pensador** | `/pensador <demanda>` — sempre a origem da cadeia. `upstream = null`. | — (primeiro estagio, nunca tem upstream) |
| **Orchestrador** | `/orquestrador "Desenvolva um CRUD de clientes"` — o usuario fornece a demanda/PRD/spec direto (via `@arquivo` ou texto). O orquestrador trata o texto/arquivo como fonte da verdade. | Detecta `.pensador/*/handoff.json` (`stage: pensador`, `status: DONE`) e ingere PRD/Spec + contrato + design como fonte da verdade, sem re-planejar. Ver secao 7. |
| **Executor** | `/executor <demanda de resolucao rapida>` — feature pequena ou hotfix, com ou sem plano pre-definido no proprio enunciado. | Detecta `.orchestration/<slug>/handoff.json` (`stage: orchestrador`) e o adota como **plano pre-definido baseline** para review plano-vs-entrega, correcoes e ajustes finos. Ver secao 7. |

Regra de deteccao (consumidor): antes de tratar a demanda como independente, procure o `handoff.json` do estagio anterior (secao 7). Se existir e estiver `DONE`, entre em **modo conjunto**; se nao existir, siga **independente**. Em duvida (varios slugs/versoes), confirme via `AskUserQuestion`.

---

## 3. Raizes de artefatos (todas ocultas, com ponto)

| Estagio | Raiz | Identidade |
|---|---|---|
| Pensador | `.pensador/<slug>-vN/` | `slug` + versao local `-vN` |
| Orchestrador | `.orchestration/<slug>/` | `slug` (sem versao) |
| Executor | `.executor/<demanda_slug>/artefatos/` | `demanda_slug` da demanda de review |

Regra absoluta: **nenhum artefato `.md`/`.json` de coordenacao na raiz do projeto**. Tudo vive sob a raiz oculta do estagio. Excecao unica: o change set do OpenSpec (`openspec/changes/<nome>/`), que e gerido pelos comandos `openspec-*` e vive na arvore padrao do OpenSpec — o `handoff.json` o referencia como caminho relativo ao projeto (ver secao 5).

### Correlacao por `slug`

O `slug` e a chave que liga os tres estagios. Deriva da demanda original (kebab-case, sem acentos). O Pensador acrescenta `-vN`; o Orchestrador e o Executor usam o `slug` base (sem `-vN`). Exemplo real:

```text
.pensador/locadora-veiculos-multitenant-v1/   (slug = locadora-veiculos-multitenant, v1)
.orchestration/locadora-veiculos-multitenant/ (mesmo slug, sem versao)
.executor/review-locadora-veiculos-.../        (demanda_slug proprio do review)
```

---

## 4. Manifesto de handoff: `handoff.json`

Cada produtor grava um `handoff.json` na raiz da sua pasta de artefatos ao concluir. Esse arquivo e a **ancora unica de descoberta**: o consumidor le o `handoff.json` do estagio anterior antes de qualquer outra coisa.

### Envelope comum

```json
{
  "handoffVersion": 1,
  "stage": "pensador | orchestrador | executor",
  "slug": "locadora-veiculos-multitenant",
  "producer": { "plugin": "cc-pensador", "version": "2.9.0" },
  "artifactRoot": ".pensador/locadora-veiculos-multitenant-v1",
  "artifactMode": "prd | spec",
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
- `artifactMode` (`prd` ou `spec`) so e emitido pelo Pensador; propaga o formato base para os consumidores.
- `artifacts[].path` e **relativo a `artifactRoot`**, exceto entradas explicitamente marcadas como relativas ao projeto (ex.: `openspec-change`).
- `artifacts[].role` segue o vocabulario por estagio (secao 5).
- `status: BLOCKED` ou `PARTIAL` deve trazer `summary` explicando o bloqueio; o consumidor entao pergunta ao usuario antes de prosseguir.

O consumidor nunca adivinha caminhos: descobre tudo via `handoff.json`. Se o `handoff.json` estiver ausente (execucao de versao antiga), faz fallback para descoberta por convencao (secao 7) e avisa o usuario.

---

## 5. Vocabulario de `role` por estagio

### Pensador (`stage: pensador`)
| role | arquivo padrao | required |
|---|---|---|
| `prd` | `prd.md` | sim (modo PRD) |
| `userhistory` | `userhistory.md` | sim (modo PRD) |
| `architecture` | `architecture.md` | quando houver ARCH |
| `api-contract` | `openapi.yaml` / `schema.graphql` / `service.proto` / `asyncapi.yaml` | quando `backendConfirmed` — **fonte da verdade** maquina-legivel (formato por `state.apiStyle`). Carrega `validation` (`{ spec, mock, validate }`) para o consumidor subir mock (fluxo paralelo front/back) e validar o codigo contra o contrato no CI ("a spec e lei"). |
| `communication-contract` | `communication.md` | quando `backendConfirmed` — **visao legivel derivada** do `api-contract` (`derivedFrom` aponta o arquivo fonte). Nao e a fonte da verdade. |
| `design-system` | `design-system.md` | **somente no fallback** (front-end sem Open Design) — DESIGN.md inline das 9 secoes. Quando o Open Design e usado, o `DESIGN.md` verbatim (role `design-system-files`) substitui este doc. |
| `design-system-files` | `design-systems/<id>/` | quando `hasFrontend` **e** um system foi selecionado — **uma entrada por `<id>` concreto** (de `state.designSystems`), relativa ao `artifactRoot` (`.pensador/<slug>-vN/`), com os arquivos verbatim (`tokens.css`, `DESIGN.md`, `components.html`, `preview/`, …). Cada entrada carrega `materializeInto` (o alvo em `state.uiPackageDir`, ex.: `packages/ui/design-systems/<id>/`) que o Orchestrador/Executor usa ao materializar os arquivos na arvore de codigo real (secao 6). |
| `openspec-change` | `openspec/changes/<nome>/` | quando `artifactMode = spec` — change set OpenSpec (`proposal.md`, `design.md`, `tasks.md`, `specs/`). **Caminho relativo ao projeto**, nao ao `artifactRoot` (gerido pelos comandos `openspec-*`). Substitui `prd`/`userhistory`/`communication-contract` no modo Spec. |
| `codebase-memory` | `codebase-memory.md` | opcional |
| `shared-agents` | `shared-agents/` | opcional |

### Orchestrador (`stage: orchestrador`)
| role | arquivo padrao | required |
|---|---|---|
| `implementation-report` | `implementation-report.md` | sim |
| `tasks-classification` | `tasks-classification.md` | sim |
| `waves` | `waves.md` | sim |
| `api-contracts` | `contracts/` | quando houver troca front-back |
| `review-final` | `review-final.md` | sim (back-end; N/A se nao houver) |
| `review-frontend` | `review-frontend.md` | quando houver front |
| `monitoring` | `monitoring.md` | sim |
| `workflow-log` | `workflow-log.md` | sim |
| `subagents-context` | `subagents-context.md` | sim |
| `openspec-change` | `openspec/changes/<nome>/` | quando OpenSpec for usado (relativo ao projeto) |

### Executor (`stage: executor`)
| role | arquivo padrao | required |
|---|---|---|
| `initial-plan-baseline` | `initial-plan-baseline.md` | quando houver plano pre-definido (inclui a entrega do Orchestrador em modo conjunto) |
| `execution-brief` | `execution-brief.md` | quando 2+ agentes |
| `plan-vs-output-review` | `plan-vs-output-review.md` | quando houver plano pre-definido |
| `implementation-report` | `implementation-report.md` | sim |
| `workflow-log` | `workflow-log.md` | sim |
| `subagents-context` | `subagents-context.md` | sim |
| `monitoring` | `monitoring.md` | sim |
| `screenshots` | `screenshots/` | quando houver validacao visual |

---

## 6. Open Design: contrato visual e materializacao

Quando o Pensador tem front-end, o Open Design produz **arquivos verbatim** (nao prosa): `tokens.css` (fonte de verdade do estilo), `DESIGN.md` (9 secoes), `components.html` (fixtures) e `preview/` (sanity check visual — os arquivos variam por system: `colors.html`, `spacing.html`, `typography.html`). Esses arquivos sao um **contrato visual**, nao decoracao.

### Ciclo de vida dos arquivos de design

```text
Pensador                              Orchestrador / Executor
grava VERBATIM em                     MATERIALIZA em (via materializeInto)
.pensador/<slug>-vN/                  packages/ui/design-systems/<id>/
  design-systems/<id>/                  (ou src/styles/… em app unico)
    tokens.css                        e CARREGA os caminhos no prompt de
    DESIGN.md                         toda task front-end + usa no gate de
    components.html                   design da fase de review.
    preview/
```

- O Pensador **nunca** escreve na arvore de codigo real; persiste os arquivos dentro da pasta da feature. Cada entrada `design-system-files` do `handoff.json` carrega `materializeInto` com o alvo real.
- O **Orchestrador** (modo conjunto ou quando recebe design via PRD/spec) **materializa** os arquivos em `materializeInto`, passa `tokens.css`/`components.html`/`DESIGN.md` (ou `design.md` + `specs/ui-design-system/spec.md` no modo Spec) e o diretorio `preview/` no prompt de toda task front-end, e aplica o **gate de design** no review: `tokens.css` consumido via `var(--*)` (nunca hex literal), accent contido (≤ 2x por pagina), telas-chave conferidas contra `preview/`, anti-padroes da secao 9 do DESIGN.md ausentes. Violacao de requisito explicito e **BLOQUEANTE**.
- O **Executor** consome o mesmo contrato visual ao corrigir/ajustar o front-end: nao reinventa tokens, respeita `tokens.css` e valida a fidelidade contra `preview/`.
- Regra inviolavel herdada do Open Design: **never invent new tokens.** Divergencia justificada vira override documentado (na secao *Decisions* do `design.md` no modo Spec, ou nota no `handoff.json` no modo PRD), nunca um valor solto no `theme.ts`.

---

## 7. Descoberta pelo consumidor (fallback sem `handoff.json`)

### Orchestrador ingere Pensador (modo conjunto)
1. Procure `.pensador/*/handoff.json`. Para multiplos `slug`, confirme com o usuario qual demanda implementar via `AskUserQuestion`.
2. Para o mesmo `slug` com varias versoes `-vN`, **use a maior versao** (mais recente). Confirme via `AskUserQuestion` se houver duvida.
3. Sem `handoff.json`: leia `.pensador/<slug>-vN/.pensador-progress.json` (`checkpointVersion: 2`) e o array `artifacts`.
4. **Modo PRD** — ingira na ordem: `prd` → `userhistory` → `architecture` → `api-contract` → `communication-contract` → `design-system`/`design-system-files`. Use o `api-contract` (maquina-legivel) como **fonte da verdade** dos contratos API/UI da Fase 4 — suba o mock a partir dele e valide contra ele no CI (campo `validation`); o `communication-contract` e apenas a visao legivel. Trate o PRD/spec como **fonte da verdade**: **nao** reabra discovery nem replaneje.
5. **Modo Spec (OpenSpec)** — a `role` `openspec-change` aponta `openspec/changes/<nome>/`. Ingira `proposal.md`, `design.md`, `specs/` e `tasks.md`; derive a classificacao de tasks a partir de `tasks.md` preservando IDs/ordem. O contrato de API esta dobrado em `design.md` + `specs/` (nao ha `api-contract` standalone).
6. **Design (Open Design), quando houver front-end** — materialize os arquivos verbatim de `design-system-files` conforme secao 6 e trate-os como contrato visual do front-end. Se so houver o fallback `design-system.md` (sem Open Design), use-o como referencia inline.

### Executor ingere Orchestrador (modo conjunto)
1. Procure `.orchestration/<slug>/handoff.json`.
2. Adote a entrega do Orchestrador como **plano pre-definido baseline**: registre `plano_predefinido: true`, preserve o conteudo relevante em `{artefatos_dir}/initial-plan-baseline.md` e execute o review plano-vs-entrega (Codex high) comparando o baseline com o estado atual do codigo. As correcoes e ajustes finos derivam desse review.
3. Sem `handoff.json`: leia `.orchestration/<slug>/implementation-report.md` + `tasks-classification.md` + `waves.md` + `contracts/`.
4. Para rastreabilidade, siga `upstream` ate o `handoff.json` do Pensador e use o `prd`/`api-contract`/`communication-contract` como baseline de referencia do review; use `design-system-files` como criterio visual dos ajustes de front-end.
5. Registre as fontes em `plano_predefinido_fonte` e `plano_predefinido` no `.executor/checkpoint.json`.

---

## 8. Regras de confianca e versao

- O consumidor **confia** nos artefatos `DONE` do produtor sem reimplementar o trabalho dele.
- `handoffVersion` diferente da suportada: avise o usuario e degrade para descoberta por convencao.
- O produtor nunca escreve dentro da raiz de outro estagio.
- O consumidor nunca edita artefatos do produtor; ele referencia e produz os seus.
- Quando `status: BLOCKED` no upstream, o consumidor para e pede decisao do usuario antes de prosseguir.
- Este arquivo e a fonte da verdade do handoff e deve permanecer **byte-identico** nos tres plugins.
