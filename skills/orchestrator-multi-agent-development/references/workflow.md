# Workflow detalhado por fase

Este arquivo expande as fases do `SKILL.md`.

O orquestrador atua somente em projetos com PRD/especificacao ja pronta, em desenvolvimento complexo. Ele nao faz discovery, nao cria plano OpenSpec e nao reabre o entendimento da demanda. Todos os artefatos de coordenacao ficam em `.orchestration/<nome>/`, onde `<nome>` e um identificador descritivo em kebab-case: em **modo conjunto** e o `<slug>` do Pensador (sem `-vN`); em **modo independente** e derivado do PRD. Ver `references/handoff-contract.md`.

## Fase 0 - Preflight

Rode:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/preflight.mjs"
```

Regras:

- se `status=failed`, cancele;
- `autoRemediation` existe para registrar se `.claude/settings.json` foi criado ou atualizado para adicionar `Bash(node:*)`;
- a auto-remediacao so vale para `codex-companion-bash`;
- se `.claude/settings.json` existir com JSON invalido, nao sobrescreva; falhe com remediacao clara.

## Fase 1 - Ingestao da especificacao

A especificacao chega por **duas vias** (ver `references/handoff-contract.md`). Antes de tratar a demanda como avulsa, detecte o modo.

### 1.0 Detectar modo de operacao (conjunto vs independente)

1. Procure `.pensador/*/handoff.json`.
2. **Modo conjunto (Pensador → Orchestrador):** se houver um handoff `stage: pensador` com `status: DONE`:
   - Para multiplos `slug`, confirme via `AskUserQuestion` qual demanda implementar.
   - Para o mesmo `slug` com varias versoes `-vN`, use a maior versao (confirme se houver duvida).
   - Leia o `handoff.json` e trate os artefatos referenciados como fonte da verdade. Correlacione pelo `slug` e grave seus artefatos em `.orchestration/<slug>/` (sem `-vN`).
   - `status: BLOCKED`/`PARTIAL` no upstream: pare e peca decisao ao usuario.
   - Sem `handoff.json` mas com `.pensador/<slug>-vN/`: fallback por convencao — leia `.pensador-progress.json` (`checkpointVersion: 2`) e o array `artifacts`; avise o usuario.
3. **Modo independente:** sem `.pensador/`, o usuario fornece a especificacao via `@arquivo` ou texto no `/orquestrador`. `<nome>`/`<slug>` derivam do PRD.

### 1.1 Ler a especificacao fornecida

- Em modo conjunto, ingira os artefatos do Pensador na ordem do handoff contract (secao 7):
  - **Modo PRD:** `prd` → `userhistory` → `architecture` → `api-contract` → `communication-contract` → `design-system`/`design-system-files`.
  - **Modo Spec (OpenSpec):** ingira o change set em `openspec/changes/<nome>/` (`proposal.md`, `design.md`, `specs/`, `tasks.md`); derive as tasks de `tasks.md` preservando IDs/ordem.
- Em modo independente, leia o arquivo de PRD/spec apontado pelo usuario com `Read`. Se o usuario apontar varios arquivos ou um diretorio de specs, leia todos os relevantes.
- Nao reescreva, nao replaneje e nao reinterprete a demanda. O papel do orquestrador e **orquestrar**, nao planejar.
- **Contrato de API:** quando houver `api-contract` (maquina-legivel), ele e a **fonte da verdade** dos contratos da Fase 4 — suba o mock a partir dele e valide o codigo contra ele (campo `validation`). O `communication-contract` e apenas a visao legivel.
- **Design (Open Design):** quando houver `design-system-files`, guarde os caminhos verbatim e o `materializeInto` de cada `<id>` para materializar na Fase 4 (ver Fase 4).

### 1.2 Extrair os entregaveis e tasks

A partir da especificacao, extraia diretamente:

- objetivos e entregaveis ja definidos;
- tasks, fases ou ordem de implementacao quando o PRD ja as trouxer;
- decisoes tecnicas firmes (arquitetura, bibliotecas, endpoints, telas, contratos, migrations);
- restricoes de escopo, agente, tecnologia ou arquivo;
- criterios de aceite, testes esperados e validacoes obrigatorias.

Quando o PRD ja lista tasks, preserve IDs, nomes e ordem para rastreabilidade. Quando o PRD descreve entregaveis sem IDs formais, derive uma lista de tasks objetiva a partir do texto, sem inventar escopo novo.

### 1.3 Lacunas bloqueantes

Se a especificacao tiver uma lacuna que impeca classificar e delegar com seguranca (ex.: contrato de dados ausente entre front e back, decisao tecnica obrigatoria nao tomada), use `AskUserQuestion` para resolver apenas a lacuna bloqueante. Nao transforme isso em discovery aberto — pergunte o minimo necessario para destravar a orquestracao e registre a resposta.

Ao final da Fase 1, o orquestrador deve conseguir produzir `tasks-classification.md` diretamente a partir da especificacao ingerida.

## Fase 2 - Classificacao das tasks

Para cada task extraida do PRD/spec, registre em `.orchestration/<nome>/tasks-classification.md`:

- categoria;
- dependencias;
- arquivos criticos;
- complexidade;
- `contractRequired: yes|no`;
- `assignedAgent`;
- `routingReason`.

### Regra de roteamento por categoria

A categoria da task e a fonte da verdade para escolher agente. Nao reclassifique pelo tipo de atividade interna. Setup de projeto front-end, rotas, servicos API em TypeScript, componentes, paginas, hooks, estado e UX continuam sendo `FRONTEND_ONLY` e vao para Antigravity/AGY.

| Categoria | `assignedAgent` | Execucao |
|---|---|---|
| `BACKEND_ONLY` | `codex:codex-rescue` | `--effort medium` |
| `DATABASE_ONLY` | `codex:codex-rescue` | `--effort medium` |
| `TEST_ONLY` | `codex:codex-rescue` | `--effort medium` |
| `REVIEW_ONLY` | `codex:codex-rescue` | `--effort high` |
| `FRONTEND_ONLY` | `cc-antigravity-plugin:antigravity-agent` | AGY com `--model <agyModel>` |
| `FULLSTACK` | `codex:codex-rescue` + `cc-antigravity-plugin:antigravity-agent` | Codex para back-end; AGY com `--model <agyModel>` para front-end |

Se `FRONTEND_ONLY` aparecer com Codex como agente primario, corrija antes de montar waves. Codex so pode assumir front-end depois de `QUOTA_EXAUSTED`, `AUTH_REQUIRED`, `AGY_MISSING`, `TIMEOUT`, falha operacional de AGY ou decisao explicita do usuario, e isso deve ficar registrado em `monitoring.md`, `workflow-log.md` e `subagents-context.md`.

### Regra de `agyParallel`

Para tasks `FRONTEND_ONLY` ou fatia front-end de `FULLSTACK`, avalie se ha dois ou mais entregaveis independentes nos criterios de aceite. Se sim, prefira **uma** task com `agyParallel: yes` em vez de N tasks AGY separadas. Registre em `tasks-classification.md`:

- `agyParallel: yes|no`
- `agyParallelSource: user|heuristic` (quando `yes`)
- `agySubagentModel: <modelo>|inherit`

Condicoes para `agyParallel: yes`: entregaveis listados nos criterios de aceite sao independentes, nenhum toca arquivo central compartilhado, contrato nao esta pendente, schema nao esta mudando.

### Regra de `contractRequired`

Marque `yes` sempre que houver troca de dados front-back, mesmo que uma task esteja classificada como `BACKEND_ONLY` e outra como `FRONTEND_ONLY`.

Exemplos:

- endpoint novo consumido por tela -> `yes`;
- mudanca de payload, filtros, paginacao, validacao ou erro -> `yes`;
- ajuste puramente visual sem tocar API -> `no`.

## Fase 3 - Ondas

Agrupe tasks em `.orchestration/<nome>/waves.md`.

Cada entrada de `waves.md` deve repetir `assignedAgent` vindo de `tasks-classification.md`. Depois de montar as waves, rode:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/validate-routing.mjs" ".orchestration/<nome>"
```

Se o validador falhar, corrija `tasks-classification.md` e `waves.md` antes de qualquer delegacao.

Nao paralelize quando houver:

- contrato pendente;
- schema indefinido;
- arquivo central compartilhado;
- autenticacao ou seguranca sem consolidacao.

## Fase 4 - Contratos API/UI e materializacao de design

### 4.0 Materializar arquivos de design (Open Design)

Quando a ingestao trouxe `design-system-files` (ou um `design-system.md` com diretorio verbatim):

- Copie os arquivos verbatim de cada `<id>` (`.pensador/<slug>-vN/design-systems/<id>/`) para o alvo real indicado em `materializeInto` (ex.: `packages/ui/design-systems/<id>/`, ou `src/styles/…` em app unico). Ver `references/handoff-contract.md` secao 6.
- Nao reescreva `tokens.css`, `DESIGN.md`, `components.html` nem `preview/`: eles sao consumidos verbatim.
- Guarde os caminhos materializados para carregar no prompt de **toda task front-end** (Fase 5) e para o gate de design da Fase 9.
- No modo Spec, o design chega em `design.md` + `specs/ui-design-system/spec.md`: use-os como requisito normativo do gate.

### 4.1 Contratos

Crie `.orchestration/<nome>/contracts/*.md` para:

- toda task `FULLSTACK`;
- todo par dependente `BACKEND_ONLY` + `FRONTEND_ONLY` que troque dados entre si.

Todo contrato deve conter:

- endpoint e metodo;
- wire format;
- casing JSON esperado;
- exemplos completos de request/response;
- status codes;
- estados de UI;
- permissoes;
- validacoes;
- comprovacao de serializacao real contra TypeScript.

### Regra especial para C# e TypeScript

Quando houver DTO C# e consumidor TypeScript:

- explicite se o DTO interno esta em `PascalCase`;
- explicite se o JSON exposto deve sair em `camelCase`;
- documente serializer global ou atributos por campo;
- nao aceite "bate com a interface" sem verificar o payload real.

## Fase 5 - Delegacao paralela

Antes de lancar subagentes, confirme que `validate-routing.mjs` passou. A delegacao precisa seguir `assignedAgent` dos artefatos validados.

### Regra de limite de prompt AGY (28.000 chars)

Antes de delegar qualquer task para AGY, monte o prompt completo seguindo o template de `subagent-prompts.md` e conte os caracteres do texto montado.

**Threshold:** 28.000 chars. Prompts reais com aspas, barras invertidas, XML e quebras de linha inflariam ~14% na linha de comando codificada pelo Node.js no Windows, causando `ENAMETOOLONG`. O threshold conservador garante margem segura.

Se o prompt montado **exceder 28.000 chars**:

1. Identifique os entregaveis listados nos criterios de aceite da task original.
2. Divida os entregaveis em dois grupos independentes (A e B), priorizando que cada grupo seja coeso e nao dependa do outro para executar.
3. Crie duas subtasks derivadas da original:
   - **Task `<ID>-a`**: herda todos os metadados da task original (categoria, agente, contrato, stack, escopo); `Descricao` e criterios de aceite cobrem apenas o Grupo A.
   - **Task `<ID>-b`**: mesmo metadados; `Descricao` e criterios de aceite cobrem apenas o Grupo B.
4. Atualize `tasks-classification.md` e `waves.md` substituindo a task original pelas duas subtasks; mantenha a mesma wave se forem independentes.
5. Remonte os dois prompts e confirme que cada um esta abaixo de 28.000 chars. Se ainda exceder, repita a divisao.
6. Registre a divisao em `monitoring.md` e `workflow-log.md` com:
   - task original e motivo (prompt excedeu N chars);
   - subtasks geradas e criterios de aceite de cada uma.

**Quando a task nao pode ser dividida por entregaveis** (descricao monolitica indivisivel):

- Reduza `Arquivos e modulos relevantes` ao minimo critico para esta task; mova arquivos secundarios para `Fora do escopo`.
- Se ainda exceder, troque o modelo AGY para `gemini-3.5-flash-low` e registre o motivo em `tasks-classification.md`.
- Se persistir, registre `promptOverflow: true` em `tasks-classification.md` e peca decisao ao usuario antes de delegar.

Para Codex:

- implementacao, handoff e ajuste -> `--effort medium`;
- review -> `--effort high`;
- nao fixe `--model`.
- antes de executar instalacao/restore de pacotes, verifique se a task depende de rede externa ou de cache local; se falhar por rede bloqueada ou pacote ausente, pare como `BLOCKED`.
- se houver erro de permissao ao escrever fora do working directory permitido, pare como `BLOCKED` e reporte o caminho alvo.

Para Antigravity/AGY:

- delegue ao `cc-antigravity-plugin:antigravity-agent`;
- passe `--model <agyModel>` para o bridge do plugin;
- registre `agyModelSource: user|heuristic`;
- quando `agyParallel: yes`, passe tambem `--parallel` ao bridge; quando `agySubagentModel` for diferente de `inherit`, passe `--subagent-model <agySubagentModel>` (implica `--parallel`);
- por padrao (`agySubagentModel: inherit`), omita `--subagent-model`; os subagentes herdam o modelo da sessao AGY principal;
- `--agy-subagent-model` informado pelo usuario liga `--parallel` automaticamente;
- nao trate isso como flag nativa do `agy`, porque o bridge aplica o modelo via `settings.json`.

Cada prompt deve incluir:

- descricao da task;
- contrato quando `contractRequired=yes`;
- escopo permitido;
- wire format;
- regra de validar casing JSON e serializacao.

### Verificacao de skills compativeis

Todo subagente em background deve, como **primeiro passo antes de implementar**, listar as skills disponiveis no ambiente e filtrar as compativeis com sua task:

1. execute `/skills` ou equivalente para listar as skills do ambiente;
2. ignore skills exclusivas do orquestrador (planejamento/coordenacao);
3. das skills restantes, identifique quais se aplicam a task em execucao;
4. use as skills compativeis durante a implementacao;
5. registre no retorno quais skills foram utilizadas (campo obrigatorio no retorno de Codex e Gemini).

O orquestrador consolida as skills utilizadas por subagente em `subagents-context.md`.

## Fase 6 - Monitoramento

Status validos:

- `PENDING`
- `RUNNING`
- `PAUSED`
- `CANCELLED`
- `BLOCKED`
- `NEEDS_SYNC`
- `DONE`
- `FAILED`
- `QUOTA_EXAUSTED` (AGY)
- `QUOTA_EXHAUSTED` (Codex)
- `REVIEWED`

### Politica de quota

- `QUOTA_EXHAUSTED` no Antigravity/AGY:
  - registre evidencia;
  - se o fallback for seguro, redelegue para Codex com `--effort medium`;
  - se mudar muito a natureza da entrega, peca confirmacao do usuario.

- `AUTH_REQUIRED` no Antigravity/AGY:
  - marque `BLOCKED`;
  - registre evidencia;
  - oriente o usuario a rodar `agy` interativamente uma vez.

- `AGY_MISSING` no Antigravity/AGY:
  - marque `BLOCKED`;
  - registre evidencia;
  - publique os passos de instalacao.

- `TIMEOUT` no Antigravity/AGY:
  - registre evidencia;
  - aumente timeout, reduza escopo ou quebre a task antes de insistir.

- `QUOTA_EXHAUSTED` no Codex durante implementacao, ajuste pontual ou handoff:
  - nao tente trocar modelo fixo;
  - marque `BLOCKED`;
  - registre evidencia;
  - peca decisao ao usuario.

- `QUOTA_EXHAUSTED` no Codex durante review back-end:
  - faca review interno read-only no orquestrador;
  - salve o resultado em `review-final.md`;
  - nao edite codigo produtivo.

### Politica de sandbox Codex

- `NU1301`, falha ao acessar registry externo, restore sem rede ou pacote ausente do cache local:
  - marque `BLOCKED`;
  - registre comando, erro e pacote necessario;
  - peca decisao do usuario antes de alterar plano ou dependencia.

- `UnauthorizedAccessException` ou erro equivalente ao escrever fora do working directory permitido:
  - marque `BLOCKED`;
  - registre working directory efetivo e caminho que falhou;
  - peca decisao do usuario para ajustar o diretorio permitido, mover a execucao para a raiz correta ou redefinir o escopo.

- Para UI sem dependencia de rede, mantenha AGY como executor primario. So faca handoff para Codex se o bloqueio AGY estiver documentado e o sandbox Codex permitir a escrita necessaria.

## Fase 7 - Integracao

Valide:

- aderencia a especificacao (PRD/spec) ingerida;
- aderencia ao contrato;
- wire format;
- casing JSON;
- serializacao real;
- arquivos alterados fora do escopo;
- testes e build.

Se precisar ajuste, delegue para Codex com `--effort medium` (back-end) ou AGY (front-end), conforme a categoria.

## Fase 8 - Review back-end pos-implementacao (Codex)

> **Ignorar quando nao houver back-end:** Se nao houver nenhuma task `BACKEND_ONLY`, `DATABASE_ONLY`, `TEST_ONLY` nem fatia back-end de `FULLSTACK`, pule a Fase 8 e registre `review-final.md` com a nota `"Sem back-end: review back-end nao aplicavel"`.

Objetivo da fase: validar a implementacao **back-end** final contra a especificacao, os contratos, as tasks executadas e os retornos dos subagentes. Esta fase e read-only: nao edite codigo durante o review. Codex revisa **apenas back-end** — nunca front-end. Se houver defeitos, volte para a Fase 7 para integrar ajustes ou redelegar correcao.

### 8.1 Preparar pacote de review

Antes de delegar ao Codex ou fazer review interno, monte um pacote de contexto com:

- especificacao original (PRD/spec) ingerida na Fase 1;
- `tasks-classification.md`, `waves.md` e contratos em `contracts/*.md`;
- `monitoring.md`, `workflow-log.md` e `subagents-context.md`;
- resumo dos arquivos back-end alterados;
- comandos de build, testes e validacoes executadas no back-end;
- falhas, bloqueios, fallbacks e decisoes do usuario durante a execucao.

### 8.2 Fluxo principal

- delegue ao Codex com `--effort high`;
- informe que o review e somente leitura e restrito ao back-end (controllers, services, repositorios, DTOs, migrations, testes, contratos do lado servidor);
- exija achados com severidade, arquivo/trecho quando aplicavel, impacto e correcao esperada;
- salve o resultado em `review-final.md`.

O prompt do review back-end deve pedir verificacao explicita de:

- aderencia a especificacao e ao escopo back-end;
- aderencia a cada task e criterio de aceite das tasks back-end;
- contratos API, wire format, status codes, casing JSON e serializacao real no lado servidor;
- auth/autorizacao, validacoes e tratamento de erro no back-end;
- migrations, persistencia, indices e integridade referencial quando houver banco;
- testes executados, lacunas de teste e builds pendentes no back-end;
- arquivos alterados fora do escopo;
- regressao potencial em fluxos existentes do back-end.

### 8.3 Fluxo de fallback

- se o review Codex vier com `QUOTA_EXHAUSTED`, o orquestrador faz review interno read-only do back-end;
- registre no proprio `review-final.md` que o review foi fallback interno do orquestrador por indisponibilidade de quota do Codex;
- mantenha as mesmas secoes obrigatorias do fluxo principal.

### 8.4 Resultado e loop de correcao

`review-final.md` deve terminar com uma decisao:

- `APROVADO`: pode seguir para a Fase 9;
- `APROVADO_COM_RESSALVAS`: pode seguir somente se as ressalvas forem documentadas como nao bloqueantes;
- `REPROVADO`: nao avance; volte para a Fase 7 ou redelegue ajustes ao Codex.

## Fase 9 - Review front-end pos-implementacao (AGY)

> **Ignorar quando nao houver front-end:** Se nao houver nenhuma task `FRONTEND_ONLY` nem fatia front-end de `FULLSTACK`, pule a Fase 9 e registre `review-frontend.md` com a nota `"Sem front-end: review front-end nao aplicavel"`. Se nao existir `review-frontend.md`, basta registrar a ausencia em `workflow-log.md`.

Objetivo da fase: validar a implementacao **front-end** final. O review e feito pelo **AGY** com `--model gemini-3.1-pro-high`, em modo read-only. Codex nunca participa desta fase.

### 9.1 Preparar pacote de review

Monte um pacote de contexto com:

- especificacao original (PRD/spec) ingerida na Fase 1;
- `tasks-classification.md`, `waves.md` e contratos em `contracts/*.md`;
- `subagents-context.md` das tasks front-end;
- resumo dos arquivos front-end alterados;
- comandos de build/typecheck/lint/testes executados no front-end.

### 9.2 Fluxo principal

- delegue ao `cc-antigravity-plugin:antigravity-agent` com `--model gemini-3.1-pro-high`;
- informe que o review e somente leitura — o AGY nao modifica arquivos;
- exija achados com severidade, arquivo/trecho quando aplicavel, impacto e correcao esperada;
- salve o resultado em `review-frontend.md`.

O prompt do review front-end deve pedir verificacao explicita de:

- aderencia a especificacao e ao escopo front-end;
- aderencia a cada task e criterio de aceite das tasks front-end;
- consumo correto do contrato API/UI: wire format, casing JSON e serializacao real contra o TypeScript consumidor;
- estados de UI tratados (loading, erro, empty, sucesso);
- tipagem TypeScript, build, typecheck e lint;
- acessibilidade e consistencia visual quando aplicavel;
- testes de componente/e2e executados e lacunas;
- arquivos alterados fora do escopo;
- regressao potencial em telas/fluxos existentes.

### 9.3 Fluxo de fallback

- se o review AGY vier com `QUOTA_EXAUSTED`, `AUTH_REQUIRED`, `AGY_MISSING` ou `TIMEOUT`, o orquestrador faz review interno read-only do front-end;
- registre em `review-frontend.md` que o review foi fallback interno do orquestrador por indisponibilidade do AGY, com o status cru retornado pelo bridge;
- mantenha as mesmas secoes obrigatorias do fluxo principal.

### 9.4 Resultado e loop de correcao

`review-frontend.md` deve terminar com uma decisao:

- `APROVADO`: pode seguir para a Fase 10;
- `APROVADO_COM_RESSALVAS`: pode seguir somente se as ressalvas forem documentadas como nao bloqueantes;
- `REPROVADO`: nao avance; volte para a Fase 7 e redelegue a correcao ao AGY.

Se houver achados bloqueantes em qualquer das fases de review (8 ou 9):

1. registre os achados em `monitoring.md` e `workflow-log.md`;
2. crie ou atualize tasks de correcao com agente responsavel pela categoria;
3. execute a correcao pela Fase 7;
4. repita o review focando nas areas alteradas e nos achados anteriores.

## Fases 10 e 11 - Relatorio final e handoff

Entregaveis obrigatorios (salve na **raiz de execucao do agente**, `.orchestration/<slug>/`):

- `workflow-log.md`
- `subagents-context.md`
- `implementation-report.md`
- `handoff.json` — manifesto de handoff do estagio orchestrador (ver `references/handoff-contract.md`)

### Gravar `handoff.json` (para o Executor)

Ao fechar, grave `.orchestration/<slug>/handoff.json` com:

- `handoffVersion: 1`, `stage: "orchestrador"`, `slug` (sem `-vN`), `producer` (plugin + version), `artifactRoot: ".orchestration/<slug>"`, `status` (`DONE`/`PARTIAL`/`BLOCKED`), `summary`, timestamps.
- `upstream`: em modo conjunto, aponta o `handoff.json` do Pensador (`.pensador/<slug>-vN/handoff.json`); em modo independente, `null`.
- `artifacts[]`: uma entrada por role do vocabulario Orchestrador (secao 5 do handoff contract) — `implementation-report`, `tasks-classification`, `waves`, `api-contracts`, `review-final`, `review-frontend`, `monitoring`, `workflow-log`, `subagents-context` (+ `openspec-change` quando aplicavel), com `path` relativo ao `artifactRoot`.
- `nextStage`: `consumer: "cc-executor-subagents"`, `entrypoint: "/executor"`, `instructions` orientando review plano-vs-entrega e ajustes finos.

O relatorio final deve citar:

- se houve auto-remediacao no preflight;
- quais contratos foram criados;
- quais validacoes de wire format e serializacao foram feitas;
- se houve fallback de review interno (back-end por `QUOTA_EXHAUSTED` no Codex; front-end por indisponibilidade do AGY);
- para cada delegacao AGY com `agyParallel: yes`: numero de subagentes Gemini nativos e Conversation IDs reportados pelo AGY;
- contagem de tokens por agente (tabela consolidada em `implementation-report.md` secao 11a e em `subagents-context.md` secao "Uso de Tokens por Agente"; quando houver fan-out, os tokens reportados pelo AGY sao o agregado da sessao).

### Contagem de tokens

Cada subagente deve incluir no retorno:

```
Tokens usados: input=<N> output=<N> cache_read=<N> total=<N>
```

O orquestrador coleta esses valores, preenche as tabelas de tokens nos tres entregaveis finais e calcula o total consolidado de toda a execucao. Use `N/A` quando o agente nao reportar ou a plataforma nao expuser o dado.
