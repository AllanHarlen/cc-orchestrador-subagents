# cc-orchestrador-subagents

Plugin de Claude Code que disponibiliza a skill **`orchestrator-multi-agent-development`** e o comando **`/orchestrator`** para conduzir um fluxo de desenvolvimento multiagêntico ponta a ponta:

0. **Preflight check** — valida CLIs (`gemini`, `codex`, `openspec`) e plugins Claude Code (`cc-gemini-plugin`, `openai-codex`); cancela a operação se algo faltar
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

## Pré-requisitos validados pelo preflight

Quando o usuário invoca `/orchestrator`, o plugin roda `scripts/preflight.mjs` **antes de qualquer outra ação**. Se qualquer item abaixo estiver ausente ou indisponível, a operação é cancelada com mensagem clara e o usuário recebe os passos de remediação.

| Dependência | Tipo | Como obter |
|---|---|---|
| `gemini` CLI | binário no PATH global | `npm install -g @google/gemini-cli` (+ `gemini auth`) |
| `codex` CLI | binário no PATH global | `npm install -g @openai/codex` (+ `codex login`) |
| `openspec` CLI | binário no PATH global | `npm install -g @fission-ai/openspec` (+ `openspec init`) |
| Plugin `cc-gemini-plugin` | Claude Code plugin | `/plugin marketplace add thepushkarp/cc-gemini-plugin` → `/plugin install cc-gemini-plugin@cc-gemini-plugin` |
| Plugin `openai-codex` (codex-plugin-cc) | Claude Code plugin | `/plugin marketplace add openai/codex-plugin-cc` → `/plugin install codex@openai-codex` |
| Skills `openspec-*` (`new-change`, `ff-change`, `apply-change`, `verify-change`, `archive-change`, `sync-specs`) | em `~/.claude/skills/` | reinstaladas automaticamente quando `openspec` CLI roda |

Detalhes completos em `skills/orchestrator-multi-agent-development/references/preflight-check.md`.

> O preflight **não** tenta fallback. Faltou algo, cancela. A justificativa: a skill perde valor sem os agentes especializados — melhor parar e instalar do que rodar degradado.

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
        └── assets/
            ├── plan-template.md
            ├── contract-template.md
            ├── monitoring-template.md
            └── implementation-report-template.md
```

## Princípios de design

- **O orquestrador não programa direto.** Ele planeja, revisa, divide, delega, monitora e consolida.
- **Preflight cancela ao invés de degradar.** Sem agentes especializados, a skill perde valor.
- **Progressive disclosure.** `SKILL.md` é o guia operacional; detalhes pesados ficam em `references/`.
- **Templates externos.** Tudo que é "copia e preenche" mora em `assets/` para evitar reescrever o mesmo Markdown em cada execução.
- **Sem agentes desnecessários.** Task só back-end = 1 agente. Task só front-end = 1 agente. Task full-stack = dupla.
- **Contrato antes do paralelismo.** Toda task full-stack passa por um contrato API/UI antes dos agentes saírem em paralelo, para evitar divergência de campos (ex.: `description` vs `descricao`).
- **Relatório obrigatório.** Toda execução fecha com `implementation-report.md`.

## Instalação local (antes de publicar)

Enquanto o plugin não está publicado, você pode usá-lo apontando o Claude Code para o diretório local:

```text
/plugin marketplace add <caminho-absoluto-deste-repo>
/plugin install cc-orchestrador-subagents@cc-orchestrador-subagents
```

Em ambientes Windows, use o caminho com barras invertidas escapadas ou aspas duplas.

## Publicação na loja de plugins do Claude Code

A loja do Claude Code funciona com **marketplaces** (diretórios indexados via `.claude-plugin/marketplace.json` em um repositório Git). Este repo já contém o `marketplace.json` necessário para ser instalado como marketplace de plugin único.

### Passo 1 — Publicar o repositório no GitHub

```bash
git init
git add .
git commit -m "feat: initial release of cc-orchestrador-subagents v0.1.0"
git branch -M main
git remote add origin https://github.com/AllanHarlen/cc-orchestrador-subagents.git
git push -u origin main
```

**Importante:** o repo precisa ser **público** para outros usuários instalarem.

Antes de publicar, atualize `marketplace.json` e `plugin.json` para conter o usuário/email corretos. Os campos a revisar:

- `.claude-plugin/plugin.json` → `author.name`
- `.claude-plugin/marketplace.json` → `owner.name`, `owner.email`, `plugins[0].author.name`, `plugins[0].homepage`, `plugins[0].repository`

### Passo 2 — Testar a instalação a partir do GitHub

No Claude Code:

```text
/plugin marketplace add AllanHarlen/cc-orchestrador-subagents
/plugin install cc-orchestrador-subagents@cc-orchestrador-subagents
```

Verifique:

- `/orchestrator` aparece na lista de comandos;
- A skill `orchestrator-multi-agent-development` aparece em `<system-reminder>` de skills disponíveis;
- Rodar `/orchestrator` faz o preflight executar.

### Passo 3 — Submeter ao marketplace oficial (opcional)

A Anthropic mantém o marketplace oficial em [`anthropics/claude-plugins-official`](https://github.com/anthropics/claude-plugins-official). Para listar seu plugin lá:

1. Faça fork do repo `anthropics/claude-plugins-official`.
2. No fork, adicione uma entrada em `.claude-plugin/marketplace.json` apontando para o repo deste plugin via `source: "git-subdir"` ou `source: { source: "github", repo: "..." }`. Pegue exemplos do próprio `marketplace.json` oficial.
3. Abra um Pull Request descrevendo:
   - o que o plugin faz;
   - quem é o autor;
   - dependências necessárias (CLIs e plugins);
   - status de manutenção.
4. Aguarde revisão da Anthropic.

Sem PR aprovado, o plugin continua instalável diretamente via `/plugin marketplace add <seu-usuario>/<repo>`, apenas não aparece no diretório oficial.

### Passo 4 — Versionamento

Quando lançar atualizações:

1. Atualize `version` em `.claude-plugin/plugin.json` e em `.claude-plugin/marketplace.json` (`plugins[0].version`).
2. Mantenha um `CHANGELOG.md` no repo.
3. Crie uma tag git: `git tag v0.2.0 && git push origin v0.2.0`.
4. Usuários atualizam via `/plugin update cc-orchestrador-subagents@cc-orchestrador-subagents`.

## Licença

A definir.
