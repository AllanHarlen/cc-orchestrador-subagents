# Workflow detalhado por fase

Este arquivo expande as fases do `SKILL.md`.

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

## Fase 1 - Entendimento da demanda

### 1.0 Detectar plano pre-definido

Antes de interpretar a demanda como um pedido aberto, verifique se o usuario ja entregou um plano de execucao, uma lista de tasks, um desenho tecnico, uma sequencia de fases, um conjunto de decisoes arquiteturais ou um escopo aprovado.

Classifique a execucao como `PREDEFINED_PLAN=yes` quando o input inicial tiver pelo menos dois destes sinais:

- objetivos ou entregaveis ja definidos;
- tasks, fases, milestones ou ordem de implementacao proposta;
- decisoes tecnicas ja tomadas (arquitetura, bibliotecas, endpoints, telas, contratos, migrations);
- restricoes explicitas de escopo, prazo, agente, tecnologia ou arquivo;
- criterios de aceite, testes esperados ou validacoes obrigatorias;
- contexto de negocio suficiente para orientar a implementacao sem discovery aberto.

Nao classifique como `PREDEFINED_PLAN` quando o usuario trouxe apenas uma ideia, um bug report curto, uma feature desejada ou uma preferencia solta sem estrutura operacional.

Quando `PREDEFINED_PLAN=yes`, a Fase 1 muda de "descobrir o que fazer" para "normalizar, validar e enriquecer o plano recebido". O conhecimento inicial do usuario vira insumo primario e deve ser preservado como fonte de verdade, sem ser simplificado ou replanejado sem motivo.

### 1.1 Executar `/opsx:explore`

Antes de criar qualquer artefato, execute:

```
/opsx:explore
```

O `/opsx:explore` e o modo "thinking partner" do OpenSpec: ele investiga o projeto atual, le specs existentes, historico de mudancas e o estado do codebase para construir contexto antes de qualquer planejamento. Use o resultado para:

- entender o estado atual do projeto e specs vigentes em `openspec/specs/`;
- identificar mudancas anteriores relevantes em `openspec/changes/` que possam influenciar o plano;
- detectar restricoes ou convencoes ja estabelecidas no projeto que os subagentes devem respeitar;
- antecipar dependencias ocultas entre a demanda atual e o que ja foi implementado.

O resultado do `/opsx:explore` e insumo direto para as etapas seguintes desta fase — nao pule mesmo que o projeto pareca simples.

Se `PREDEFINED_PLAN=yes`, use o `/opsx:explore` para confrontar o plano recebido com o estado real do projeto, nao para substituir o plano. Registre divergencias entre o plano e o codebase como riscos, lacunas ou perguntas em aberto.

### 1.1.1 Resolver duvidas do `/opsx:explore` antes de prosseguir

Ao receber o resultado do `/opsx:explore`, verifique se ele retornou duvidas de planejamento pendentes (perguntas sobre escopo, ambiguidades de requisito, decisoes de arquitetura em aberto ou conflitos com specs existentes).

Para cada duvida pendente, o orquestrador **nao avanca para 1.2** antes de usar `AskUserQuestion` para levar a questao ao usuario e registrar a resposta.

**Quando acionar `AskUserQuestion`:**
- o `/opsx:explore` identificou ambiguidade de escopo ou requisito que bloqueia o entendimento;
- ha conflito entre a demanda atual e specs ou mudancas anteriores em `openspec/`;
- uma decisao de arquitetura em aberto impede mapear o impacto corretamente.

Registre cada resposta do usuario no entendimento antes de continuar com 1.2.

### 1.2 Interpretar a demanda

Com o contexto do OpenSpec em maos, analise o argumento passado para `/orchestrador`.

Quando `PREDEFINED_PLAN=no`, identifique:

- problema real a resolver (nao apenas o pedido literal);
- contexto de negocio e estado atual do sistema;
- stakeholders impactados.

Quando `PREDEFINED_PLAN=yes`, extraia e normalize:

- objetivo final do plano;
- entregaveis ja definidos;
- ordem ou dependencias entre fases/tasks;
- decisoes tecnicas firmes;
- restricoes impostas pelo usuario;
- criterios de aceite e validacoes esperadas;
- hipoteses do plano que ainda precisam ser verificadas no codebase;
- pontos em que o plano conflita com specs, codigo existente ou limites operacionais.

### 1.3 Mapear impacto arquitetural

