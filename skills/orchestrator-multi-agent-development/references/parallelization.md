# Paralelizacao

## Regra basica

| Categoria | Agentes tipicos |
|---|---|
| `BACKEND_ONLY` | 1 Codex com `--effort medium` |
| `FRONTEND_ONLY` | 1 Gemini |
| `FULLSTACK` | 1 Codex + 1 Gemini |
| `DATABASE_ONLY` | 1 Codex com `--effort medium` |
| `REVIEW_ONLY` | 1 Codex com `--effort high` |
| `TEST_ONLY` | 1 Codex com `--effort medium` |

## Nao paralelizar quando

- duas tasks tocam o mesmo arquivo central;
- contrato ainda nao existe;
- schema ainda esta mudando;
- autenticacao/seguranca ainda nao foi consolidada.

## Regra de contrato

Se existir troca de dados front-back, o contrato vem antes da onda. Isso vale para `FULLSTACK` e tambem para pares `BACKEND_ONLY` + `FRONTEND_ONLY` dependentes.
