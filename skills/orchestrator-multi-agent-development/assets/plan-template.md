# Plano de Implementação — <NOME DA MUDANÇA>

> Template para o orquestrador preencher diretamente. Não delegue este plano para subagentes Claude Code. O conteúdo deve refletir-se em `proposal.md`, `design.md` e `tasks.md`. Não deixe seções vazias — se algo não se aplica, escreva "N/A — <motivo>".

## Contexto

<Resumo do problema, da motivação, dos stakeholders, do estado atual do sistema.>

## Objetivo

<Frase única e mensurável do que a mudança entrega.>

## Escopo incluído

- <item>
- <item>

## Escopo excluído

- <item> (motivo)
- <item> (motivo)

## Arquitetura proposta

<Descrição da arquitetura: camadas, módulos, fluxo de dados, diagramas se necessário. Se houver decisão arquitetural relevante, justifique.>

## Impactos no back-end

- <módulo / camada afetado> — <natureza do impacto>
- <novos endpoints>
- <novos services / handlers>
- <ajuste em repositórios>
- <alterações em validações>

## Impactos no front-end

- <página / componente afetado>
- <novos componentes>
- <ajustes em estado / store>
- <impactos em rotas>

## Impactos no banco de dados

- <tabela afetada>
- <novas tabelas>
- <migrations necessárias>
- <índices>
- <impacto em integridade referencial>
- <estratégia de backfill / data migration, se aplicável>

## Impactos em autenticação/autorização

- <claims / roles novos>
- <políticas alteradas>
- <impacto em SSO / OAuth / JWT>
- <impacto em revogação de sessão>

## Integrações externas

- <serviço externo>: <natureza da integração> (sync / async, contrato, rate limit)

## Riscos técnicos

- <risco> — probabilidade <baixa/média/alta>, impacto <baixo/médio/alto>, mitigação: <ação>
- ...

## Estratégia de testes

- **Back-end**
  - testes unitários: <escopo>
  - testes de integração: <escopo>
  - testes de contrato: <escopo>
- **Front-end**
  - testes de componente: <escopo>
  - testes e2e: <escopo>
  - testes visuais: <escopo>
- **Banco**
  - testes de migration (up/down): <escopo>
  - sanidade de dados pós-deploy: <escopo>

## Estratégia de rollback

<Como reverter caso algo dê errado em produção. Inclua feature flag se aplicável, plano de revert de migration, plano de comunicação.>

## Tasks propostas

> Cada task deve ter ID, título, descrição curta, categoria (BACKEND_ONLY / FRONTEND_ONLY / FULLSTACK / DATABASE_ONLY / REVIEW_ONLY / DOCS_ONLY / TEST_ONLY), dependências e complexidade.

### Task 1 — <Título>
- **ID:** T1
- **Categoria:** <categoria>
- **Dependências:** <T0 ou nenhuma>
- **Complexidade:** <simples / média / complexa>
- **Descrição:** <2-4 linhas>
- **Arquivos críticos:** <lista>

### Task 2 — <Título>
- **ID:** T2
- **Categoria:** ...
- ...

## Critérios de aceite

> Use checkboxes. Cada critério deve ser mensurável (passa em teste, retorna status X, atinge métrica Y).

- [ ] <critério 1>
- [ ] <critério 2>
- [ ] <critério N>

## Observações finais

<Decisões em aberto, dúvidas para o orquestrador resolver com o usuário, contexto adicional.>