Percorra mentalmente as camadas do sistema:

- **Backend:** endpoints, services, repositorios, validacoes
- **Frontend:** paginas, componentes, estado/store, rotas
- **Banco de dados:** tabelas, migrations, indices, integridade referencial
- **Auth/autorizacao:** claims, roles, politicas, SSO
- **Integracoes externas:** contratos, rate limits, sincronismo

### 1.4 Definir escopo

Explicite o que entra *e o que fica fora* (com motivo). Esse limite e o que garante que os subagentes nao vaguem durante a implementacao.

### 1.5 Identificar riscos e perguntas em aberto

- Riscos tecnicos antecipados (probabilidade, impacto, mitigacao)
- Perguntas que precisam ser resolvidas com o usuario antes de prosseguir

### 1.6 Expandir plano pre-definido

Aplicavel somente quando `PREDEFINED_PLAN=yes`.

Antes de pular a Fase 2, o orquestrador deve ampliar o entendimento com base no conhecimento passado inicialmente pelo usuario. Essa ampliacao e obrigatoria porque o review externo de entendimento sera ignorado neste fluxo.

Crie um **Resumo expandido do plano recebido** no entendimento da Fase 1 contendo:

- **Fonte do plano:** trechos ou itens do input inicial que definem o plano;
- **Objetivo consolidado:** o resultado final esperado, em linguagem mensuravel;
- **Mapa de entregaveis:** cada item planejado, seu resultado esperado e criterios de aceite;
- **Decisoes preservadas:** escolhas que vieram do usuario e nao devem ser redesenhadas sem aprovacao;
- **Dependencias e sequenciamento:** o que precisa acontecer antes/depois e por que;
- **Impacto arquitetural:** backend, frontend, banco, auth, integracoes, testes e operacao;
- **Lacunas preenchidas pelo `/opsx:explore`:** informacoes do projeto que completam o plano;
- **Conflitos detectados:** divergencias entre plano, specs existentes e codigo real;
- **Riscos remanescentes:** riscos que devem voltar no `design.md` e no review final;
- **Perguntas bloqueantes:** somente o que impede transformar o plano em artefatos OpenSpec.

Se houver contradicao estrutural no plano, dependencia desconhecida que mude a ordem de execucao, ou decisao ausente que altere escopo/arquitetura, use `AskUserQuestion` antes de prosseguir. Depois da resposta, registre a decisao no resumo expandido.

Ao final de 1.6, o orquestrador deve conseguir transformar o plano recebido em `proposal.md`, `design.md` e `tasks.md` sem pedir ao Codex para revisar o entendimento.

## Fase 2 - Review do entendimento com Codex

> **Excecao PREDEFINED_PLAN:** Se a Fase 1 marcou `PREDEFINED_PLAN=yes` e a etapa 1.6 foi concluida sem perguntas bloqueantes, ignore a revisao com Codex nesta fase. O usuario ja forneceu informacao estruturada suficiente e o orquestrador deve avancar diretamente para a Fase 3.

Neste caso, salve `review-entendimento.md` com:

- nota `"Codex ausente: plano pre-definido informado pelo usuario"`;
- classificacao `PREDEFINED_PLAN=yes`;
- resumo expandido produzido na Fase 1.6;
- perguntas feitas ao usuario e respostas, quando houver;
- riscos e hipoteses que devem ser reavaliados na Fase 12;
- motivo do bypass da Fase 2.

Se o plano pre-definido estiver incompleto a ponto de impedir a criacao segura dos artefatos OpenSpec, nao use esta excecao ainda: resolva as perguntas bloqueantes na Fase 1.6 e so entao pule a Fase 2.

> **Excecao FRONTEND_ONLY:** Se o orquestrador determinar na Fase 1 que toda a atividade e `FRONTEND_ONLY` (nenhuma task de back-end, banco de dados ou teste de API), **nao delegue ao Codex**. Execute um review interno do orquestrador, salve o resultado em `review-entendimento.md` com a nota `"Codex ausente: atividade FRONTEND_ONLY"` e avance diretamente para a Fase 3.

Com o entendimento da demanda formado (fases 1.0 a 1.5, e 1.6 quando aplicavel), o orquestrador delega uma revisao critica ao Codex **antes de criar qualquer artefato OpenSpec**:

**Subagente:** `codex:codex-rescue` com `--effort high`
**Modo:** somente leitura — o Codex nao modifica arquivos

