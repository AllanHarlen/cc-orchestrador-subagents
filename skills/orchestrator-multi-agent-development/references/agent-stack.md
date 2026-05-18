# Stack de Agentes — Decisão de Modelo e Skills

## Visão geral

| Papel | Modelo | Subagent type | Effort | Skills que carrega |
|---|---|---|---|---|
| Orquestrador | Claude Sonnet 4.6 | (você mesmo) | Medium | — |
| Revisor de plano | Codex gpt-5.5 | `codex:codex-rescue` | High | (nenhuma — é review) |
| Back-end | Codex gpt-5.4 | `codex:codex-rescue` | Medium | back-end relevantes ao projeto |
| Front-end UI complexa | Gemini 3 | `cc-gemini-plugin:gemini-agent` | — | `frontend-developer`, `ui-ux-designer` |
| Front-end UI simples | Gemini 3 Flash | `cc-gemini-plugin:gemini-agent` | — | `frontend-developer` |
| Review pós-implementação | Codex gpt-5.5 | `codex:codex-rescue` | High | — |

> **Skills disponíveis no ambiente** dependem do que o usuário tem instalado. Antes de delegar, leia a lista de skills disponíveis na seção `<system-reminder>` do início da conversa. Se uma skill esperada não estiver lá, ajuste o prompt (não invente a skill).

> **Context7 MCP é opcional.** Use o resultado `checks.optional.mcp.context7` do preflight. Se `ok=true`, instrua Codex/Gemini a consultar Context7 antes de mexer em APIs, bibliotecas, frameworks, SDKs, CLIs ou cloud services. Se `ok=false`, não bloqueie a execução; registre apenas a limitação quando a task depender de documentação externa atual.

> **Importante:** o orquestrador não executa subagentes Claude Code. Planejamento, consolidação, relatório final, contexto consolidado e instruções de negócio são responsabilidade do próprio orquestrador. Delegações permitidas neste fluxo: `codex:codex-rescue` e `cc-gemini-plugin:gemini-agent`.

> **Limite de execução:** dentro do workflow orquestrado, o orquestrador não edita código produtivo, testes, migrations ou componentes. Correções, ajustes pontuais, handoffs e recuperação de falha operacional devem ir para Codex gpt-5.4 medium, exceto reviews formais em Codex gpt-5.5 high.

## Heurística — Gemini 3 vs Gemini 3 Flash

### Use **Gemini 3** (pro / completo) para:

- telas complexas com múltiplos estados;
- dashboards com gráficos, filtros, agregações;
- fluxos condicionais e wizards multi-etapa;
- UX com regras de negócio embaralhadas (validações cruzadas, etc.);
- componentes reutilizáveis (design system);
- integração com muitos endpoints simultaneamente;
- responsividade complexa (breakpoints customizados, layouts adaptativos);
- refatoração visual relevante (ex.: trocar Ant Design por outro lib).

### Use **Gemini 3 Flash** para:

- ajustes simples de componente existente;
- formulários pequenos (até 5-6 campos);
- consumo básico de uma única API;
- correção visual localizada (espaçamento, cor, label);
- empty/loading/error state simples;
- adição de validação isolada.

### Como passar o modelo

O subagente `cc-gemini-plugin:gemini-agent` recebe o prompt e roteia para o bridge. Use:

```text
--model gemini-3-pro    # para Gemini 3
--model gemini-3-flash  # para Gemini 3 Flash
```

dentro do prompt. Exemplo:

```text
Agent(
  subagent_type="cc-gemini-plugin:gemini-agent",
  prompt="--model gemini-3-pro --dirs src/components <task descrita aqui>"
)
```

## Heurística — Codex gpt-5.4 vs gpt-5.5

### Use **Codex gpt-5.4 Medium** para execução back-end comum:

- endpoints REST/GraphQL;
- services / use cases / handlers;
- repositories e camada de acesso a dados;
- DTOs e mappers;
- validações (FluentValidation, Zod, etc.);
- testes unitários e de integração;
- migrations simples;
- ajustes de queries SQL.

### Use **Codex gpt-5.5 High** para tarefas críticas:

- review de arquitetura;
- análise de segurança;
- problemas de concorrência;
- integridade de dados em transações complexas;
- refatorações amplas com risco de regressão;
- análise de regressão;
- review final antes de merge.

### Como passar o modelo

O subagente `codex:codex-rescue` propaga `--model` e `--effort`. Por padrão é write-capable.

```text
Agent(
  subagent_type="codex:codex-rescue",
  prompt="--model gpt-5.4-codex --effort medium <task>"
)
```

Para review (read-only):

```text
Agent(
  subagent_type="codex:codex-rescue",
  prompt="--model gpt-5.5-codex --effort high NÃO modifique arquivos. <pedido de review>"
)
```

> O codex-rescue assume `--write` por padrão. Para reviews, deixe explícito no prompt que não deve modificar arquivos.

## Skills a carregar no front-end

Ao montar o prompt para o `cc-gemini-plugin:gemini-agent`, sempre liste explicitamente as skills relevantes do projeto. Exemplo de cabeçalho:

```text
Skills obrigatórias para esta task:
- frontend-developer
- ui-ux-designer
- accessibility (se UI complexa ou em produto crítico)
```

O Gemini não invoca skills sozinho — você precisa orientar.

## Skills a carregar no back-end

Antes de delegar para Codex, **liste as skills back-end disponíveis** no ambiente. Combinações típicas conforme stack:

### .NET / C#

- `csharp-pro`
- `dotnet-architect`
- `dotnet-backend-patterns`

### PostgreSQL

- `postgresql`

### Outras stacks

Verifique a lista de skills disponíveis na conversa. Não invoque skill que não esteja listada.

No prompt do codex:codex-rescue, sempre cite:

```text
Skills relevantes neste repositório:
- csharp-pro
- dotnet-backend-patterns
- postgresql
```

> Codex não tem mecanismo automático de invocação de skills do Claude Code. Citar serve para que o prompt referencie as convenções esperadas. Se quiser que o Codex realmente carregue uma skill, use as skills internas do Codex (referenciar via texto).

## Quando NÃO invocar um subagente

- Planejamento OpenSpec: faça diretamente como orquestrador usando `assets/plan-template.md`.
- Consolidação/finalização: faça diretamente como orquestrador, usando os retornos de Codex/Gemini.
- Artefatos de coordenação do workflow (`proposal.md`, `design.md`, `tasks.md`, `monitoring.md`, `workflow-log.md`, `subagents-context.md`, `implementation-report.md`): faça diretamente como orquestrador.
- Tarefa trivial fora do `/orchestrator` (typo, rename simples, commit message): não use esta skill; trate como execução direta fora do fluxo orquestrado.

Nunca invoque um agente "porque pode". O custo é tempo + tokens + risco de escopo expandido.

## Quando o subagente ideal **não está** disponível

Se `codex:codex-rescue` ou `cc-gemini-plugin:gemini-agent` não estiverem no ambiente:

- Avise o usuário no início da fase 2;
- Sugira instalar via marketplace;
- Não use `general-purpose`, `Plan` ou outro subagente Claude como fallback;
- Cancele o fluxo orquestrado conforme preflight e oriente o usuário a instalar/configurar o plugin faltante.

> Se o usuário não puder/quiser instalar os plugins, use Claude direto fora deste orquestrador. O fluxo multiagente só é válido com Codex/Gemini disponíveis via plugins.
