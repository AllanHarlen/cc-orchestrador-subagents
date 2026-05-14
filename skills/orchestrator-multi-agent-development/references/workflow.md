# Workflow Detalhado por Fase

Este arquivo expande as 14 fases do `SKILL.md`. Leia a fase específica quando precisar do detalhe operacional. Não precisa ler tudo de uma vez.

## Índice

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
- [Fase 14 — Relatório Final](#fase-14--relatório-final)

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

**Modelo:** Claude Sonnet 4.6 Effort High (subagente `Plan`).

Antes de invocar, confirme com o usuário se está em `/effort high`. Se não estiver, peça para ajustar (o subagente herda o effort da sessão).

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

**Invocação:**

```text
Agent(
  subagent_type="Plan",
  description="Plano técnico da mudança <nome>",
  prompt="""
Você é o agente de planejamento técnico de uma mudança OpenSpec.

Contexto da demanda:
<COPIAR PARÁGRAFO DA FASE 1>

Repositório alvo:
- working dir: <PATH>
- stack: <STACK>
- módulos envolvidos: <LISTA>

Template do plano (preencha todas as seções):
<COLAR plan-template.md>

Restrições:
- O plano deve ser executável em paralelo sempre que possível;
- Cada task deve ter contrato claro, entrada e saída definida;
- Riscos arquiteturais devem ser explícitos;
- A estratégia de testes deve cobrir back-end e front-end;
- Critérios de aceite devem ser mensuráveis.

Salve o resultado em openspec/changes/<nome>/proposal.md, design.md e tasks.md
(divida o conteúdo conforme apropriado).
"""
)
```

Saída: artefatos OpenSpec preenchidos pelo subagente Plan.

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
5. formato de retorno (resumo + arquivos alterados + decisões + testes + pendências + riscos).

Atualize `monitoring.md` para `RUNNING` em cada task envolvida.

---

## Fase 10 — Monitoramento

Não faça polling. Os agentes em background notificam ao concluir.

Mantenha `openspec/changes/<nome>/monitoring.md` (cópia de `assets/monitoring-template.md`). Status válidos:

- `PENDING` — ainda não delegado
- `RUNNING` — agente rodando
- `BLOCKED` — agente reportou bloqueio (precisa de input)
- `NEEDS_SYNC` — contrato divergiu, precisa alinhar entre dupla
- `DONE` — agente concluiu, aguardando integração
- `FAILED` — agente falhou (pode precisar redelegar)
- `REVIEWED` — passou pela fase 12

Quando todas as tasks da onda chegarem em `DONE` ou `FAILED`, prossiga para a fase 11.

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
   - **falha de agente**: redelegue com prompt ajustado.

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

## Fase 14 — Relatório Final

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
10. Testes e Validações
11. Critérios de Aceite (checklist)
12. Pendências
13. Conclusão

Encerre informando ao usuário:

- caminho do relatório;
- resumo em 2-3 frases;
- próximo passo recomendado (merge, homologação, follow-up).
