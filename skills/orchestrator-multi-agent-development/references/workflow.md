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
e- [Fase 14 — Log, Contexto Consolidado e Relatório Final](#fase-14--log-contexto-consolidado-e-relatório-final)
- [Fase 15 — Instruções de Negócio](#fase-15--instruções-de-negócio)

---

## Modo Goal Autonomo

Use `/goal` quando o workflow precisa continuar entre turnos sem o usuario dar o proximo empurrao. A condicao precisa ser mensuravel e demonstravel na conversa, porque o avaliador do `/goal` nao executa comandos nem le arquivos por conta propria.

Condicao padrao para o orquestrador:

```text
/goal Execute a skill cc-orchestrador-subagents:orchestrator-multi-agent-development para: <demanda>. Condicao de conclusao: preflight OK; mudanca OpenSpec criada, planejada e revisada; ondas de subagentes Codex/Gemini encerradas ou bloqueios documentados; review pos-implementacao executado; verificacao OpenSpec executada ou impedimento registrado; workflow-log.md, subagents-context.md e implementation-report.md criados; resultados de testes/validacoes e instrucoes de negocio publicados na conversa; ou pare apos 20 turnos preservando o estado.
```

Durante cada turno sob `/goal`, mantenha o trabalho andando ate a proxima acao real. Antes de encerrar o turno, escreva um bloco curto de evidencias:

- fase atual;
- artefatos criados/atualizados;
- subagentes em execucao, concluidos, bloqueados ou com cota esgotada;
- comandos/testes/validacoes executados e resultado;
- criterios restantes da condicao.

Se a condicao ainda nao estiver satisfeita, o avaliador dara continuidade. Se houver bloqueio sem recuperacao segura, registre `BLOCKED`/`PAUSED`, atualize `workflow-log.md` quando a mudanca OpenSpec ja existir, explique a pendencia e preserve os artefatos.

---

## Fase 0 — Preflight Check

**Obrigatória. Bloqueante. Incontornável. Roda antes de qualquer outra coisa — inclusive antes de ler artefatos existentes ou entender a demanda.**

Se você se encontrar prestes a fazer qualquer ação (ler proposal.md, planejar, abrir OpenSpec) e ainda não rodou o preflight nesta invocação, pare imediatamente e execute agora.

Execute:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/preflight.mjs"
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
| `/goal` hooks | Claude Code settings | `disableAllHooks` nao pode estar `true`; workspace precisa estar trusted |
| `context7` MCP | opcional | ver `checks.optional.mcp.context7` no JSON |

Quando o preflight retorna falha, **não tente fallback automático**. A política é: cancele com a mensagem padrão (formato em `references/preflight-check.md`) e oriente o usuário a instalar/atualizar/configurar o que falta antes de invocar novamente.

Context7 é exceção: ele aparece em `checks.optional.mcp.context7`, não entra em `failed` e nunca bloqueia. Se estiver disponível, use-o nos prompts de Codex/Gemini para confirmar documentação atual de bibliotecas/frameworks/APIs.

> Detalhes completos de cada dependência, remediação e troubleshooting cross-platform: `references/preflight-check.md`.

---

## Gate operacional entre fases

Antes de iniciar qualquer fase, lançar subagentes, fazer check-in ou redelegar trabalho, confirme a mensagem mais recente do usuário e o estado registrado em `monitoring.md`.

Pare imediatamente quando houver:

- cancelamento explícito: "cancela", "aborta", "para", "não continue";
- pausa: "pausa", "aguarde", "espera";
- reprovação ou problema bloqueante: "não é isso", "reprovado", "tem problema", mudança de escopo que invalide plano/contrato;
- status já registrado como `CANCELLED` ou `PAUSED`.

Ao parar:

1. Não invoque novos subagentes.
2. Não faça handoff automático.
3. Não implemente código diretamente.
4. Atualize `monitoring.md` e `workflow-log.md` com `CANCELLED` ou `PAUSED`, incluindo motivo, fase, impacto e timestamp.
5. Se já existirem retornos parciais, registre-os em `subagents-context.md` para retomada.
6. Responda ao usuário com estado atual, artefatos preservados e condição mínima para retomar.

Cancelamento é terminal para a execução atual. Retomada exige uma nova instrução explícita do usuário confirmando o plano revisado ou autorizando uma nova onda.

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

**Artefatos existentes:** se `openspec/changes/<nome>/` já existe com `proposal.md`, leia-o antes de qualquer planejamento novo. Compare o objetivo atual com o escopo registrado. Se houver divergência de escopo (funcionalidade diferente, stack diferente, módulo diferente), use `AskUserQuestion` para confirmar: atualizar os artefatos existentes ou criar nova mudança com nome diferente? Nunca reutilize artefatos de execução anterior sem confirmar que ainda refletem a demanda atual.

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

### Gate de suficiência — obrigatório antes de avançar para a Fase 4

Antes de delegar o review ao Codex, confirme que o plano está minimamente completo. Se qualquer item estiver faltando, preencha agora — o Codex não pode revisar o que não existe.

- [ ] Todas as tasks têm ID, título, categoria e dependências definidas
- [ ] Pelo menos um critério de aceite mensurável por task (passa em teste, retorna status X)
- [ ] Estratégia de rollback descrita (mesmo que "revert do commit")
- [ ] Impactos em banco de dados documentados (mesmo que "N/A — sem migração")
- [ ] Impactos em autenticação/autorização documentados (mesmo que "N/A")
- [ ] Riscos arquiteturais listados (mesmo que "nenhum identificado")

Só após esse gate avance. Um plano incompleto resulta em review superficial e retrabalho na Fase 5.

**Salve o gate:** após confirmar todos os itens, escreva o checklist preenchido em `openspec/changes/<nome>/plan-sufficiency-check.md`. Formato simples: copie os 6 itens com `[x]` ou `[ ]` e adicione timestamp. O arquivo serve como evidência auditável de que o plano passou o gate antes de ir para revisão.

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

### Tratamento obrigatório do resultado do review

Independentemente da decisão do Codex, **sempre avance para a Fase 5**. O review nunca é um ponto de parada — é uma entrada para a consolidação.

| Decisão do Codex | O que fazer na Fase 5 |
|---|---|
| `APROVADO` | Registre em `review-codex.md` e avance para Fase 6 |
| `APROVADO COM AJUSTES` | Trate as sugestões obrigatórias, registre as rejeitadas com justificativa, avance |
| `REPROVADO` | **Trate todos os problemas bloqueantes** nos artefatos OpenSpec, re-execute a Fase 4 apenas se o escopo mudou substancialmente; caso contrário, avance com o plano corrigido |

**Não pare o workflow em REPROVADO.** REPROVADO significa "há trabalho de consolidação a fazer antes de implementar" — não significa "cancele tudo". O orquestrador resolve os problemas e continua.

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

**Verificações antes de delegar:**

1. **Contagem da onda:** some todos os agentes a lançar (cada task FULLSTACK = 2, BACKEND_ONLY = 1, FRONTEND_ONLY = 1). Se N > 6, divida a onda em partes menores antes de prosseguir. Escreva no chat: "Lançando N agentes nesta onda (limite: 6)."

2. **Skills reais no ambiente:** leia a lista de skills disponíveis no `<system-reminder>` do turno atual. Para cada skill citada nos templates de prompt (ex.: `csharp-pro`, `dotnet-architect`, `frontend-developer`), confirme que ela aparece na lista pelo nome exato. Remova do prompt qualquer skill ausente. Nunca cite skill que não existe no ambiente do usuário.

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

### Heurísticas de `SLOW_CHECKIN` — quando disparar

Use o julgamento contextual, mas aplique as heurísticas abaixo como referência objetiva:

| Complexidade da task | Disparar SLOW_CHECKIN se sem notificação após |
|---|---|
| `simples` | 3 minutos |
| `média` | 5 minutos |
| `complexa` | 8 minutos |
| Qualquer complexidade | Imediatamente se outra task da mesma onda já concluiu e esta não |

Outros gatilhos para SLOW_CHECKIN independente de tempo:

- A task está bloqueando o início da próxima onda
- O agente confirmou início mas não reportou nenhum arquivo criado/alterado
- Você suspeita de loop de retry (agente tentando contornar cota/rate limit)

Registre cada SLOW_CHECKIN no log de `monitoring.md` com timestamp.

Mantenha `openspec/changes/<nome>/monitoring.md` (cópia de `assets/monitoring-template.md`). Status válidos:

- `PENDING` — ainda não delegado
- `RUNNING` — agente rodando
- `PAUSED` — usuário pediu pausa ou há problema bloqueante aguardando decisão
- `CANCELLED` — usuário cancelou/abortou a execução atual
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
- resposta com falha operacional do Gemini em tool/escrita/criação → pare de insistir no Gemini, registre evidência e delegue revisão/continuação para Codex gpt-5.4 medium se o gate do usuário permitir;
- resposta genérica ou sem progresso útil → marque `BLOCKED` ou redelegue para Codex quando for seguro.

Política de recuperação:

- `QUOTA_EXHAUSTED` no Gemini: registre arquivos parciais reportados e redelegue a continuação para `codex:codex-rescue` (`--model gpt-5.4-codex --effort medium`) se não houver cancelamento/pausa;
- falha operacional do Gemini em tools/escrita/criação: orquestrador registra o estado parcial e delega revisão/continuação para Codex gpt-5.4 medium antes de continuar;
- `QUOTA_EXHAUSTED` no Codex: tente outro Codex/modelo apenas se houver caminho viável; caso contrário marque `BLOCKED` e peça decisão ao usuário;
- falha não relacionada a cota continua como `FAILED`, `BLOCKED` ou `NEEDS_SYNC`, conforme o caso.

### Níveis de autonomia no fallback Gemini → Codex

**Fallback automático permitido** (orquestrador pode agir sem confirmar com o usuário):

- `QUOTA_EXHAUSTED` no Gemini com arquivos parciais claramente listados e task de UI simples (Gemini Flash → Codex gpt-5.4 medium)
- Falha operacional de tool/escrita isolada em task `simples` com contrato claro

**Fallback requer confirmação do usuário** (pare e pergunte):

- `QUOTA_EXHAUSTED` no Gemini 3 em UI complexa (dashboard, wizard, design system) — a qualidade do Codex pode ser insuficiente para substituir
- Falha grave que invalida o contrato ou exige revisão de escopo
- Handoff que muda o modelo de implementação (ex.: Gemini estava criando componentes novos, Codex precisaria reescrever do zero)
- Qualquer fallback que afete mais de uma task da onda

Quando todas as tasks da onda chegarem em `DONE`, `FAILED`, `QUOTA_EXHAUSTED` ou `BLOCKED`, prossiga para a fase 11 apenas se houver ação clara de integração, redelegação ou decisão do usuário. Se qualquer item estiver `PAUSED` ou `CANCELLED`, não avance.

**Heartbeat de visibilidade:** publique um update curto na conversa em dois momentos:
- quando cada onda completar (todas as tasks em DONE/FAILED/BLOCKED/QUOTA_EXHAUSTED);
- quando qualquer task permanecer em RUNNING por mais de 3 minutos sem notificação.

Formato do update (máximo 3 linhas): onda atual, contagem de tasks por status, próximo passo. Exemplo: "Onda 1: 2 DONE, 1 RUNNING — aguardando T3 front-end; se não concluir em ~2 min, SLOW_CHECKIN."

---

## Fase 11 — Integração dos Resultados

Para cada task concluída:

1. compare entrega com o que está em `tasks.md`;
2. valide o contrato API/UI (campos batem? tipos batem? estados de erro implementados?);
3. cheque arquivos alterados — algum fora do escopo da task?
4. cheque se algum agente removeu testes ou ignorou erro de build;
5. resolva divergências:
   - **campo divergente** (ex.: `description` vs `descricao`): decida com base no padrão do projeto, registre no relatório;
   - **conflito de arquivo**: se duas duplas tocaram o mesmo arquivo, decida a estratégia e redelegue ajuste pontual para Codex gpt-5.4 medium;
   - **falha de agente**: redelegue com prompt ajustado;
   - **cota esgotada**: aplique a política de recuperação da fase 10 antes de integrar;
   - **falha operacional do Gemini**: registre arquivos parciais e faça handoff para Codex.

Se houver ajuste pontual, delegue para `codex:codex-rescue` com `--model gpt-5.4-codex --effort medium` e prompt restrito ao arquivo/trecho. O orquestrador não edita código produtivo, testes, migrations ou componentes diretamente durante o workflow.

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

## Fase 14 — Log, Contexto Consolidado e Relatório Final

Primeiro copie `assets/workflow-log-template.md` para `openspec/changes/<nome>/workflow-log.md` e preencha com a linha do tempo auditável do workflow inteiro, da Fase -1/0 até a Fase 15 quando aplicável. O log deve registrar decisões do orquestrador, artefatos criados/atualizados, validações, subagentes acionados, falhas possíveis, falhas ocorridas, evidência curta, impacto, fallback, bloqueio, pausa, cancelamento e próxima ação.

Se o workflow estiver `PAUSED`, `CANCELLED` ou `BLOCKED`, ainda assim entregue `workflow-log.md` como artefato de retomada. Quando uma falha ocorrer depois que a mudança OpenSpec já existe, atualize o log com: fase, evento, evidência curta, impacto, status final e próxima ação. Use `monitoring.md` como fonte viva de eventos de ondas/subagentes, mas consolide no `workflow-log.md` apenas o que for relevante para auditoria e retomada.

Depois copie `assets/subagents-context-template.md` para `openspec/changes/<nome>/subagents-context.md` e preencha com o resumo de contexto de todos os subagentes Codex/Gemini executados.

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

Copie `assets/implementation-report-template.md` para `openspec/changes/<nome>/implementation-report.md` e preencha todas as seções. O relatório deve linkar e resumir `workflow-log.md`, sem duplicar a linha do tempo operacional completa:

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

- caminho do log de workflow;
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
