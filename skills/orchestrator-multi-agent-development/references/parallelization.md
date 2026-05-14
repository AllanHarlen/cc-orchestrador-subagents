# Regras de Paralelização

A paralelização errada é a forma mais barata de gerar conflito e retrabalho. Esta seção detalha quando paralelizar, quando não paralelizar, e como montar as ondas (waves) de execução.

## Princípio central

Uma task **pode** ser paralelizada quando:

- **não depende** de código ainda não criado por outra task da mesma onda;
- possui **contrato claro** (entrada e saída definidos);
- não altera os **mesmos arquivos críticos** de outra task;
- não exige **decisão arquitetural** pendente;
- não compartilha **migration conflitante**;
- não altera o **mesmo componente base** usado por outra task;
- não compartilha **chave externa de schema** ainda indefinido.

Uma task **não deve** ser paralelizada quando:

- depende de schema ainda indefinido;
- depende de contrato de API ainda não aprovado;
- altera arquivos centrais compartilhados (ex.: `App.tsx`, `RouteConfig.cs`, `appsettings`);
- exige decisão de arquitetura;
- pode gerar conflito direto com outra task (mesmo controller, mesma migration);
- mexe em autenticação, autorização ou segurança sem revisão prévia.

## Tipos de task e custo de agentes

| Tipo | Quantidade ideal de agentes |
|---|---|
| `BACKEND_ONLY` | 1 (Codex gpt-5.4 medium) |
| `FRONTEND_ONLY` simples | 1 (Gemini 3 Flash) |
| `FRONTEND_ONLY` complexa | 1 (Gemini 3) |
| `FULLSTACK` | 2 (dupla Codex + Gemini) |
| `DATABASE_ONLY` | 1 (Codex gpt-5.4 medium) ou Codex gpt-5.5 high se complexo |
| `REVIEW_ONLY` | 1 (Codex gpt-5.5 high) |
| `DOCS_ONLY` | você (orquestrador) ou 1 agente leve |
| `TEST_ONLY` | 1 (Codex gpt-5.4 medium) |

Regra empírica: **1 task FULLSTACK = 2 agentes. 3 tasks FULLSTACK = até 6 agentes.** Mas nunca invoque um agente que não tem trabalho útil — agente ocioso é desperdício de tokens e expõe a risco de scope creep.

## Montagem de ondas (waves)

1. Construa o grafo de dependências a partir do `tasks-classification.md`.
2. Cada onda agrupa tasks **sem dependência entre si**.
3. Tasks com dependência caem na onda seguinte.
4. Nunca exceda **6 agentes** em uma onda (limite prático para gerenciar monitoramento e contexto). Se a onda exigiria 8+ agentes, divida em duas ondas.
5. Tasks `REVIEW_ONLY` rodam **depois** das tasks que revisam — não em paralelo com elas.

## Exemplos

### Exemplo 1 — 3 tasks independentes full-stack

```
Wave 1:
- Task A — back-end de reservas (FULLSTACK)
- Task B — tela de listagem (FULLSTACK)
- Task C — integração de pagamento (FULLSTACK)
```

Agentes paralelos: **6** (3 duplas Codex + Gemini).

### Exemplo 2 — task FULLSTACK + task BACKEND_ONLY

```
Wave 1:
- Task A — endpoint de reservas + tela (FULLSTACK)
- Task B — job de expiração de reservas (BACKEND_ONLY)
```

Agentes paralelos: **3** (Codex A + Gemini A + Codex B).

### Exemplo 3 — tasks com dependência

```
Wave 1:
- Task A — criar entidade Reserva (BACKEND_ONLY)
- Task B — criar tela de listagem mockada (FRONTEND_ONLY simples)

Wave 2 (depende da Wave 1):
- Task C — endpoint de listagem (BACKEND_ONLY)
- Task D — substituir mock por API real (FRONTEND_ONLY simples)
```

Wave 1: 2 agentes. Wave 2: 2 agentes.

### Exemplo 4 — task que toca arquivo central compartilhado

```
Task A — adicionar rota /reservas em App.tsx
Task B — adicionar rota /pagamentos em App.tsx
```

**Não paralelizar.** Ambas tocam o mesmo arquivo. Faça as duas em sequência (uma onda com Task A, próxima onda com Task B), ou pré-aloque o arquivo: você (orquestrador) adiciona ambas as rotas, e cada subagente trata só do componente correspondente.

## Detecção de conflito antes da execução

Antes de lançar uma onda, faça uma verificação rápida:

1. Para cada par de tasks da onda, pegue a lista de arquivos críticos tocados.
2. Se houver **interseção não-trivial**, mova uma das tasks para a próxima onda.
3. Para tasks FULLSTACK, garanta que o contrato foi gerado e revisado.
4. Para tasks que tocam migration, verifique que não há duas migrations alterando o mesmo schema na mesma onda.

## Sincronização durante a execução

Mesmo com contratos, pode acontecer divergência (ex.: o Codex decidiu usar `Result<T>` em vez de `T`, mas o Gemini espera retornar direto). Trate como `NEEDS_SYNC`:

1. Pause as tasks afetadas (não delegue ajustes ainda);
2. Decida com o usuário ou pela convenção do projeto;
3. Re-emita o contrato ajustado;
4. Redelegue **apenas** o agente que precisa ajustar;
5. Marque como `RUNNING` de novo no `monitoring.md`.

## Limite prático de paralelização

Mesmo com contexto suficiente, **mais de 6 agentes em paralelo** geralmente:

- esgota o budget de tool calls antes de monitorar tudo;
- dificulta a integração na fase 11;
- aumenta probabilidade de divergência;
- atrasa a resposta do orquestrador (mais notificações simultâneas).

Se uma onda pediria 8+ agentes, divida.

## Quando reduzir paralelização propositalmente

- **Primeira mudança em módulo desconhecido**: rode em sequência para aprender o padrão antes de paralelizar próximas waves.
- **Stack com convenções ambíguas**: deixe a primeira task abrir caminho, depois paralelize seguindo o exemplo.
- **Time pequeno revisando os PRs depois**: muito paralelismo gera diff gigante que ninguém revisa direito. Considere ondas menores.
