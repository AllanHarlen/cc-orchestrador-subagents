# Workflow Detalhado por Fase

Este arquivo expande as fases do `SKILL.md`. Leia a fase específica quando precisar do detalhe operacional. Não precisa ler tudo de uma vez.

## Índice

- [Fase 0 — Preflight Check](#fase-0--preflight-check)
- [Fase 1 — Entendimento da Demanda](#fase-1--entendimento-da-demanda)
- [Fase 2 — Criação OpenSpec](#fase-2--criação-openspec)
- [Fase 3 — Elaboração do Plano](#fase-3--elaboração-do-plano)
- [Fase 4 — Review do Plano com Codex](#fase-4--review-do-plano-com-codex)
- [Fase 5 — Consolidação do Plano](#fase-5--consolidação-do-plano)
- [Fase 6 — Classificação das Tasks](#fase-6--classificação-das-tasks)
- [Fase 7 — Identificação de Paralelização](#fase-7--identificação-de-paralelização)
- [Fase 8 — Contratos API/UI](#fase-8--contratos-apiui)
- [Fase 9 — Delegação Paralela](#fase-9--delegação-paralela)
- [Fase 10 — Monitoramento](#fase-10--monitoramento)
- [Fase 11 — Integração dos Resultados](#fase-11--integração-dos-resultados)
- [Fase 12 — Review Pós-Implementação](#fase-12--review-pós-implementação)
- [Fase 13 — Verificação OpenSpec](#fase-13--verificação-openspec)
- [Fase 14 — Contexto Consolidado e Relatório Final](#fase-14--contexto-consolidado-e-relatório-final)
- [Fase 15 — Instruções de Negócio](#fase-15--instruções-de-negócio)

---

## Fase 0 — Preflight Check

**Obrigatória. Bloqueante. Roda antes de qualquer outra coisa.**

Execute:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs"
```

Saída: JSON com `status: "ok"` ou `status: "failed"`. Em caso de falha, **cancele a operação** e apresente os passos de remediação do campo `remediation`.

Dependências verificadas:

| Dependência | Tipo | Comando manual |
|---|---|---|
| `gemini` CLI | binário | `gemini --version` |
| `codex` CLI | binário | `codex --version` |
| `openspec` CLI | binário | `openspec --version` |
| Plugin `cc-gemini-plugin` | Claude Code plugin | `ls ~/.claude/plugins/cache/cc-gemini-plugin/` |
| Plugin `openai-codex` | Claude Code plugin | `ls ~/.claude/plugins/cache/openai-codex/codex/` |
| Skills `openspec-*` | filesystem | `ls ~/.claude/skills | grep openspec` |
| `context7` MCP | opcional | ver `checks.optional.mcp.context7` no JSON |

Quando o preflight retorna falha, **não tente fallback automático**. A política é: cancele com a mensagem padrão (formato em `references/preflight-check.md`) e oriente o usuário a instalar/atualizar/configurar o que falta antes de invocar novamente.

Context7 é exceção: ele aparece em `checks.optional.mcp.context7`, não entra em `failed` e nunca bloqueia. Se estiver disponível, use-o nos prompts de Codex/Gemini para confirmar documentação atual de bibliotecas/frameworks/APIs.

> Detalhes completos de cada dependência, remediação e troubleshooting cross-platform: `references/preflight-check.md`.

---

## Fase 1 — Entendimento da Demanda

Extraia da solicitação do usuário:

- **objetivo principal** — qual problema resolve?
- **escopo incluído** e **escopo excluído**;
- **sistema afetado** (back-end, front-end, banco, infra);
- **módulos envolvidos**;
- **stack utilizada** (linguagens, frameworks, libs);
- **restrições técnicas** (compat, perf, segurança);
- **dependências** (módulos, serviços externos, libs);
- **riscos iniciais**;
- **entregáveis esperados**.

Regras de ambiguidade:

- **pequena**: faça suposição razoável e registre no `proposal.md`;
- **bloqueante**: pergunte com `AskUserQuestion` (máx 4 perguntas, opções específicas).

Saída desta fase: um parágrafo de contexto que vai alimentar o `proposal.md` da fase 2.

---

## Fase 2 — Criação OpenSpec

Comandos disponíveis (skills `openspec-*`):

| Skill | Quando usar |
|---|---|
| `/openspec-new-change <nome>` | Cria diretório `openspec/changes/<nome>/` com placeholder |
| `/openspec-ff-change <nome>` | Fast-forward: cria todos os artefatos (proposal, design, tasks, specs) de uma vez |
| `/openspec-continue-change <nome>` | Continua workflow expandido (próximo artefato) |
| `/openspec-apply-change <nome>` | Implementação a partir do tasks.md |
| `/openspec-verify-change <nome>` | Valida implementação |
| `/openspec-sync-specs <nome>` | Sincroniza deltas com specs principais |
| `/openspec-archive-change <nome>` | Arquiva mudança concluída |

Workflow recomendado para mudanças relevantes:

1. `/openspec-new-change <nome-da-mudanca>`
2. `/openspec-ff-change <nome-da-mudanca>` — cria proposal/design/tasks/specs vazios mas estruturados

Artefatos esperados:

```
openspec/changes/<nome-da-mudanca>/
├── proposal.md
├── design.md
├── tasks.md
└── specs/
```

> Detalhes adicionais em `references/openspec-integration.md`.

---

## Fase 3 — Elaboração do Plano

**Responsável:** orquestrador principal.

Não invoque `Agent(subagent_type="Plan")`, `general-purpose` ou qualquer outro subagente Claude Code. O orquestrador não executa subagentes Claude; ele apenas mantém o conhecimento geral para estruturar o plano, finalizar o fluxo e consolidar os resultados. Subagentes permitidos no workflow: Codex e Gemini via plugins.

Use o template `assets/plan-template.md` como esqueleto. Estrutura mínima:

```
# Plano de Implementação

## Contexto
## Objetivo
## Escopo incluído
## Escopo excluído
## Arquitetura proposta
## Impactos no back-end
## Impactos no front-end
## Impactos no banco de dados
## Impactos em autenticação/autorização
## Integrações externas
## Riscos técnicos
## Estratégia de testes
## Estratégia de rollback
## Tasks propostas
## Critérios de aceite
```

Preencha diretamente os artefatos OpenSpec:

- `openspec/changes/<nome>/proposal.md`;
- `openspec/changes/<nome>/design.md`;
- `openspec/changes/<nome>/tasks.md`.

Use `assets/plan-template.md` como esqueleto e divida o conteúdo conforme apropriado entre os três arquivos. O plano deve ser executável em paralelo sempre que possível, cada task deve ter entrada/saída definida, riscos arquiteturais devem estar explícitos, a estratégia de testes deve cobrir as camadas afetadas e os critérios de aceite devem ser mensuráveis.

Saída: artefatos OpenSpec preenchidos pelo orquestrador.

---

## Fase 4 — Review do Plano com Codex

**Modelo:** Codex gpt-5.5 Effort High via `codex:codex-rescue`.

Por que rescue e não `/codex:review`? Porque `/codex:review` foca em diff de código local. Aqui revisamos plano Markdown.

**Invocação:**

```text
Agent(
  subagent_type="codex:codex-rescue",
  description="Codex review do plano OpenSpec <nome>",
  prompt="""
--model gpt-5.5-codex --effort high

Revise criticamente o plano OpenSpec em openspec/changes/<nome>/.

Leia: proposal.md, design.md, tasks.md, e qualquer arquivo em specs/.

Avalie:
- se o escopo está claro;
- se as tasks são implementáveis (granularidade adequada);
- se há dependências ocultas entre tasks;
- se há riscos arquiteturais (acoplamento, complexidade, débito);
- se há impacto em segurança ou autenticação/autorização;
- se há impacto em banco de dados (migrations, índices, integridade);
- se há riscos de regressão em funcionalidades existentes;
- se a divisão front-end/back-end está correta;
- se há tasks que podem rodar em paralelo;
- se faltam critérios de aceite mensuráveis.

Retorne, em Markdown:

1. **Problemas encontrados** (bloqueantes para implementação);
2. **Sugestões obrigatórias** (precisa tratar antes de codar);
3. **Sugestões opcionais** (nice to have);
4. **Decisão final:** APROVADO | APROVADO COM AJUSTES | REPROVADO.

NÃO modifique arquivos. NÃO implemente nada. Apenas revise.
"""
)
```

Saída: comentário crítico do Codex no chat (que você precisa salvar em `openspec/changes/<nome>/review-codex.md` antes da fase 5).

---

## Fase 5 — Consolidação do Plano

**Modelo:** você mesmo (Claude Sonnet 4.6 Effort Medium).

Leia o plano original e a revisão do Codex. Para cada sugestão:

- **válida** → aceite e ajuste o artefato correspondente;
- **inválida** → rejeite com justificativa curta no `review-codex.md`;
- **dependente de decisão do usuário** → pergunte com `AskUserQuestion`.

Atualize:

- `proposal.md` — se escopo mudou;
- `design.md` — se arquitetura mudou;
- `tasks.md` — granularidade, dependências, ordem;
- `specs/` — se novos requisitos foram destacados.

Saída: plano revisado, pronto para classificação.

---

## Fase 6 — Classificação das Tasks

Para cada task em `tasks.md`, atribua **uma** categoria:

| Categoria | O que é |
|---|---|
| `BACKEND_ONLY` | apenas API/service/migration sem UI |
| `FRONTEND_ONLY` | apenas componente/tela/estilo, sem alteração de API |
| `FULLSTACK` | precisa back-end **e** front-end coordenados |
| `DATABASE_ONLY` | migration, índice ou ajuste de dados isolado |
| `REVIEW_ONLY` | revisão de código, segurança ou arquitetura |
| `DOCS_ONLY` | atualização de documentação |
| `TEST_ONLY` | escrita ou ajuste de testes sem mudança de código produtivo |

Para cada task, registre também:

- **dependências** (IDs de outras tasks que precisam terminar antes);
- **arquivos críticos tocados** (para detectar conflito de paralelismo);
- **complexidade estimada** (simples / média / complexa) — entra em jogo na escolha de Gemini 3 vs Flash.

Salve essa classificação em `openspec/changes/<nome>/tasks-classification.md`.

---

## Fase 7 — Identificação de Paralelização

> Detalhes completos em `references/parallelization.md`. Resumo aqui.

Agrupe tasks em **ondas (waves)**. Tasks da mesma onda rodam em paralelo. Tasks bloqueadas por dependência ficam na próxima.

Regras-chave:

- **Pode paralelizar**: contratos claros, arquivos disjuntos, sem migration conflitante;
- **Não pode paralelizar**: schema ainda indefinido, contrato pendente, mesmo componente base, autenticação sem revisão.

Salve em `openspec/changes/<nome>/waves.md`:

```markdown
## Wave 1
- Task A (FULLSTACK)
- Task B (BACKEND_ONLY)

## Wave 2 (depende da Wave 1)
- Task C (FULLSTACK)
- Task D (FRONTEND_ONLY)
```

---

## Fase 8 — Contratos API/UI

> Detalhes em `references/contracts.md`.

Para cada task FULLSTACK da onda atual, gere um contrato. Copie `assets/contract-template.md` para `openspec/changes/<nome>/contracts/<task-id>.md` e preencha:

- endpoint, método HTTP;
- request schema, response schema;
- estados de erro/loading;
- permissões necessárias;
- regras de validação;
- exemplo de payload.

Se houver dúvida sobre campo/tipo, pergunte ao usuário antes de delegar — é mais barato que sincronizar depois.

---

## Fase 9 — Delegação Paralela

Use **uma única chamada** com múltiplos `Agent(..., run_in_background=true)` para a onda inteira.

Exemplo (Wave 1 com 2 tasks FULLSTACK + 1 BACKEND_ONLY = 5 agentes):

```text
[mesmo bloco de tool calls]
Agent(codex:codex-rescue, task-A back-end, run_in_background=true)
Agent(cc-gemini-plugin:gemini-agent, task-A front-end, run_in_background=true)
Agent(codex:codex-rescue, task-B back-end, run_in_background=true)
Agent(cc-gemini-plugin:gemini-agent, task-B front-end, run_in_background=true)
Agent(codex:codex-rescue, task-C back-end, run_in_background=true)
```

Prompts: copie de `references/subagent-prompts.md` e preencha placeholders. Cada prompt deve trazer:

1. descrição da task;
2. contrato API/UI (se FULLSTACK);
3. arquivos/módulos relevantes;
4. regras de escopo (não tocar fora do necessário);
5. bloco Context7 MCP quando `checks.optional.mcp.context7.ok=true`.
6. formato de retorno (resumo + arquivos alterados + decisões + testes + pendências + riscos).

Atualize `monitoring.md` para `RUNNING` em cada task envolvida.

---

## Fase 10 — Monitoramento

Não faça polling contínuo. Os agentes em background notificam ao concluir, mas o orquestrador deve fazer check-in leve quando uma task parecer estagnada.

Mantenha `openspec/changes/<nome>/monitoring.md` (cópia de `assets/monitoring-template.md`). Status válidos:

- `PENDING` — ainda não delegado
- `RUNNING` — agente rodando
- `BLOCKED` — agente reportou bloqueio (precisa de input)
- `NEEDS_SYNC` — contrato divergiu, precisa alinhar entre dupla
- `DONE` — agente concluiu, aguardando integração
- `FAILED` — agente falhou (pode precisar redelegar)
- `QUOTA_EXHAUSTED` — agente não consegue continuar por cota/rate limit/capacidade
- `REVIEWED` — passou pela fase 12

Use o evento `SLOW_CHECKIN` no log quando uma task em `RUNNING` estiver bloqueando a onda, sem atualização útil, ou muito fora do esperado para sua complexidade. Não há timeout fixo global: use julgamento contextual. O check-in deve pedir, de forma curta:

1. progresso concreto já concluído;
2. arquivos criados/alterados até agora;
3. bloqueios ou riscos;
4. ETA honesto;
5. se há falha de cota, tool, escrita/criação de arquivos ou terminal.

Interprete o check-in assim:

- resposta com progresso útil → mantenha `RUNNING` e registre `SLOW_CHECKIN` no log;
- resposta com cota/rate limit/capacidade (`quota exceeded`, `rate limit`, `billing`, `resource exhausted`, `model capacity`, `daily limit` ou similar) → marque `QUOTA_EXHAUSTED`;
- resposta com falha operacional do Gemini em tool/escrita/criação → pare de insistir no Gemini e faça handoff para orquestrador/Codex;
- resposta genérica ou sem progresso útil → marque `BLOCKED` ou redelegue para Codex quando for seguro.

Política de recuperação:

- `QUOTA_EXHAUSTED` no Gemini: revise arquivos parciais reportados e redelegue a continuação para `codex:codex-rescue`;
- falha operacional do Gemini em tools/escrita/criação: orquestrador/Codex revisa o estado parcial antes de continuar;
- `QUOTA_EXHAUSTED` no Codex: tente outro Codex/modelo apenas se houver caminho viável; caso contrário marque `BLOCKED` e peça decisão ao usuário;
- falha não relacionada a cota continua como `FAILED`, `BLOCKED` ou `NEEDS_SYNC`, conforme o caso.

Quando todas as tasks da onda chegarem em `DONE`, `FAILED`, `QUOTA_EXHAUSTED` ou `BLOCKED`, prossiga para a fase 11 apenas se houver ação clara de integração, redelegação ou decisão do usuário.

---

## Fase 11 — Integração dos Resultados

Para cada task concluída:

1. compare entrega com o que está em `tasks.md`;
2. valide o contrato API/UI (campos batem? tipos batem? estados de erro implementados?);
3. cheque arquivos alterados — algum fora do escopo da task?
4. cheque se algum agente removeu testes ou ignorou erro de build;
5. resolva divergências:
   - **campo divergente** (ex.: `description` vs `descricao`): decida com base no padrão do projeto, registre no relatório;
   - **conflito de arquivo**: se duas duplas tocaram o mesmo arquivo, faça merge mental e redelegue ajuste pontual;
   - **falha de agente**: redelegue com prompt ajustado;
   - **cota esgotada**: aplique a política de recuperação da fase 10 antes de integrar;
   - **falha operacional do Gemini**: revise arquivos parciais e prefira handoff para Codex.

Se houver ajuste pontual (até ~10 linhas e sem decisão arquitetural), você pode resolver direto. Se for maior, redelegue.

---

## Fase 12 — Review Pós-Implementação

Delegue ao Codex (gpt-5.5 high) para revisar o resultado **inteiro** antes do merge:

```text
Agent(
  subagent_type="codex:codex-rescue",
  description="Codex review pós-implementação <nome>",
  prompt="""
--model gpt-5.5-codex --effort high

Revise a implementação realizada pelos subagentes para a mudança OpenSpec <nome>.

Leia: openspec/changes/<nome>/{proposal,design,tasks}.md + diff git da branch.

Verifique:
- se o plano OpenSpec foi seguido;
- se os contratos API/UI foram respeitados;
- se há inconsistência entre back-end e front-end;
- se há risco de regressão;
- se há arquivos alterados desnecessariamente;
- se há problemas de segurança;
- se há problemas de tipagem;
- se há problemas de build;
- se faltam testes;
- se há pendências antes do merge.

Retorne:
1. APROVADO ou REPROVADO;
2. problemas bloqueantes;
3. problemas não bloqueantes;
4. recomendações;
5. checklist final.

NÃO modifique arquivos.
"""
)
```

Se REPROVADO ou com problemas bloqueantes, redelegue ajustes pontuais aos subagentes apropriados e revise de novo.

---

## Fase 13 — Verificação OpenSpec

```text
/openspec-verify-change <nome>
```

Se passar e a mudança trouxer specs novos:

```text
/openspec-sync-specs <nome>
```

Por último:

```text
/openspec-archive-change <nome>
```

> Se ainda houver pendências, **não arquive**. Volte à fase 11.

---

## Fase 14 — Contexto Consolidado e Relatório Final

Primeiro copie `assets/subagents-context-template.md` para `openspec/changes/<nome>/subagents-context.md` e preencha com o resumo de contexto de todos os subagentes Codex/Gemini executados.

Esse arquivo deve preservar o que o orquestrador precisa lembrar para finalizar, auditar e retomar a mudança:

- agente/subagent type e modelo usado;
- task/onda;
- status final;
- resumo do que foi feito;
- arquivos criados/alterados;
- decisões técnicas ou de UI/UX;
- testes/validações executadas;
- pendências e riscos;
- handoffs, falhas de cota/tool/escrita e próxima ação tomada.

Copie `assets/implementation-report-template.md` para `openspec/changes/<nome>/implementation-report.md` e preencha todas as seções:

1. Resumo Executivo
2. Objetivo da Mudança
3. Artefatos OpenSpec Utilizados
4. Agentes Utilizados
5. Tasks Executadas
6. Contratos Implementados
7. Decisões Técnicas
8. Ajustes Realizados Após Review
9. Riscos Identificados
10. Resumo de Contexto dos Subagentes
11. Testes e Validações
12. Critérios de Aceite (checklist)
13. Instruções de Negócio para o Usuário
14. Pendências
15. Conclusão

Encerre informando ao usuário:

- caminho do relatório;
- caminho do contexto consolidado dos subagentes;
- resumo em 2-3 frases;
- instruções de negócio sobre a feature implementada;
- próximo passo recomendado (merge, homologação, follow-up).

## Fase 15 — Instruções de Negócio

Após a finalização das tasks, entregue instruções em nível de negócio para o usuário. Não limite o fechamento ao resumo técnico. Traduza a feature implementada para quem precisa validar, operar, explicar ou colocar a mudança em produção.

Formato recomendado:

1. **O que mudou para o negócio:** capacidade nova, processo alterado ou problema resolvido.
2. **Como homologar:** roteiro curto de validação pelo usuário final ou equipe de produto.
3. **Regras e limites:** regras de negócio relevantes, permissões, exceções, dados obrigatórios, limites conhecidos.
4. **Impactos operacionais:** suporte, dados, relatórios, comunicação com clientes, treinamento, monitoramento.
5. **Próximo passo:** merge/deploy/homologação/follow-up com owner quando houver pendência.

Registre essa mesma orientação em `implementation-report.md` na seção "Instruções de Negócio para o Usuário".
