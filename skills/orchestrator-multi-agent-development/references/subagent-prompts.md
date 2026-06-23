# Prompts oficiais para subagentes

Sempre leia este arquivo antes de delegar para Codex ou Antigravity/AGY.

## Regras comuns

- Para Codex, use o modelo padrao disponivel na conta e controle apenas `--effort medium` ou `--effort high`.
- A categoria da task decide o agente. `FRONTEND_ONLY` sempre usa Antigravity/AGY como agente primario; Codex so pode receber front-end em fallback operacional registrado.
- Codex revisa apenas back-end. O review de front-end e sempre do AGY com `--model gemini-3.1-pro-high`.
- Se aparecer cota, rate limit, billing, resource exhausted, model capacity ou daily limit no Codex, retorne `Status: QUOTA_EXHAUSTED`.
- Se aparecer cota, rate limit, billing, resource exhausted, model capacity ou daily limit no AGY, preserve o status cru `Status: QUOTA_EXAUSTED`.
- Nao tente contornar cota com retries longos ou mudanca arbitraria de modelo.
- Se o preflight indicar `checks.optional.mcp.context7.ok: true`, use Context7 antes de decidir sobre bibliotecas, frameworks, SDKs, APIs, CLIs ou cloud services.
- Se existir contrato API/UI, siga o contrato como fonte da verdade.
- Valide casing JSON e wire format real; nao assuma que nomes de DTO internos sao iguais ao payload na rede.
- No Codex, trate rede externa bloqueada para pacotes/restore, pacote ausente do cache local e erro de escrita fora do working directory permitido como `Status: BLOCKED`.

## 1. Back-end - Codex

**Subagent type:** `codex:codex-rescue`

```text
--effort medium

Voce e o subagente back-end desta task.

Antes de implementar, liste as skills disponiveis no ambiente com `/skills` ou equivalente.
Ignore skills exclusivas de planejamento/coordenacao do orquestrador.
Das skills restantes, identifique quais sao compativeis com esta task e use-as durante a implementacao.
Registre no retorno quais skills foram utilizadas.

Contexto:
- especificacao (PRD/spec): <COLAR TRECHO RELEVANTE OU CAMINHO DO ARQUIVO>
- task atual: <TASK ID - TITULO>

Descricao:
<COLAR DESCRICAO DA TASK>

Contrato tecnico:
<COLAR CONTRATO SE contractRequired=yes; senao remover>

Arquivos e modulos relevantes:
<LISTAR ARQUIVOS>

Escopo permitido:
<LISTAR DIRETORIOS E ARQUIVOS PERMITIDOS>

Fora do escopo:
<LISTAR ARQUIVOS CENTRAIS OU COMPARTILHADOS>

Stack:
<STACK>

Skills relevantes:
<LISTAR SKILLS DISPONIVEIS>

Context7 MCP:
<MANTER SOMENTE SE DISPONIVEL>

Regras:
- implemente apenas esta task;
- preserve padroes locais;
- nao altere contrato sem sinalizar;
- valide wire format real, especialmente casing JSON;
- se houver DTO C# em PascalCase e payload esperado em camelCase, confirme serializer/atributos e registre a decisao;
- valide serializacao real contra o TypeScript consumidor quando houver fronteira front-back;
- adicione testes quando aplicavel;
- reporte todos os arquivos alterados;
- se houver cota, retorne `Status: QUOTA_EXHAUSTED`;
- se `dotnet restore`, `dotnet add package`, npm, pip ou outro registry falhar por rede externa bloqueada ou pacote ausente do cache local, retorne `Status: BLOCKED` com o comando, pacote e erro;
- se houver `UnauthorizedAccessException` ou erro de permissao ao escrever fora do working directory permitido, retorne `Status: BLOCKED` com working directory efetivo e caminho alvo;
- se receber `SLOW_CHECKIN`, responda com progresso real, arquivos tocados, bloqueios, riscos e ETA.

Retorno:
0. Status: DONE | BLOCKED | FAILED | QUOTA_EXHAUSTED
1. Resumo do que foi implementado
2. Arquivos alterados
3. Decisoes tecnicas
4. Validacao de wire format e serializacao
5. Testes executados
6. Pendencias
7. Riscos
8. Evidencia operacional
9. Limites de sandbox: <nenhum | rede externa bloqueada | pacote ausente no cache | escrita fora do working directory | outro>
10. Skills utilizadas: <lista das skills usadas ou "nenhuma">
11. Tokens usados: input=<N> output=<N> cache_read=<N> total=<N>
    (informe N/A se a plataforma nao expor o dado)
```