O Codex recebe o entendimento estruturado da demanda e avalia:

- o problema identificado esta correto?
- o escopo incluido e excluido faz sentido?
- ha dependencias ocultas ou riscos nao mapeados?
- o impacto arquitetural mapeado e completo?
- ha perguntas em aberto que devem ser resolvidas antes de planejar?

Retorna:
1. Problemas ou lacunas no entendimento
2. Ajustes obrigatorios
3. Ajustes opcionais
4. Decisao: `APROVADO` | `APROVADO COM AJUSTES` | `REPROVADO`
5. Duvidas: lista de pontos em que o Codex ficou indeciso ou que exigem decisao humana
6. Tokens usados: input=<N> output=<N> cache_read=<N> total=<N>

O resultado e salvo em `review-entendimento.md`.

### Regra de escalada de duvidas para o usuario

Ao processar o retorno do Codex, o orquestrador verifica se ha itens na secao **Duvidas**. Para cada duvida ou ponto de indecisao — seja sobre o que aplicar do review, seja sobre a direcao de implementacao — o orquestrador **nao decide sozinho**: ele pausa o workflow e usa `AskUserQuestion` para levar a questao ao usuario.

**Quando acionar `AskUserQuestion`:**
- o Codex retornou duvidas explicitas na secao 5;
- o orquestrador esta indeciso sobre aplicar ou rejeitar um ajuste obrigatorio;
- dois ajustes do Codex sao contraditories entre si;
- a decisao afeta escopo, arquitetura ou prazo de forma significativa.

**Como formular a pergunta:**
- apresente o contexto em uma frase (o que o Codex sinalizou);
- ofeca as opcoes possiveis como choices;
- nao tome a decisao no texto da pergunta — deixe o usuario escolher.

**Exemplo:**
```
O Codex identificou duas abordagens possiveis para o escopo de autenticacao:

A) Incluir renovacao de token nesta mudanca (maior escopo, mais seguro)
B) Deixar renovacao de token para uma mudanca futura (escopo menor, entrega mais rapida)

Qual voce prefere?
```

Apos a resposta do usuario, registre a decisao e o motivo em `review-entendimento.md` na secao **Decisoes do usuario**. Somente entao o orquestrador avanca para a Fase 3.

### Regra de investigacao de hipoteses nao verificaveis

Ao processar "Ajustes Obrigatorios" do Codex, identifique itens que usam linguagem como:

- "hipotese nao verificavel sem inspecionar o repositorio"
- "nao foi possivel confirmar sem ler o codigo"
- "assume X sem evidencia"
- "risco de incompatibilidade nao verificado"
- "exige inspecao do servico/controller/contrato"

Para cada item desse tipo, o orquestrador **nao avanca para Fase 3** antes de:

1. identificar os arquivos relevantes para verificar a hipotese (ex.: servicos, controllers, contratos, schemas);
2. ler esses arquivos com `Read` ou `Grep`;
3. confirmar ou descartar a hipotese com base no codigo real;
4. registrar a conclusao em `review-entendimento.md` com o arquivo lido, o trecho relevante e a decisao tomada.

Somente apos essa investigacao o orquestrador reclassifica o ajuste como confirmado ou descartado e avanca.

> Hipoteses nao verificadas travadas como verdade no `design.md` causam cascata de implementacao errada que so e detectada no review pos-implementacao — como o caso de assumir que um servico funciona de forma anonima sem confirmar o contrato real do codigo.

## Fase 3 - Criar mudanca OpenSpec

```
/openspec-new-change <nome>
```

Cria o diretorio `openspec/changes/<nome>/`. O nome deve ser descritivo em kebab-case.

## Fase 4 - Elaborar o plano

O orquestrador escreve os tres artefatos diretamente — sem delegar:

- `proposal.md` — objetivo mensuravel, escopo incluido/excluido, contexto
- `design.md` — arquitetura proposta, impactos por camada, riscos, estrategia de testes e rollback
- `tasks.md` — tasks com ID, categoria, dependencias, complexidade, arquivos criticos e criterios de aceite

### Gate de suficiencia (Fase 4.5) — `plan-sufficiency-check.md`

Quando `PREDEFINED_PLAN=yes`, estes artefatos devem traduzir o plano recebido e enriquecido na Fase 1.6, nao substitui-lo por um plano novo. Preserve IDs, nomes de fases, entregaveis e decisoes do usuario quando forem uteis para rastreabilidade. Ajustes so devem ser feitos para compatibilizar o plano com OpenSpec, com o codebase real ou com riscos explicitamente registrados.

