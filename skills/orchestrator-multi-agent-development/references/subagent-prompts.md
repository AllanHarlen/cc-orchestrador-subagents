# Prompts oficiais para subagentes

Sempre leia este arquivo antes de delegar para Codex ou Antigravity/AGY.

## Regras comuns

- Para Codex, use o modelo padrao disponivel na conta e controle apenas `--effort medium` ou `--effort high`.
- A categoria da task decide o agente. `FRONTEND_ONLY` sempre usa Antigravity/AGY como agente primario; Codex so pode receber front-end em fallback operacional registrado.
- Se aparecer cota, rate limit, billing, resource exhausted, model capacity ou daily limit, retorne `Status: QUOTA_EXHAUSTED`.
- Nao tente contornar cota com retries longos ou mudanca arbitraria de modelo.
- Se o preflight indicar `checks.optional.mcp.context7.ok: true`, use Context7 antes de decidir sobre bibliotecas, frameworks, SDKs, APIs, CLIs ou cloud services.
- Se existir contrato API/UI, siga o contrato como fonte da verdade.
- Valide casing JSON e wire format real; nao assuma que nomes de DTO internos sao iguais ao payload na rede.
- No Codex, trate rede externa bloqueada para pacotes/restore, pacote ausente do cache local e erro de escrita fora do working directory permitido como `Status: BLOCKED`.

## 1. Review do entendimento - Codex (Fase 2)

**Subagent type:** `codex:codex-rescue`

```text
--effort high

Nao modifique arquivos. Apenas revise.

Revise criticamente o entendimento da demanda antes de qualquer artefato OpenSpec ser criado.

Entendimento a revisar:
- Problema identificado: <COLAR RESUMO DO PROBLEMA>
- Escopo incluido: <COLAR LISTA>
- Escopo excluido: <COLAR LISTA COM MOTIVOS>
- Impacto arquitetural mapeado: <COLAR RESUMO POR CAMADA>
- Riscos antecipados: <COLAR LISTA>
- Perguntas em aberto: <COLAR LISTA OU "nenhuma">

Avalie:
- o problema identificado esta correto e completo?
- o escopo incluido faz sentido para o problema?
- o escopo excluido tem justificativa valida?
- ha dependencias ocultas ou riscos nao mapeados?
- o impacto arquitetural esta completo?
- ha perguntas em aberto criticas que bloqueiam o planejamento?

Retorne:
1. Problemas ou lacunas no entendimento
2. Ajustes obrigatorios
3. Ajustes opcionais
4. Decisao final: APROVADO | APROVADO COM AJUSTES | REPROVADO
5. Duvidas: liste cada ponto em que voce ficou indeciso, nao teve informacao suficiente
   para decidir ou que exige escolha humana antes de prosseguir. Se nao houver, escreva "nenhuma".
6. Tokens usados: input=<N> output=<N> cache_read=<N> total=<N>
   (informe N/A se a plataforma nao expor o dado)
```

Salve o resultado em `review-entendimento.md`.

> O orquestrador vai processar a secao "Duvidas" e, para cada item, usar `AskUserQuestion` para levar a decisao ao usuario antes de avancar.

## 2. Back-end - Codex

**Subagent type:** `codex:codex-rescue`

```text
--effort medium

Voce e o subagente back-end desta task.

Antes de implementar, liste as skills disponiveis no ambiente com `/skills` ou equivalente.
Ignore todas as skills cujo nome comece com `openspec` ou `opsx`.
Das skills restantes, identifique quais sao compativeis com esta task e use-as durante a implementacao.
Registre no retorno quais skills foram utilizadas.

Contexto OpenSpec:
- mudanca: openspec/changes/<nome>/
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

## 3. Front-end - Antigravity (AGY)

**Subagent type:** `cc-antigravity-plugin:antigravity-agent`

**Parametros:**

```text
--dirs <DIRS>
```

Nao passe `--model` nem qualquer seletor de modo para AGY.

**Corpo do prompt:**

```text
Voce e o subagente front-end desta task.

Esta task foi roteada para AGY porque sua categoria e `FRONTEND_ONLY` ou a fatia front-end de `FULLSTACK`. Mesmo quando o trabalho for setup de projeto, roteamento, tipos TypeScript ou servico API, trate como front-end.

Antes de implementar, liste as skills disponiveis no ambiente com `/skills` ou equivalente.
Ignore todas as skills cujo nome comece com `openspec` ou `opsx`.
Das skills restantes, identifique quais sao compativeis com esta task e use-as durante a implementacao.
Registre no retorno quais skills foram utilizadas.

Contexto OpenSpec:
- mudanca: openspec/changes/<nome>/
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
- se houver cota, retorne `Status: QUOTA_EXHAUSTED`;
- se houver falha de escrita ou tools, pare e devolva ao orquestrador;
- se receber `SLOW_CHECKIN`, responda com progresso real, arquivos tocados, bloqueios, riscos e ETA.

Retorno:
0. Status: DONE | BLOCKED | FAILED | QUOTA_EXHAUSTED
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
11. Tokens usados: input=<N> output=<N> cache_read=<N> total=<N>
    (informe N/A se a plataforma nao expor o dado)
```

## 4. SLOW_CHECKIN

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

## 5. Review pos-implementacao - Codex

**Subagent type:** `codex:codex-rescue`

```text
--effort high

Nao modifique arquivos. Apenas revise.

Revise a implementacao realizada pelos subagentes para a mudanca OpenSpec <nome>.

Leia:
- openspec/changes/<nome>/proposal.md
- openspec/changes/<nome>/design.md
- openspec/changes/<nome>/tasks.md
- openspec/changes/<nome>/contracts/
- diff git da branch atual

Verifique:
- aderencia ao plano;
- contratos API/UI;
- wire format e casing JSON;
- serializacao real contra TypeScript;
- inconsistencias front-back;
- regressao;
- seguranca;
- tipagem;
- build;
- testes faltando;
- pendencias antes do merge.

Retorne:
1. Decisao: APROVADO | REPROVADO
2. Problemas bloqueantes
3. Problemas nao bloqueantes
4. Recomendacoes
5. Checklist final
6. Tokens usados: input=<N> output=<N> cache_read=<N> total=<N>
   (informe N/A se a plataforma nao expor o dado)
```

## 6. Ajustes pontuais - Codex

Use Codex para ajustes pontuais de implementacao, handoff ou sincronizacao:

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

## 7. Fallback de review sem quota Codex

Se o review Codex retornar `QUOTA_EXHAUSTED`, o orquestrador nao redelega implementacao nem troca modelo a esmo. Ele faz review interno read-only, salva em `review-final.md` e deixa claro que foi fallback do orquestrador.
