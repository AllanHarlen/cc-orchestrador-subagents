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

### 1.2 Interpretar a demanda

Com o contexto do OpenSpec em maos, analise o argumento passado para `/orchestrador`:

- problema real a resolver (nao apenas o pedido literal);
- contexto de negocio e estado atual do sistema;
- stakeholders impactados.

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

## Fase 2 - Review do entendimento com Codex

Com o entendimento da demanda formado (fases 1.1 a 1.5), o orquestrador delega uma revisao critica ao Codex **antes de criar qualquer artefato OpenSpec**:

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

Antes de consolidar, o orquestrador preenche um checklist minimo que valida se o plano esta maduro. Plano insuficiente nao avanca.

## Fase 5 - Consolidar o plano

O orquestrador revisita o entendimento aprovado na Fase 2 e garante que os artefatos da Fase 4 estao alinhados. Atualiza `proposal.md`, `design.md` e `tasks.md` se necessario. O plano consolidado e a fonte da verdade para todo o restante do workflow.

## Fase 6 - Classificacao das tasks

Para cada task em `tasks.md`, registre em `tasks-classification.md`:

- categoria;
- dependencias;
- arquivos criticos;
- complexidade;
- `contractRequired: yes|no`.

### Regra de `contractRequired`

Marque `yes` sempre que houver troca de dados front-back, mesmo que uma task esteja classificada como `BACKEND_ONLY` e outra como `FRONTEND_ONLY`.

Exemplos:

- endpoint novo consumido por tela -> `yes`;
- mudanca de payload, filtros, paginacao, validacao ou erro -> `yes`;
- ajuste puramente visual sem tocar API -> `no`.

## Fase 7 - Ondas

Agrupe tasks em `waves.md`.

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

Para Codex:

- implementacao, handoff e ajuste -> `--effort medium`;
- review -> `--effort high`;
- nao fixe `--model`.

Para Gemini:

- `gemini-3-pro` em UI complexa;
- `gemini-3-flash` em UI simples.

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
- `QUOTA_EXHAUSTED`
- `REVIEWED`

### Politica de quota

- `QUOTA_EXHAUSTED` no Gemini:
  - registre evidencia;
  - se o fallback for seguro, redelegue para Codex com `--effort medium`;
  - se mudar muito a natureza da entrega, peca confirmacao do usuario.

- `QUOTA_EXHAUSTED` no Codex durante implementacao, ajuste pontual ou handoff:
  - nao tente trocar modelo fixo;
  - marque `BLOCKED`;
  - registre evidencia;
  - peca decisao ao usuario.

- `QUOTA_EXHAUSTED` no Codex durante review:
  - faca review interno read-only no orquestrador;
  - salve o resultado em `review-final.md`;
  - nao edite codigo produtivo.

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

Fluxo principal:

- delegue ao Codex com `--effort high`;
- salve o resultado em `review-final.md`.

Fluxo de fallback:

- se o review Codex vier com `QUOTA_EXHAUSTED`, o orquestrador faz review interno read-only;
- registre no proprio `review-final.md` que o review foi fallback interno do orquestrador por indisponibilidade de quota do Codex.

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
- contagem de tokens por agente (tabela consolidada em `implementation-report.md` secao 11a e em `subagents-context.md` secao "Uso de Tokens por Agente").

### Contagem de tokens

Cada subagente deve incluir no retorno:

```
Tokens usados: input=<N> output=<N> cache_read=<N> total=<N>
```

O orquestrador coleta esses valores, preenche as tabelas de tokens nos tres entregaveis finais e calcula o total consolidado de toda a execucao. Use `N/A` quando o agente nao reportar ou a plataforma nao expuser o dado.
