# Prompts oficiais para subagentes

Sempre leia este arquivo antes de delegar para Codex ou Gemini.

## Regras comuns

- Para Codex, use o modelo padrao disponivel na conta e controle apenas `--effort medium` ou `--effort high`.
- Se aparecer cota, rate limit, billing, resource exhausted, model capacity ou daily limit, retorne `Status: QUOTA_EXHAUSTED`.
- Nao tente contornar cota com retries longos ou mudanca arbitraria de modelo.
- Se o preflight indicar `checks.optional.mcp.context7.ok: true`, use Context7 antes de decidir sobre bibliotecas, frameworks, SDKs, APIs, CLIs ou cloud services.
- Se existir contrato API/UI, siga o contrato como fonte da verdade.
- Valide casing JSON e wire format real; nao assuma que nomes de DTO internos sao iguais ao payload na rede.

## 1. Review de plano - Codex

**Subagent type:** `codex:codex-rescue`

```text
--effort high

Nao modifique arquivos. Apenas revise.

Revise criticamente o plano OpenSpec em openspec/changes/<nome>/.

Leia: proposal.md, design.md, tasks.md e specs/.

Avalie:
- clareza de escopo;
- granularidade das tasks;
- dependencias ocultas;
- riscos arquiteturais;
- impacto em seguranca, auth e banco;
- paralelizacao segura;
- cobertura de criterios de aceite;
- necessidade de contratos front-back.

Retorne:
1. Problemas encontrados
2. Sugestoes obrigatorias
3. Sugestoes opcionais
4. Decisao final: APROVADO | APROVADO COM AJUSTES | REPROVADO
```

## 2. Back-end - Codex

**Subagent type:** `codex:codex-rescue`

```text
--effort medium

Voce e o subagente back-end desta task.

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
```

## 3. Front-end - Gemini

**Subagent type:** `cc-gemini-plugin:gemini-agent`

### UI complexa

```text
--model gemini-3-pro --dirs <DIRS>
```

### UI simples

```text
--model gemini-3-flash --dirs <DIRS>
```

**Corpo do prompt:**

```text
Voce e o subagente front-end desta task.

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
```

## 7. Fallback de review sem quota Codex

Se o review Codex retornar `QUOTA_EXHAUSTED`, o orquestrador nao redelega implementacao nem troca modelo a esmo. Ele faz review interno read-only, salva em `review-final.md` e deixa claro que foi fallback do orquestrador.
