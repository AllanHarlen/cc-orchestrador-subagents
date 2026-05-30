# Stack de agentes

## Visao geral

| Papel | Modelo | Subagent type | Effort | Observacoes |
|---|---|---|---|---|
| Orquestrador | Claude Sonnet 4.6 | voce mesmo | Medium | coordena e consolida |
| Review de plano | Codex padrao da conta | `codex:codex-rescue` | High | read-only |
| Back-end | Codex padrao da conta | `codex:codex-rescue` | Medium | implementacao |
| Front-end | AGY definido por override ou heuristica | `cc-antigravity-plugin:antigravity-agent` | - | usar `--model <agyModel>` no bridge |
| Review pos-implementacao | Codex padrao da conta | `codex:codex-rescue` | High | read-only |

## Invariante de roteamento

A categoria da task decide o agente. Nao use "parece setup", "parece infra" ou "Codex consegue fazer" como criterio para trocar agente.

| Categoria | Agente primario |
|---|---|
| `FRONTEND_ONLY` | Antigravity/AGY |
| `BACKEND_ONLY` | Codex |
| `DATABASE_ONLY` | Codex |
| `TEST_ONLY` | Codex |
| `REVIEW_ONLY` | Codex |
| `FULLSTACK` | Codex para back-end + Antigravity/AGY para front-end |

Exemplos que continuam sendo `FRONTEND_ONLY` e devem ir para AGY:

- criar projeto Vite/React/TypeScript;
- configurar React Router;
- criar tipos TypeScript de contrato;
- criar servicos `fetch`/client API;
- criar layout, paginas, componentes, hooks, estado e UX.

Codex so assume front-end como fallback operacional depois de `QUOTA_EXAUSTED`, `AUTH_REQUIRED`, `AGY_MISSING`, `TIMEOUT`, falha de ferramenta/escrita do AGY ou decisao explicita do usuario. Registre o motivo e o handoff nos artefatos de monitoramento.

## Regra para Codex

Nao fixe `--model` nos prompts do Codex. Use apenas:

- `--effort medium` para implementacao, ajustes pontuais, testes e handoffs;
- `--effort high` para review de plano e review pos-implementacao.

## Regra para contratos front-back

Se houver troca de dados entre front-end e back-end, o contrato e obrigatorio. Isso vale mesmo que a classificacao esteja separada em `BACKEND_ONLY` e `FRONTEND_ONLY`.

O prompt de qualquer agente envolvido precisa receber:

- o contrato correspondente;
- a regra de wire format;
- a obrigacao de checar casing JSON;
- a orientacao para validar serializacao real contra TypeScript.

## Heuristica de uso

### Antigravity/AGY

Use AGY para qualquer task `FRONTEND_ONLY` e para a fatia front-end de `FULLSTACK`. Passe `--model <agyModel>` para o bridge do plugin, com escolha por override do usuario ou heuristica do orquestrador.

Quando a task listar **dois ou mais entregaveis independentes** (ex.: dois relatorios HTML, tres componentes React sem dependencia mutua), passe tambem `--parallel` para ativar o fan-out nativo de subagentes Gemini. O AGY decide a contagem, executa concorrentemente e agrega os resultados. Ao final, reporte os Conversation IDs de cada subagente em `subagents-context.md`.

Quando o usuario passar `--agy-subagent-model <modelo>`, repasse como `--subagent-model <modelo>` ao bridge (implica `--parallel`). Por padrao (`agySubagentModel: inherit`), omita `--subagent-model`; os subagentes usam o mesmo modelo da sessao AGY principal.

Entregaveis dependentes ou que compartilham estado/arquivo central NAO devem usar `--parallel`; mantenha o subagente unico.

### Codex com `--effort medium`

Use para:

- endpoints REST/GraphQL;
- services, handlers e repositorios;
- DTOs, mappers e validacoes;
- testes unitarios e de integracao;
- migrations simples;
- ajustes pontuais;
- handoffs apos falha operacional.

Bloqueie e escale ao usuario quando o Codex depender de rede externa indisponivel para pacotes/restore, de pacote ausente do cache local, ou quando nao puder escrever fora do working directory permitido. Exemplos: NuGet `NU1301` em `https://api.nuget.org/v3/index.json` e `UnauthorizedAccessException`.

### Codex com `--effort high`

Use para:

- review de plano;
- review pos-implementacao;
- leitura critica de risco arquitetural;
- analise de regressao e seguranca.

## Politica de quota

- `QUOTA_EXHAUSTED` em implementacao Codex: bloquear e pedir decisao ao usuario.
- `QUOTA_EXHAUSTED` em review Codex: fazer fallback de review interno read-only do orquestrador e salvar em `review-final.md`.
- `QUOTA_EXAUSTED` em Antigravity/AGY: seguir a politica de fallback descrita em `workflow.md`.
- `AUTH_REQUIRED`, `AGY_MISSING` e `TIMEOUT` em Antigravity/AGY: tratar como bloqueios operacionais e registrar evidencia.

## Politica de sandbox

- Rede externa bloqueada no Codex para NuGet/npm/pip/outros registries: registrar evidencia e marcar `BLOCKED`.
- Pacote necessario nao existe no cache local do ambiente Codex: registrar dependencia ausente e marcar `BLOCKED`.
- Escrita fora do working directory permitido retorna erro de permissao: registrar caminho alvo, working directory efetivo e marcar `BLOCKED`.
- Para tasks `FRONTEND_ONLY` sem necessidade de instalar dependencias externas, AGY continua sendo a rota preferida.

## Skills e Context7

Antes de delegar, cite apenas skills que realmente existem no ambiente.

Se `checks.optional.mcp.context7.ok=true`, instrua Codex e Antigravity/AGY a consultar Context7 antes de mexer em bibliotecas, frameworks, SDKs, APIs, CLIs ou cloud services.
