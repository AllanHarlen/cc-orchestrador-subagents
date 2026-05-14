# cc-orchestrador-subagents

Plugin de Claude Code que disponibiliza a skill **`orchestrator-multi-agent-development`** e o comando **`/orchestrator`** para conduzir um fluxo de desenvolvimento multiagêntico ponta a ponta:

1. Entendimento da demanda
2. Criação de mudança no **OpenSpec**
3. Elaboração do plano com **Claude Sonnet 4.6 Effort High** (via subagente `Plan`)
4. Revisão crítica do plano com **Codex gpt-5.5 Effort High** (via subagente `codex:codex-rescue`)
5. Consolidação do plano pelo orquestrador (**Claude Sonnet 4.6 Effort Medium**)
6. Classificação e decomposição das tasks em paralelizáveis
7. Execução paralela de duplas back-end/front-end:
   - **Back-end:** `codex:codex-rescue` com `--model gpt-5.4-codex --effort medium`
   - **Front-end:** `cc-gemini-plugin:gemini-agent` (Gemini 3 para UI complexa, Gemini 3 Flash para UI simples) com skills `frontend-developer` e `ui-ux-designer`
8. Monitoramento dos subagentes em background
9. Review pós-implementação com Codex
10. Verificação OpenSpec (`/openspec-verify-change`, `/openspec-sync-specs`, `/openspec-archive-change`)
11. Relatório final em Markdown (`implementation-report.md`)

## Pré-requisitos

Este plugin assume que os seguintes plugins/skills também estão instalados no Claude Code:

| Dependência | Origem | Como obter |
|---|---|---|
| `openai-codex` | https://github.com/openai/codex-plugin-cc | Marketplace `openai-codex` |
| `cc-gemini-plugin` | https://github.com/thepushkarp/cc-gemini-plugin | Marketplace `cc-gemini-plugin` |
| Skills OpenSpec | Já presentes em ambientes com OpenSpec (`openspec-new-change`, `openspec-ff-change`, `openspec-verify-change`, `openspec-sync-specs`, `openspec-archive-change`) | Marketplace OpenSpec |
| Skills `frontend-developer`, `ui-ux-designer`, `dotnet-architect`, `dotnet-backend-patterns`, `csharp-pro`, `postgresql` | Marketplace de skills | `npx skills add ...` |

Sem essas dependências o orquestrador continua funcionando, mas algumas fases pedirão fallback (por exemplo, planejamento direto em vez de subagente).

## Quando usar

Use o orquestrador quando a tarefa exigir **plano + revisão + execução coordenada**. Exemplos:

- nova funcionalidade end-to-end (API + tela);
- refatoração de módulo existente;
- correção de bug com impacto arquitetural;
- migração de sistema ou integração externa;
- melhoria de front-end ou back-end com risco de regressão.

**Não use** para tarefas triviais (renomear variável, ajustar padding, trocar texto de botão). Nesses casos resolva diretamente.

## Como invocar

Forma explícita:

```text
/orchestrator implemente o fluxo de reservas com listagem, criação e cancelamento
```

Forma implícita: descreva a tarefa que a skill irá auto-triggerar pela descrição (ex.: "preciso planejar e implementar uma migração de autenticação JWT com novo schema e nova tela").

## Layout do plugin

```
cc-orchestrador-subagents/
├── .claude-plugin/
│   └── plugin.json
├── README.md
├── commands/
│   └── orchestrator.md
└── skills/
    └── orchestrator-multi-agent-development/
        ├── SKILL.md
        ├── references/
        │   ├── workflow.md
        │   ├── agent-stack.md
        │   ├── subagent-prompts.md
        │   ├── parallelization.md
        │   ├── contracts.md
        │   └── openspec-integration.md
        └── assets/
            ├── plan-template.md
            ├── contract-template.md
            ├── monitoring-template.md
            └── implementation-report-template.md
```

## Princípios de design

- **O orquestrador não programa direto.** Ele planeja, revisa, divide, delega, monitora e consolida.
- **Progressive disclosure.** `SKILL.md` é o guia operacional; detalhes pesados ficam em `references/`.
- **Templates externos.** Tudo que é "copia e preenche" mora em `assets/` para evitar reescrever o mesmo Markdown em cada execução.
- **Sem agentes desnecessários.** Task só back-end = 1 agente. Task só front-end = 1 agente. Task full-stack = dupla.
- **Contrato antes do paralelismo.** Toda task full-stack passa por um contrato API/UI antes dos agentes saírem em paralelo, para evitar divergência de campos (ex.: `description` vs `descricao`).
- **Relatório obrigatório.** Toda execução fecha com `implementation-report.md`.

## Licença

A definir.
