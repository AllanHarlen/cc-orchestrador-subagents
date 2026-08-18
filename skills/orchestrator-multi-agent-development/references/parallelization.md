# Paralelizacao

## Regra basica

A categoria declarada em `tasks-classification.md` (derivada do PRD/spec ingerido) e a fonte da verdade. Nao mude o agente porque a task de front-end parece "setup", "infra" ou "simples para Codex".

| Categoria | Agentes tipicos |
|---|---|
| `BACKEND_ONLY` | 1 Codex com `--effort medium` |
| `FRONTEND_ONLY` | 1 Antigravity/AGY |
| `FULLSTACK` | 1 Codex + 1 Antigravity/AGY |
| `DATABASE_ONLY` | 1 Codex com `--effort medium` |
| `REVIEW_ONLY` | 1 Codex com `--effort high` |

Depois de gerar `waves.md`, rode `validate-routing.mjs`. Se uma task `FRONTEND_ONLY` estiver apontando para Codex como agente primario, a wave esta invalida.

Depois de `sync`, rode `orchestration-worktree.mjs plan`. O planner usa `allowedPaths` (fallback `expectedFiles`) e devolve:

- `ISOLATED`: scope conhecido e sem overlap; criar branch/worktree e executar em paralelo;
- `SERIAL`: overlap detectado; ordenar dentro/entre waves;
- `UNSCOPED`: scope insuficiente; nao paralelizar ate classificar melhor.

O isolamento fisico complementa, nao substitui, dependencias/contratos. `create` persiste `PLANNED` antes da mutacao Git; `ready`/`integrate` materializam commits e conflitos; cleanup normal so ocorre depois de merge.

## Nao paralelizar quando

- duas tasks tocam o mesmo arquivo central;
- contrato ainda nao existe;
- schema ainda esta mudando;
- autenticacao/seguranca ainda nao foi consolidada.

Essa lista governa **ambos** os niveis de paralelismo descritos abaixo.

## Paralelismo em dois niveis

O orquestrador opera com dois niveis ortogonais de paralelismo:

**(a) Nivel de onda** — o orquestrador lanca Codex e AGY como subagentes independentes ao mesmo tempo, dentro da mesma onda, apenas quando o planner os marcou `ISOLATED`. Cada executor usa sua worktree/lease.

**(b) Nivel intra-AGY** — dentro de uma unica delegacao AGY (`FRONTEND_ONLY` ou fatia front-end de `FULLSTACK`), o bridge passa `--parallel` para o AGY, que usa `DefineSubagent`/`invoke_subagent`/`ManageSubagents` para decompor a task em subtarefas Gemini nativas, executa-as concorrentemente e agrega as saidas num resultado unico.

Regras para o nivel intra-AGY:

- Aplicar `--parallel` apenas quando a task lista **dois ou mais entregaveis independentes** nos criterios de aceite e nenhum deles viola as restricoes da lista "Nao paralelizar quando".
- Continua sendo **1 task = 1 delegacao AGY**: o modelo de rastreamento em `monitoring.md`, `subagents-context.md` e `waves.md` nao muda.
- `agySubagentModel: inherit` omite `--subagent-model`; os subagentes herdam o `agyModel` da sessao principal.
- Entregaveis dependentes ou que compartilham estado permanecem no subagente AGY unico, sem `--parallel`.

## Regra de contrato

Se existir troca de dados front-back, o contrato vem antes da onda. Isso vale para `FULLSTACK` e tambem para pares `BACKEND_ONLY` + `FRONTEND_ONLY` dependentes.
