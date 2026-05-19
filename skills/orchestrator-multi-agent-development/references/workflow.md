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

### 1.1 Explorar o repositorio OpenSpec

Antes de criar qualquer artefato, execute:

```
/explore https://github.com/Fission-AI/OpenSpec/tree/main/src
```

Objetivo: obter contexto atualizado sobre as skills, contratos e convencoes do OpenSpec que serao usados ao longo do workflow. Use o resultado para:

- confirmar quais skills `openspec-*` estao disponiveis e o que cada uma faz;
- entender os tipos de artefatos que o OpenSpec espera (`proposal.md`, `design.md`, `tasks.md`, `specs/`);
- identificar restricoes ou convencoes do OpenSpec que devem ser respeitadas no plano;
- antecipar se a demanda exige alguma skill especifica (`openspec-explore`, `openspec-ff-change`, etc.).

Se o resultado do `/explore` revelar divergencias em relacao ao que esta documentado em `references/openspec-integration.md`, prevalece o que o repositorio oficial retornou.

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

## Fases 2 a 5 - OpenSpec, plano e review

- o orquestrador cria a mudanca OpenSpec;
- escreve `proposal.md`, `design.md` e `tasks.md`;
- registra `plan-sufficiency-check.md`;
- delega review de plano para `codex:codex-rescue` com `--effort high`;
- consolida o plano.

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