## 2. Front-end - Antigravity (AGY)

**Subagent type:** `cc-antigravity-plugin:antigravity-agent`

**Parametros:**

```text
--model <AGY_MODEL> [--parallel] [--subagent-model <SUBAGENT_MODEL>] --dirs <DIRS>
```

Passe `--model <AGY_MODEL>` para o bridge do plugin. O bridge aplica o modelo via `~/.gemini/antigravity-cli/settings.json`, sem repassar a flag ao binario `agy`.

Passe `--parallel` quando `agyParallel: yes` para a task. Se `agySubagentModel` for diferente de `inherit`, inclua tambem `--subagent-model <SUBAGENT_MODEL>`.

**Corpo do prompt:**

```text
Voce e o subagente front-end desta task.

Esta task foi roteada para AGY porque sua categoria e `FRONTEND_ONLY` ou a fatia front-end de `FULLSTACK`. Mesmo quando o trabalho for setup de projeto, roteamento, tipos TypeScript ou servico API, trate como front-end.

Antes de implementar, liste as skills disponiveis no ambiente com `/skills` ou equivalente.
Ignore skills exclusivas de planejamento/coordenacao do orquestrador.
Das skills restantes, identifique quais sao compativeis com esta task e use-as durante a implementacao.
Registre no retorno quais skills foram utilizadas.

Contexto:
- especificacao (PRD/spec): <COLAR TRECHO RELEVANTE OU CAMINHO DO ARQUIVO>
- task atual: <TASK ID - TITULO>

Descricao:
<COLAR DESCRICAO DA TASK>

Contrato API/UI:
<COLAR CONTRATO SE contractRequired=yes; senao remover>

Arquivos e modulos relevantes:
<LISTAR ARQUIVOS>

Escopo permitido:
<LISTAR DIRETORIOS E ARQUIVOS PERMITIDOS>

Fora do escopo:
<LISTAR ARQUIVOS CENTRAIS OU GLOBAIS>

Stack:
<STACK FRONT-END>

Design System (Open Design) — CONSUMIR, NAO REINVENTAR:
<COLAR SOMENTE SE houver design system; senao "N/A (sem design system nesta entrega)">
- tokens (fonte de verdade): <CAMINHO tokens.css, ex.: packages/ui/design-systems/<id>/tokens.css>
- fixtures de componente: <CAMINHO components.html>
- decisoes/intencao: <CAMINHO design-system.md (modo PRD) | openspec/changes/<nome>/design.md + specs/ui-design-system/spec.md (modo Spec)>
- preview de referencia (alvo visual): <CAMINHO preview/ (diretorio — ex.: packages/ui/design-systems/<id>/preview/)>
Regras de design (do skills-protocol do Open Design — obrigatorias):
- cole o `tokens.css` como base e use as custom properties (`var(--*)`); NAO invente hex/raio/espacamento fora dos tokens;
- implemente os componentes batendo com os seletores/estados de `components.html` (default/hover/focus/active/disabled/loading/empty/error);
- accent contido: no maximo 2x por pagina (hero + CTA) alem de links; nao floode;
- sem sombra se Depth & Elevation = minimal; nada de emoji como icone;
- quando o requisito conflitar com o system, aplique override DOCUMENTADO (nao um token solto novo);
- o resultado deve poder ser comparado visualmente com o diretorio `preview/` (abrir `colors.html`, `spacing.html` ou `typography.html` conforme o system).

Modelo AGY:
<COLAR AGYMODEL>

Origem do modelo:
<user|heuristic>

Fan-out de subagentes:
<COLAR: "agyParallel: yes — entregaveis independentes: <lista>" | "agyParallel: no">

Modelo dos subagentes:
<COLAR SUBAGENT_MODEL ou "inherit (omitir --subagent-model)">

Context7 MCP:
<MANTER SOMENTE SE DISPONIVEL>

Skills:
<LISTAR SKILLS DISPONIVEIS>

Regras:
- implemente apenas esta task;
- preserve padroes visuais e de estado;
- trate loading, erro, empty e sucesso;
- nao altere contrato sem sinalizar;
- valide consumo do payload real;
- confira casing JSON esperado no contrato;
- se a API vier de DTO C# ou mapper compartilhado, destaque qualquer dependencia de serializacao;
- use o bridge com `--model <AGY_MODEL>`;
- quando `agyParallel: yes`, decomponha os entregaveis listados em subtarefas Gemini nativas (`DefineSubagent`/`invoke_subagent`/`ManageSubagents`), execute-as concorrentemente e agregue os resultados; entregaveis dependentes ou que compartilhem estado ficam no subagente principal sem fan-out;
- se houver cota, retorne `Status: QUOTA_EXAUSTED`;
- se houver autenticacao pendente, retorne `Status: AUTH_REQUIRED`;
- se o `agy` nao existir no PATH do ambiente, retorne `Status: AGY_MISSING`;
- se houver timeout do bridge, retorne `Status: TIMEOUT`;
- se houver falha de escrita ou tools, pare e devolva ao orquestrador;
- se receber `SLOW_CHECKIN`, responda com progresso real, arquivos tocados, bloqueios, riscos e ETA.

Retorno:
0. Status: DONE | BLOCKED | FAILED | QUOTA_EXAUSTED | AUTH_REQUIRED | AGY_MISSING | TIMEOUT
1. Resumo do que foi implementado
2. Arquivos alterados
3. Decisoes de UI/UX
4. Estados tratados
5. Validacao do contrato e do wire format
6. Testes ou validacoes feitas
7. Pendencias
8. Riscos
9. Evidencia operacional
10. Skills utilizadas: <lista das skills usadas ou "nenhuma">
11. Subagentes Gemini nativos: <N | N/A>
12. Conversation IDs dos subagentes: <lista | N/A>
13. Tokens usados: input=<N> output=<N> cache_read=<N> total=<N>
    (informe N/A se a plataforma nao expor o dado)
```