Antes de consolidar, o orquestrador preenche um checklist minimo que valida se o plano esta maduro. Plano insuficiente nao avanca.

## Fase 5 - Consolidar o plano

O orquestrador revisita o entendimento aprovado na Fase 2 e garante que os artefatos da Fase 4 estao alinhados. Quando `PREDEFINED_PLAN=yes`, revisita o resumo expandido da Fase 1.6 e o `review-entendimento.md` de bypass. Atualiza `proposal.md`, `design.md` e `tasks.md` se necessario. O plano consolidado e a fonte da verdade para todo o restante do workflow.

## Fase 6 - Classificacao das tasks

Para cada task em `tasks.md`, registre em `tasks-classification.md`:

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

## Fase 7 - Ondas

Agrupe tasks em `waves.md`.

Cada entrada de `waves.md` deve repetir `assignedAgent` vindo de `tasks-classification.md`. Depois de montar as waves, rode:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/validate-routing.mjs" "openspec/changes/<nome>"
```

Se o validador falhar, corrija `tasks-classification.md` e `waves.md` antes de qualquer delegacao.

Nao paralelize quando houver:

- contrato pendente;
- schema indefinido;
- arquivo central compartilhado;
- autenticacao ou seguranca sem consolidacao.

## Fase 8 - Contratos API/UI

Crie `contracts/*.md` para:

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

## Fase 9 - Delegacao paralela

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
2. ignore todas as skills cujo nome comece com `openspec` ou `opsx` — essas sao exclusivas do orquestrador;
3. das skills restantes, identifique quais se aplicam a task em execucao;
4. use as skills compativeis durante a implementacao;
5. registre no retorno quais skills foram utilizadas (campo obrigatorio no retorno de Codex e Gemini).

O orquestrador consolida as skills utilizadas por subagente em `subagents-context.md`.

## Fase 10 - Monitoramento

Status validos:

- `PENDING`
- `RUNNING`
- `PAUSED`
- `CANCELLED`
- `BLOCKED`
- `NEEDS_SYNC`
- `DONE`
- `FAILED`
- `QUOTA_EXAUSTED`
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

- `QUOTA_EXHAUSTED` no Codex durante review:
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

## Fase 11 - Integracao

Valide:

- aderencia a `tasks.md`;
- aderencia ao contrato;
- wire format;
- casing JSON;
- serializacao real;
- arquivos alterados fora do escopo;
- testes e build.

Se precisar ajuste, delegue para Codex com `--effort medium`.

## Fase 12 - Review pos-implementacao

> **Excecao FRONTEND_ONLY:** Se toda a atividade for `FRONTEND_ONLY`, **nao delegue ao Codex**. O orquestrador faz review interno read-only seguindo as secoes 12.1, 12.3 quando aplicavel e 12.5; salva o resultado em `review-final.md` com a nota `"Codex ausente: atividade FRONTEND_ONLY"` e so avanca para a Fase 13 quando a decisao permitir.

Objetivo da fase: validar a implementacao final contra a demanda original, o plano consolidado, os contratos, as tasks executadas e os retornos dos subagentes. Esta fase e read-only: nao edite codigo durante o review. Se houver defeitos, volte para Fase 11 para integrar ajustes ou redelegar correcao.

### 12.1 Preparar pacote de review

Antes de delegar ao Codex ou fazer review interno, monte um pacote de contexto com:

- demanda original do usuario;
- classificacao `PREDEFINED_PLAN=yes|no`;
- se `PREDEFINED_PLAN=yes`, o plano inicial recebido e o resumo expandido da Fase 1.6;
- `review-entendimento.md`;
- `proposal.md`, `design.md`, `tasks.md`, `tasks-classification.md`, `waves.md` e contratos em `contracts/*.md`;
- `monitoring.md`, `workflow-log.md` e `subagents-context.md`;
- resumo dos arquivos alterados;
- comandos de build, testes e validacoes executadas;
- falhas, bloqueios, fallbacks e decisoes do usuario durante a execucao.

### 12.2 Fluxo principal

- delegue ao Codex com `--effort high`;
- informe que o review e somente leitura;
- exija achados com severidade, arquivo/trecho quando aplicavel, impacto e correcao esperada;
- salve o resultado em `review-final.md`.

O prompt do review deve pedir verificacao explicita de:

- aderencia ao objetivo original e ao escopo incluido/excluido;
- aderencia a cada task e criterio de aceite em `tasks.md`;
- diferencas entre implementacao real e `design.md`;
- contratos API/UI, wire format, status codes, casing JSON e serializacao real;
- integracao entre entregas de subagentes diferentes;
- auth/autorizacao, validacoes, tratamento de erro e estados de UI;
- migrations, persistencia, indices e integridade referencial quando houver banco;
- testes executados, lacunas de teste e builds pendentes;
- arquivos alterados fora do escopo;
- regressao potencial em fluxos existentes;
- qualidade do handoff final para Fase 13.

### 12.3 Regra especial para plano pre-definido

Quando `PREDEFINED_PLAN=yes`, a Fase 12 compensa o bypass da Fase 2. O review final deve ser mais critico e comparar a implementacao com o plano inicial do usuario, nao apenas com os artefatos OpenSpec derivados.

`review-final.md` deve conter uma secao obrigatoria **Comparacao com plano pre-definido** com:

- cada objetivo, fase, task ou entregavel do plano inicial;
- status: `IMPLEMENTADO`, `PARCIAL`, `NAO_IMPLEMENTADO`, `ALTERADO_COM_JUSTIFICATIVA` ou `FORA_DO_ESCOPO`;
- evidencia da implementacao ou motivo da divergencia;
- decisao: aceitar, corrigir antes da Fase 13, ou pedir decisao ao usuario.

Qualquer divergencia nao aprovada que mude escopo, comportamento, contrato, ordem de entrega ou decisao tecnica do usuario deve ser tratada como achado de alta severidade. O orquestrador nao avanca para Fase 13 enquanto essa divergencia nao for corrigida, justificada no plano consolidado, ou aprovada pelo usuario.

### 12.4 Fluxo de fallback

- se o review Codex vier com `QUOTA_EXHAUSTED`, o orquestrador faz review interno read-only;
- registre no proprio `review-final.md` que o review foi fallback interno do orquestrador por indisponibilidade de quota do Codex;
- mantenha as mesmas secoes obrigatorias do fluxo principal, incluindo a comparacao com plano pre-definido quando aplicavel.

### 12.5 Resultado e loop de correcao

`review-final.md` deve terminar com uma decisao:

- `APROVADO`: pode seguir para Fase 13;
- `APROVADO_COM_RESSALVAS`: pode seguir somente se as ressalvas forem documentadas como nao bloqueantes;
- `REPROVADO`: nao avance; volte para Fase 11 ou redelegue ajustes.

Se houver achados bloqueantes:

1. registre os achados em `monitoring.md` e `workflow-log.md`;
2. crie ou atualize tasks de correcao com agente responsavel;
3. execute a correcao pela Fase 11;
4. repita a Fase 12 focando nas areas alteradas e nos achados anteriores.

## Fase 13 - Verificacao OpenSpec

Use:

```text
/openspec-verify-change <nome>
/openspec-sync-specs <nome>
/openspec-archive-change <nome>
```

## Fases 14 e 15 - Relatorio final

Entregaveis obrigatorios (salve na **raiz de execucao do agente**, nao dentro de `openspec/`):

- `workflow-log.md`
- `subagents-context.md`
- `implementation-report.md`

O relatorio final deve citar:

- se houve auto-remediacao no preflight;
- quais contratos foram criados;
- quais validacoes de wire format e serializacao foram feitas;
- se houve fallback de review interno por `QUOTA_EXHAUSTED`;
- para cada delegacao AGY com `agyParallel: yes`: numero de subagentes Gemini nativos e Conversation IDs reportados pelo AGY;
- contagem de tokens por agente (tabela consolidada em `implementation-report.md` secao 11a e em `subagents-context.md` secao "Uso de Tokens por Agente"; quando houver fan-out, os tokens reportados pelo AGY sao o agregado da sessao).

### Contagem de tokens

Cada subagente deve incluir no retorno:

```
Tokens usados: input=<N> output=<N> cache_read=<N> total=<N>
```

O orquestrador coleta esses valores, preenche as tabelas de tokens nos tres entregaveis finais e calcula o total consolidado de toda a execucao. Use `N/A` quando o agente nao reportar ou a plataforma nao expuser o dado.
