# cc-orchestrador-subagents

Plugin de Claude Code que adiciona a skill **`orchestrator-multi-agent-development`** e o comando **`/orchestrator`** para conduzir um fluxo de desenvolvimento multiagêntico de ponta a ponta.

---

## Sumário

- [Visão geral](#visão-geral)
- [Pré-requisitos](#pré-requisitos)
- [Instalação](#instalação)
- [Uso](#uso)
- [Exemplo real](#exemplo-real)
- [Layout do plugin](#layout-do-plugin)
- [Princípios de design](#princípios-de-design)
- [Publicação na loja de plugins](#publicação-na-loja-de-plugins-do-claude-code)
- [Versionamento](#versionamento)
- [Licença](#licença)

---

## Visão geral

O `cc-orchestrador-subagents` transforma o Claude Code em um **gerente técnico de execução**, não em "mais um agente que programa". A skill assume que toda mudança relevante de software passa por:

1. especificação clara (via OpenSpec);
2. plano técnico feito pelo próprio orquestrador antes de codar;
3. revisão crítica do plano por outro modelo;
4. decomposição em tasks com contratos API/UI antes do paralelismo;
5. execução paralela de duplas back-end/front-end (Codex + Gemini) em background;
6. monitoramento sem polling contínuo, com check-ins leves para tasks lentas, integração e revisão pós-implementação;
7. contexto consolidado de todos os subagentes executados;
8. relatório final em Markdown com instruções de negócio para o usuário.

O orquestrador (Claude Sonnet 4.6 Medium) coordena o fluxo, mas **não executa subagentes Claude Code**. As únicas delegações do workflow são para Codex e Gemini via plugins:

| Papel | Modelo | Subagente |
|---|---|---|
| Orquestrador/planejador/finalizador | Claude Sonnet 4.6 Medium | — |
| Revisor de plano | Codex gpt-5.5 High | `codex:codex-rescue` |
| Executor back-end | Codex gpt-5.4 Medium | `codex:codex-rescue` |
| Executor front-end | Gemini 3 ou Gemini 3 Flash | `cc-gemini-plugin:gemini-agent` |
| Review pós-implementação | Codex gpt-5.5 High | `codex:codex-rescue` |

O fluxo completo está descrito em `skills/orchestrator-multi-agent-development/SKILL.md`.

### Para quem este plugin é

Times e devs solo que:

- já usam OpenSpec ou querem padronizar mudanças via spec;
- têm Codex e Gemini instalados e querem aproveitar especialização (back-end → Codex, front-end → Gemini);
- preferem plano e contrato antes do código em mudanças com risco arquitetural;
- querem rastreabilidade automática (proposal, design, tasks, contratos, monitoring, relatório final).

### Quando NÃO usar

Tarefas pequenas (typo, padding, rename, troca de cor pontual) — o orquestrador é overkill. Use Claude direto.

---

## Pré-requisitos

Antes da primeira invocação, o `/orchestrator` roda automaticamente `scripts/preflight.mjs`. Se faltar qualquer item da tabela abaixo, **a operação é cancelada** com instruções de remediação.

### Software base

| Item | Versão mínima | Verificar com | Como instalar |
|---|---|---|---|
| Node.js | 18.x | `node --version` | https://nodejs.org/en/download (LTS) |
| npm | 9.x | `npm --version` | acompanha o Node |
| git | 2.x | `git --version` | https://git-scm.com/downloads |

Node é necessário porque o preflight, o `codex-companion.mjs` (codex-plugin-cc) e o `gemini-bridge.js` (cc-gemini-plugin) rodam em Node.

### CLIs no PATH global

| CLI | Pacote npm | Pós-instalação |
|---|---|---|
| `gemini` | `@google/gemini-cli` | `gemini auth` |
| `codex` | `@openai/codex` | `codex login` |
| `openspec` | `@fission-ai/openspec` | `openspec init` no projeto alvo |

> **Atenção PATH no Windows:** depois de `npm install -g`, reinicie o Claude Code para que o PATH global seja relido. Se `gemini --version` funciona no PowerShell mas o preflight não enxerga, o problema é PATH não exposto à sessão do Claude.

### Plugins do Claude Code

| Plugin | Origem | Comandos para instalar |
|---|---|---|
| `cc-gemini-plugin` | https://github.com/thepushkarp/cc-gemini-plugin | `/plugin marketplace add thepushkarp/cc-gemini-plugin` → `/plugin install cc-gemini-plugin@cc-gemini-plugin` |
| `openai-codex` (codex-plugin-cc) | https://github.com/openai/codex-plugin-cc | `/plugin marketplace add openai/codex-plugin-cc` → `/plugin install codex@openai-codex` |

Estes plugins expõem os subagentes `cc-gemini-plugin:gemini-agent` e `codex:codex-rescue` que o orquestrador delega. O plugin também declara essas dependências em `.claude-plugin/plugin.json`, então versões recentes do Claude Code tentam resolvê-las automaticamente quando os marketplaces correspondentes já estão configurados.

### Permissao Bash para Codex

O subagente `codex:codex-rescue` e um wrapper fino: ele chama `node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" task ...` via `Bash` para acionar o Codex CLI. Como esse subagente roda em background, ele precisa que o projeto libere essa chamada antes do `/orchestrator` comecar.

Crie ou mantenha no projeto alvo:

```json
{
  "permissions": {
    "allow": [
      "Bash(node:*)"
    ]
  }
}
```

Esse bloco e o baseline minimo. O preflight exige ao menos uma regra compativel para a execucao do Codex companion.

Este repositorio inclui uma `.claude/settings.json` minima, sem dados de projeto externo, com `Bash(node:*)` e denies basicos. O preflight valida esse item e cancela cedo se a permissao compativel estiver ausente, evitando que o Codex fique bloqueado pedindo aprovacao de Bash no meio da execucao.

### Modo autonomo com `/goal`

Para o orquestrador trabalhar independente entre turnos, use `/goal`. O `/goal` depende de hooks do Claude Code e de workspace trusted. O preflight verifica configuracoes locais conhecidas que quebram hooks (`disableAllHooks` e `allowManagedHooksOnly`); se houver uma politica managed externa, o proprio Claude Code avisara quando `/goal` for usado.

Este repositorio tambem define `permissions.defaultMode: "auto"` em `.claude/settings.json`, para reduzir prompts de permissao durante execucoes longas. Em ambientes mais restritivos, rode explicitamente:

```bash
claude --permission-mode auto -p "/goal Execute a skill cc-orchestrador-subagents:orchestrator-multi-agent-development para: <demanda>. Condicao de conclusao: preflight OK; mudanca OpenSpec criada, planejada e revisada; ondas de subagentes Codex/Gemini encerradas ou bloqueios documentados; review pos-implementacao executado; verificacao OpenSpec executada ou impedimento registrado; subagents-context.md e implementation-report.md criados; resultados de testes/validacoes e instrucoes de negocio publicados na conversa; ou pare apos 20 turnos preservando o estado."
```

### Skills do OpenSpec

Em `~/.claude/skills/`, as seguintes skills são esperadas (instaladas pelo `openspec` CLI):

- `openspec-new-change`
- `openspec-ff-change`
- `openspec-apply-change`
- `openspec-verify-change`
- `openspec-archive-change`
- `openspec-sync-specs`

Se faltarem, rode `openspec init` no projeto alvo ou reinstale o CLI.

### Context7 MCP (opcional)

O preflight também tenta detectar Context7 MCP em `.mcp.json`, `~/.claude.json`, `~/.claude/mcp.json`, `~/.codex/config.toml`, `~/.gemini/settings.json` e nas skills `~/.claude/skills/context7*`. Essa checagem é opcional: se faltar, o orquestrador continua; se existir, os prompts de Codex/Gemini passam a exigir consulta ao Context7 antes de implementar APIs, bibliotecas, frameworks, SDKs, CLIs ou cloud services.

Instalação sugerida:

```bash
npx ctx7 setup --claude

# alternativa via MCP remoto:
claude mcp add --scope user --header "CONTEXT7_API_KEY: YOUR_API_KEY" --transport http context7 https://mcp.context7.com/mcp
```

### Verificação manual (opcional)

Antes de instalar este plugin, valide o ambiente:

```bash
node --version
gemini --version
codex --version
openspec --version
ls ~/.claude/plugins/cache/cc-gemini-plugin/
ls ~/.claude/plugins/cache/openai-codex/codex/
ls ~/.claude/skills | grep openspec
```

Se algum comando falhar, instale o que falta antes de continuar.

---

## Instalação

### Opção A — instalação local (durante desenvolvimento)

Para usar o plugin a partir do próprio diretório de trabalho:

```text
/plugin marketplace add C:\Users\allan\Desktop\Projetos Pessoais\cc-orchestrador-subagents
/plugin install cc-orchestrador-subagents@cc-orchestrador-subagents
```

> No macOS/Linux, use o caminho POSIX.
> No Windows, aspas duplas se o caminho tiver espaços.

### Opção B — instalação via GitHub (após publicar)

```text
/plugin marketplace add AllanHarlen/cc-orchestrador-subagents
/plugin install cc-orchestrador-subagents@cc-orchestrador-subagents
```

### Validar a instalação

1. Liste os comandos disponíveis (`/help`) e confirme que `/orchestrator` aparece.
2. Liste as skills disponíveis e confirme que `cc-orchestrador-subagents:orchestrator-multi-agent-development` aparece como skill do plugin.
3. Em qualquer projeto, rode:

   ```text
   /orchestrator preflight
   ```

   Você deve ver o JSON de preflight com `status: "ok"`. Se algo der "failed", siga as instruções de remediação que o orquestrador apresentar.

---

## Uso

### Forma explícita

```text
/orchestrator <descrição da demanda>
```

Exemplos:

```text
/orchestrator implemente o CRUD de reservas com listagem, criação e cancelamento

/orchestrator refatore o módulo de autenticação para suportar refresh tokens e revogação de sessão

/orchestrator migre o storage de avatares do disco local para S3 com fallback durante o cutover
```

### Forma autonoma com `/goal`

Para deixar o Claude continuar entre turnos ate o fim verificavel:

```text
/goal Execute a skill cc-orchestrador-subagents:orchestrator-multi-agent-development para: implemente o CRUD de reservas com listagem, criacao e cancelamento. Condicao de conclusao: preflight OK; mudanca OpenSpec criada, planejada e revisada; ondas de subagentes Codex/Gemini encerradas ou bloqueios documentados; review pos-implementacao executado; verificacao OpenSpec executada ou impedimento registrado; subagents-context.md e implementation-report.md criados; resultados de testes/validacoes e instrucoes de negocio publicados na conversa; ou pare apos 20 turnos preservando o estado.
```

O avaliador do `/goal` nao le arquivos nem roda comandos por conta propria. Por isso o orquestrador sempre publica no chat os caminhos criados, resultados de testes/validacoes e criterios restantes antes de encerrar cada turno.

Modo headless:

```bash
claude --permission-mode auto -p "/goal Execute a skill cc-orchestrador-subagents:orchestrator-multi-agent-development para: implemente o CRUD de reservas com listagem, criacao e cancelamento. Condicao de conclusao: preflight OK; mudanca OpenSpec criada, planejada e revisada; ondas de subagentes Codex/Gemini encerradas ou bloqueios documentados; review pos-implementacao executado; verificacao OpenSpec executada ou impedimento registrado; subagents-context.md e implementation-report.md criados; resultados de testes/validacoes e instrucoes de negocio publicados na conversa; ou pare apos 20 turnos preservando o estado."
```

### Invocacao direta da skill

A skill é manual-only (`disable-model-invocation: true`) para evitar que Claude inicie um workflow com efeitos colaterais apenas por reconhecer palavras como "implemente" ou "refatore". Prefira `/orchestrator`; se quiser chamar a skill diretamente, use o nome com namespace:

```text
/cc-orchestrador-subagents:orchestrator-multi-agent-development <demanda>
```

### O que esperar em cada fase

| Fase | O que o orquestrador faz | O que você precisa fazer |
|---|---|---|
| -1. Goal | quando usado com `/goal`, publica evidencias e continua entre turnos ate a condicao ser cumprida | nada, salvo bloqueios reais |
| 0. Preflight | roda `scripts/preflight.mjs`, valida CLIs e plugins | nada, ou instalar o que faltar |
| 1. Entendimento | extrai objetivo, escopo, stack, riscos | responder a perguntas com `AskUserQuestion` se algo for ambíguo |
| 2. OpenSpec | cria `openspec/changes/<nome>/` com `/openspec-new-change` + `/openspec-ff-change` | confirmar o nome da mudança |
| 3. Plano | preenche o plano diretamente usando `assets/plan-template.md` | revisar o plano gerado |
| 4. Review do plano | delega ao Codex gpt-5.5 high para revisar | nada (aguardar) |
| 5. Consolidação | aplica sugestões válidas, rejeita o resto com justificativa | aprovar a consolidação |
| 6-7. Classificação e ondas | classifica tasks e monta waves paralelas | revisar `tasks-classification.md` e `waves.md` |
| 8. Contratos API/UI | gera `contracts/<task>.md` para cada FULLSTACK | aprovar contratos antes do paralelismo |
| 9. Delegação paralela | lança 1-6 subagentes em background | nada (aguardar notificações) |
| 10. Monitoramento | atualiza `monitoring.md` conforme agentes concluem; faz check-in leve se task parecer estagnada | nada, salvo se houver bloqueio/cota |
| 11. Integração | resolve divergências entre agentes | decidir em divergências de design |
| 12. Review final | delega ao Codex gpt-5.5 high para revisar tudo | revisar `review-final.md` |
| 13. Verificação OpenSpec | roda `/openspec-verify-change` → `/openspec-sync-specs` → `/openspec-archive-change` | nada |
| 14. Relatório | gera `subagents-context.md` e `implementation-report.md` | revisar e seguir para merge |
| 15. Instruções de negócio | explica a feature em termos de homologação/operação/produto | validar próximos passos |

### Cancelamento e retomada

- **Preflight falhou:** instale o que falta e rode `/orchestrator` de novo.
- **Plano reprovado pelo Codex:** o orquestrador re-elabora (ou pede sua decisão) e re-revisa.
- **Subagente falhou ou esgotou cota:** o orquestrador registra a evidência, atualiza `monitoring.md` e só redelega para subagente permitido (normalmente Codex gpt-5.4 medium) se não houver pausa/cancelamento do usuário; caso contrário bloqueia para sua decisão.
- **Você quer abortar:** diga "cancela" no chat — o orquestrador marca `CANCELLED`, não lança novos subagentes, não faz handoff automático e mantém os artefatos OpenSpec para retomada futura.

---

## Exemplo real

Cenário: você está num projeto .NET 8 + React 18 + Ant Design 5 + PostgreSQL e precisa implementar **fluxo de reservas** (listagem, criação, cancelamento).

### Invocação

```text
/orchestrator implemente o fluxo de reservas com listagem, criação e cancelamento.
Stack: .NET 8 (back-end), React 18 + Ant Design 5 (front-end), PostgreSQL.
Convenções: clean architecture, EF Core, MediatR.
```

### Fase 0 — Preflight (1 turno)

```
preflight OK — gemini 0.42.0, codex-cli 0.130.0, openspec 1.3.1.
```

### Fase 1-2 — Entendimento + OpenSpec (1 turno)

O orquestrador pergunta apenas o que falta:

```
AskUserQuestion:
  Pergunta: Cancelamento de reserva deve ser hard delete ou soft delete?
  Opções: [Soft delete (recomendado), Hard delete]
```

Você responde "Soft delete". O orquestrador cria:

```
openspec/changes/fluxo-reservas/
├── proposal.md         (vazio, será preenchido na fase 3)
├── design.md
├── tasks.md
└── specs/
```

### Fase 3 — Plano (orquestrador, ~1 turno)

O orquestrador preenche os artefatos com base no `assets/plan-template.md`. Nenhum subagente Claude Code é chamado nesta fase. Resumo no chat:

```
Plano gerado. 3 tasks identificadas:
- T1 (FULLSTACK): listagem de reservas
- T2 (FULLSTACK): criação de reserva
- T3 (FULLSTACK): cancelamento (soft delete)

Riscos top 3:
1. Concorrência de reserva no mesmo período (resolvido via constraint exclusiva no Postgres);
2. Validação de checkin < checkout precisa estar em ambos os lados;
3. Soft delete exige filtro global no EF Core para não vazar reservas canceladas.
```

### Fase 4 — Review do plano (Codex gpt-5.5 high, ~2 min)

```
Codex review do plano:

Decisão: APROVADO COM AJUSTES.

Sugestões obrigatórias:
- T2 deve validar disponibilidade ANTES de inserir; constraint sozinha gera 500.
- Falta critério de aceite mensurável em T3 (resposta < 200ms p95).

Sugestões opcionais:
- Considerar feature flag para o cancelamento.
```

### Fase 5 — Consolidação (1 turno)

```
Aceitei as 2 sugestões obrigatórias. Rejeitei a feature flag (mudança pequena, custo de manter o flag não justifica). tasks.md atualizado.
```

### Fase 6-7 — Classificação e ondas (1 turno)

```
Wave 1 (paralelizável):
- T1 listagem (FULLSTACK)
- T2 criação (FULLSTACK)

Wave 2 (depende de T1 e T2):
- T3 cancelamento (FULLSTACK)

T3 depende porque reusa a entidade Reserva e a tela criada em T1/T2.
```

### Fase 8 — Contratos da Wave 1 (1 turno)

Gera:

- `contracts/T1.md` — GET /api/reservas (paginado, com filtros)
- `contracts/T2.md` — POST /api/reservas

Pergunta de contrato:

```
AskUserQuestion:
  Pergunta: Campo de check-in/check-out usa string ISO 8601 ou epoch?
  Opções: [ISO 8601 (recomendado), Epoch milliseconds]
```

Você responde "ISO 8601". Contratos finalizados.

### Fase 9 — Delegação paralela Wave 1 (1 turno, 4 subagentes em background)

```
Lancei 4 subagentes em paralelo para a Wave 1:
- T1 back-end: codex:codex-rescue (gpt-5.4 medium)
- T1 front-end: cc-gemini-plugin:gemini-agent (gemini-3-pro)
- T2 back-end: codex:codex-rescue (gpt-5.4 medium)
- T2 front-end: cc-gemini-plugin:gemini-agent (gemini-3-pro)

Aviso quando completarem. Estimativa: 5-8 minutos.
```

### Fase 10 — Monitoramento (notificações conforme chegam)

```
[notificação] T1 back-end DONE — 12 arquivos alterados.
[notificação] T2 back-end DONE — 9 arquivos alterados.
[notificação] T1 front-end DONE — 6 arquivos alterados.
[monitoramento] T2 front-end SLOW_CHECKIN — pedindo progresso, arquivos tocados, bloqueios, riscos, ETA e falhas de cota/tools.
[notificação] T2 front-end NEEDS_SYNC — front-end espera campo `status` na response, contrato não cobre.

Pausando T2. Decisão: incluir `status: PENDING | CONFIRMED | CANCELLED` no contrato.
Contrato atualizado. Redelegando apenas o front-end de T2.

[notificação] T2 front-end DONE — 4 arquivos alterados.
```

### Fase 11 — Integração Wave 1 (1 turno)

```
Wave 1 integrada sem conflito.
Migrations validadas (`dotnet ef migrations script`).
```

### Wave 2 — T3 cancelamento (repete fases 8-11, ~6 min)

```
Wave 2 concluída. 1 dupla de agentes para T3.
```

### Fase 12 — Review final (Codex gpt-5.5 high, ~3 min)

```
Codex review final:
Decisão: APROVADO.

Problemas não bloqueantes:
- Faltam testes de integração para o cenário de race condition em T2.
- Cobertura de testes do back-end caiu de 78% para 74%.

Recomendações:
- Adicionar teste de concorrência em T2 antes do próximo PR.
```

### Fase 13 — Verificação OpenSpec (1 turno)

```
/openspec-verify-change fluxo-reservas → OK
/openspec-sync-specs fluxo-reservas → 2 specs novos sincronizados
/openspec-archive-change fluxo-reservas → arquivado
```

### Fase 14 — Contexto e relatório (1 turno)

```
Contexto dos subagentes criado: openspec/changes/fluxo-reservas/subagents-context.md
Relatório criado: openspec/changes/fluxo-reservas/implementation-report.md

Resumo:
- 3 tasks FULLSTACK entregues em 2 waves
- 6 subagentes utilizados (4 na Wave 1, 1 dupla na Wave 2)
- 1 sincronização de contrato durante execução
- 1 pendência não bloqueante: teste de concorrência

Instruções de negócio:
- Produto deve homologar listagem, criação e cancelamento de reservas com datas reais e conflito de disponibilidade.
- Suporte deve saber que reservas canceladas ficam ocultas do fluxo principal, mas continuam preservadas para auditoria.
- Operação deve monitorar erros de conflito no POST /api/reservas após o deploy para identificar disputa de horários.

Pronto para merge. Próximo passo: revisar relatório/contexto consolidado e abrir PR.
```

### Artefatos gerados no projeto

```
openspec/changes/fluxo-reservas/
├── proposal.md
├── design.md
├── tasks.md
├── tasks-classification.md
├── waves.md
├── contracts/
│   ├── T1.md
│   ├── T2.md
│   └── T3.md
├── monitoring.md
├── subagents-context.md          (resumo consolidado dos subagentes)
├── review-codex.md            (review do plano)
├── review-final.md            (review pós-implementação)
├── specs/                     (deltas sincronizados na fase 13)
└── implementation-report.md   (entregável final + instruções de negócio)
```

**Tempo total estimado:** 25-35 minutos de relógio, dos quais ~80% é tempo dos subagentes em background. Sem orquestrador, a mesma mudança levaria horas de tab switching.

---

## Layout do plugin

```
cc-orchestrador-subagents/
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
├── README.md
├── scripts/
│   └── preflight.mjs
├── commands/
│   └── orchestrator.md
└── skills/
    └── orchestrator-multi-agent-development/
        ├── SKILL.md
        ├── references/
        │   ├── preflight-check.md
        │   ├── workflow.md
        │   ├── agent-stack.md
        │   ├── subagent-prompts.md
        │   ├── parallelization.md
        │   ├── contracts.md
        │   └── openspec-integration.md
        ├── scripts/
        │   └── preflight.mjs
        └── assets/
            ├── plan-template.md
            ├── contract-template.md
            ├── monitoring-template.md
            ├── subagents-context-template.md
            └── implementation-report-template.md
```

---

## Princípios de design

- **O orquestrador não programa direto.** Ele planeja, revisa, divide, delega, monitora e consolida.
- **Cancelamento é gate operacional.** Se o usuário pedir pausa/cancelamento ou apontar problema bloqueante, o fluxo para antes de qualquer nova delegação.
- **Sem remendos manuais durante o workflow.** Ajustes pontuais, recuperação de falha e handoffs são delegados a Codex gpt-5.4 medium; Claude mantém contexto e artefatos.
- **Preflight cancela ao invés de degradar.** Sem agentes especializados, a skill perde valor.
- **Progressive disclosure.** `SKILL.md` é o guia operacional; detalhes pesados ficam em `references/`.
- **Templates externos.** Tudo que é "copia e preenche" mora em `assets/` para evitar reescrever o mesmo Markdown em cada execução.
- **Sem agentes desnecessários.** Task só back-end = 1 agente. Task só front-end = 1 agente. Task full-stack = dupla.
- **Contrato antes do paralelismo.** Toda task full-stack passa por um contrato API/UI antes dos agentes saírem em paralelo — evita divergência de campos (`description` vs `descricao`).
- **Sem polling contínuo.** Subagentes em background notificam ao concluir; o orquestrador atualiza `monitoring.md` sob demanda e faz `SLOW_CHECKIN` quando uma task parece estagnada.
- **Sem subagente Claude para planejar.** O orquestrador mantém o conhecimento geral e só delega para Codex/Gemini via plugins.
- **Contexto consolidado obrigatório.** Toda execução registra `subagents-context.md` com o resumo de todos os subagentes executados.
- **Relatório obrigatório com instruções de negócio.** Toda execução fecha com `implementation-report.md` e orientações para homologar/operar a feature.

---