## 3. SLOW_CHECKIN

```text
SLOW_CHECKIN - preciso de uma atualizacao operacional curta da task <TASK ID>.

Responda sem implementar trabalho novo nesta mensagem:
1. progresso concreto concluido
2. arquivos criados/alterados
3. bloqueios ou riscos
4. ETA honesto
5. existe falha de cota?
6. existe falha de tool, terminal, escrita ou criacao de arquivos?
```

## 4. Review back-end pos-implementacao - Codex (Fase 8)

**Subagent type:** `codex:codex-rescue`

```text
--effort high

Nao modifique arquivos. Apenas revise. Revise SOMENTE o back-end.

Revise a implementacao back-end realizada pelos subagentes para a especificacao <nome>.

Leia:
- a especificacao (PRD/spec) ingerida
- orchestration/<nome>/tasks-classification.md
- orchestration/<nome>/waves.md
- orchestration/<nome>/contracts/
- diff git da branch atual (apenas arquivos back-end)

Verifique:
- aderencia a especificacao no escopo back-end;
- contratos API (lado servidor);
- wire format e casing JSON no payload emitido;
- serializacao real contra TypeScript consumidor;
- auth/autorizacao, validacoes e tratamento de erro;
- migrations, persistencia, indices e integridade referencial;
- regressao no back-end;
- seguranca;
- build e testes back-end;
- testes faltando;
- pendencias antes do merge.

Retorne:
1. Decisao: APROVADO | APROVADO_COM_RESSALVAS | REPROVADO
2. Problemas bloqueantes
3. Problemas nao bloqueantes
4. Recomendacoes
5. Checklist final
6. Tokens usados: input=<N> output=<N> cache_read=<N> total=<N>
   (informe N/A se a plataforma nao expor o dado)
```

Salve o resultado em `review-final.md`.

## 5. Review front-end pos-implementacao - Antigravity (AGY) (Fase 9)

**Subagent type:** `cc-antigravity-plugin:antigravity-agent`

**Parametros:**

```text
--model gemini-3.1-pro-high --dirs <DIRS_FRONT_END>
```

O review front-end usa sempre `gemini-3.1-pro-high`, independentemente do `agyModel` de implementacao.

**Corpo do prompt:**

