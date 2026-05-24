# Stack de agentes

## Visao geral

| Papel | Modelo | Subagent type | Effort | Observacoes |
|---|---|---|---|---|
| Orquestrador | Claude Sonnet 4.6 | voce mesmo | Medium | coordena e consolida |
| Review de plano | Codex padrao da conta | `codex:codex-rescue` | High | read-only |
| Back-end | Codex padrao da conta | `codex:codex-rescue` | Medium | implementacao |
| Front-end UI complexa | AGY | `cc-antigravity-plugin:antigravity-agent` | - | `gemini-3.1-pro-low` |
| Front-end UI simples | AGY | `cc-antigravity-plugin:antigravity-agent` | - | `gemini-3.5-flash-medium` |
| Review pos-implementacao | Codex padrao da conta | `codex:codex-rescue` | High | read-only |

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

### Codex com `--effort medium`

Use para:

- endpoints REST/GraphQL;
- services, handlers e repositorios;
- DTOs, mappers e validacoes;
- testes unitarios e de integracao;
- migrations simples;
- ajustes pontuais;
- handoffs apos falha operacional.

### Codex com `--effort high`

Use para:

- review de plano;
- review pos-implementacao;
- leitura critica de risco arquitetural;
- analise de regressao e seguranca.

## Politica de quota

- `QUOTA_EXHAUSTED` em implementacao Codex: bloquear e pedir decisao ao usuario.
- `QUOTA_EXHAUSTED` em review Codex: fazer fallback de review interno read-only do orquestrador e salvar em `review-final.md`.
- `QUOTA_EXHAUSTED` em Antigravity/AGY: seguir a politica de fallback descrita em `workflow.md`.

## Skills e Context7

Antes de delegar, cite apenas skills que realmente existem no ambiente.

Se `checks.optional.mcp.context7.ok=true`, instrua Codex e Antigravity/AGY a consultar Context7 antes de mexer em bibliotecas, frameworks, SDKs, APIs, CLIs ou cloud services.
