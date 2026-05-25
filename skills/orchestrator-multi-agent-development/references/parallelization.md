# Paralelizacao

## Regra basica

A categoria declarada em `tasks.md`/`tasks-classification.md` e a fonte da verdade. Nao mude o agente porque a task de front-end parece "setup", "infra" ou "simples para Codex".

| Categoria | Agentes tipicos |
|---|---|
| `BACKEND_ONLY` | 1 Codex com `--effort medium` |
| `FRONTEND_ONLY` | 1 Antigravity/AGY |
| `FULLSTACK` | 1 Codex + 1 Antigravity/AGY |
| `DATABASE_ONLY` | 1 Codex com `--effort medium` |
| `REVIEW_ONLY` | 1 Codex com `--effort high` |
| `TEST_ONLY` | 1 Codex com `--effort medium` |

Depois de gerar `waves.md`, rode `validate-routing.mjs`. Se uma task `FRONTEND_ONLY` estiver apontando para Codex como agente primario, a wave esta invalida.

## Nao paralelizar quando

- duas tasks tocam o mesmo arquivo central;
- contrato ainda nao existe;
- schema ainda esta mudando;
- autenticacao/seguranca ainda nao foi consolidada.

## Regra de contrato

Se existir troca de dados front-back, o contrato vem antes da onda. Isso vale para `FULLSTACK` e tambem para pares `BACKEND_ONLY` + `FRONTEND_ONLY` dependentes.