```text
Voce e o revisor front-end desta entrega. NAO modifique arquivos. Apenas revise.

Revise a implementacao front-end realizada pelos subagentes para a especificacao <nome>.

Leia:
- a especificacao (PRD/spec) ingerida
- orchestration/<nome>/tasks-classification.md
- orchestration/<nome>/contracts/
- diff/arquivos front-end alterados

Verifique:
- aderencia a especificacao no escopo front-end;
- aderencia a cada task e criterio de aceite das tasks front-end;
- consumo correto do contrato API/UI: wire format, casing JSON e serializacao real contra o TypeScript consumidor;
- estados de UI tratados (loading, erro, empty, sucesso);
- tipagem TypeScript, build, typecheck e lint;
- acessibilidade e consistencia visual quando aplicavel;
- testes de componente/e2e executados e lacunas;
- arquivos alterados fora do escopo;
- regressao potencial em telas/fluxos existentes.

Gate de design system (quando houver design system — Open Design):
- o estilo consome `tokens.css` via custom properties (`var(--*)`); SEM hex/raio/espacamento inventado fora dos tokens;
- componentes batem com seletores/estados de `components.html` (default/hover/focus/active/disabled/loading/empty/error);
- accent usado no maximo 2x por pagina (hero + CTA) alem de links; sem flood; sem emoji como icone; sem sombra se Depth & Elevation = minimal;
- telas-chave conferidas contra o diretorio `preview/` (diferenca de layout/hierarquia/contraste; abrir `colors.html`, `spacing.html` ou `typography.html` — so 1/152 systems tem `app.html`);
- no modo Spec, os requisitos da capability `ui-design-system` (specs/ui-design-system/spec.md) sao atendidos (cada cenario);
- anti-padroes da secao 9 do DESIGN.md ausentes do codigo final.
- Trate violacao de design system como problema BLOQUEANTE quando contrariar requisito explicito (override sem justificativa, token inventado, accent flood).

Regras de status:
- se houver cota, retorne `Status: QUOTA_EXAUSTED`;
- se houver autenticacao pendente, retorne `Status: AUTH_REQUIRED`;
- se o `agy` nao existir no PATH, retorne `Status: AGY_MISSING`;
- se houver timeout do bridge, retorne `Status: TIMEOUT`.

Retorne:
0. Status: DONE | QUOTA_EXAUSTED | AUTH_REQUIRED | AGY_MISSING | TIMEOUT
1. Decisao: APROVADO | APROVADO_COM_RESSALVAS | REPROVADO
2. Problemas bloqueantes (severidade, arquivo/trecho, impacto, correcao esperada)
3. Problemas nao bloqueantes
4. Recomendacoes
5. Checklist final
6. Tokens usados: input=<N> output=<N> cache_read=<N> total=<N>
   (informe N/A se a plataforma nao expor o dado)
```

Salve o resultado em `review-frontend.md`.

> Se o AGY retornar `QUOTA_EXAUSTED`, `AUTH_REQUIRED`, `AGY_MISSING` ou `TIMEOUT`, o orquestrador faz review interno read-only do front-end e registra o fallback em `review-frontend.md`.

## 6. Ajustes pontuais - Codex

Use Codex para ajustes pontuais de implementacao back-end, handoff ou sincronizacao:

```text
--effort medium

Ajuste pontual na implementacao:
- arquivo: <PATH>
- problema: <DESCRICAO>
- mudanca esperada: <ESPECIFICACAO>

Nao altere nada fora do escopo informado.
Se houver cota, retorne `Status: QUOTA_EXHAUSTED`.
Se houver rede externa bloqueada, pacote ausente no cache local ou escrita fora do working directory permitido, retorne `Status: BLOCKED` com evidencia.
```

> Ajustes pontuais de front-end voltam para o AGY (`cc-antigravity-plugin:antigravity-agent`) com `--model <agyModel>`, nao para o Codex.

## 7. Fallback de review sem agente disponivel

- Review back-end com Codex em `QUOTA_EXHAUSTED`: o orquestrador faz review interno read-only, salva em `review-final.md` e deixa claro que foi fallback do orquestrador.
- Review front-end com AGY em `QUOTA_EXAUSTED`/`AUTH_REQUIRED`/`AGY_MISSING`/`TIMEOUT`: o orquestrador faz review interno read-only, salva em `review-frontend.md` e deixa claro que foi fallback do orquestrador.

Em nenhum caso o orquestrador redelega implementacao por conta propria nem troca modelo a esmo.
