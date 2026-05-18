---
description: Conduzir manualmente um workflow de desenvolvimento multiagêntico, com suporte a execucao autonoma via /goal (OpenSpec + planejamento do orquestrador + Codex review + Codex/Gemini execução paralela + log de workflow + relatório final + instruções de negócio)
argument-hint: "<descrição da demanda — ex.: 'implemente o fluxo de reservas com listagem, criação e cancelamento'>"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node:*), AskUserQuestion, Agent, TaskCreate, TaskUpdate, TaskList, Skill
---

# /orchestrator

Inicia o **Orquestrador Multiagêntico de Desenvolvimento** para a demanda descrita pelo usuário. O orquestrador conduz o workflow completo:

1. Entendimento da demanda
2. Criação de mudança OpenSpec
3. Plano técnico (feito diretamente pelo orquestrador)
4. Review do plano (`codex:codex-rescue` — Codex gpt-5.5 Effort High)
5. Consolidação do plano (orquestrador, Claude Sonnet 4.6 Effort Medium)
6. Classificação das tasks
7. Identificação de paralelização
8. Contratos API/UI para tasks FULLSTACK
9. Delegação paralela em background:
   - Back-end → `codex:codex-rescue` (Codex gpt-5.4 Effort Medium)
   - Front-end → `cc-gemini-plugin:gemini-agent` (Gemini 3 ou Gemini 3 Flash)
10. Monitoramento (notificações ao concluir + check-in leve para tasks lentas)
11. Integração e resolução de divergências
12. Review pós-implementação (Codex gpt-5.5 high)
13. Verificação OpenSpec (`/openspec-verify-change` → `/openspec-sync-specs` → `/openspec-archive-change`)
14. `workflow-log.md` + `subagents-context.md` + `implementation-report.md` finais
15. Instruções de negócio para o usuário sobre a feature implementada

## Regra central de execução

Durante um workflow iniciado por `/orchestrator`, o Claude atua **somente como orquestrador principal**: mantém o contexto centralizado, decide próximos passos, atualiza artefatos de coordenação e delega implementação para subagentes. Ele **não implementa código, não faz remendos manuais e não continua executando** quando o usuário sinalizar cancelamento, pausa, reprovação ou problema bloqueante.

Atividades paralelas de implementação devem usar subagentes. Para back-end, banco, testes, ajustes pontuais, handoffs e recuperação de falha operacional, use `codex:codex-rescue` com `--model gpt-5.4-codex --effort medium`, salvo reviews formais que continuam em Codex gpt-5.5 high.

## Argumento

`$ARGUMENTS` — descrição da demanda em linguagem natural. Pode ser frase única ou parágrafo com contexto.

## Execucao autonoma com `/goal`

Para trabalho independente entre turnos, o modo recomendado e envolver a demanda em `/goal`. O `/goal` e avaliado por um Stop hook de sessao: depois de cada turno, um modelo rapido verifica se a condicao foi demonstrada na conversa; se nao foi, Claude inicia outro turno automaticamente.

Use este formato quando o usuario pedir autonomia, modo independente, "continue ate terminar" ou equivalente:

```text
/goal Execute a skill cc-orchestrador-subagents:orchestrator-multi-agent-development para: <demanda>. Condicao de conclusao: preflight OK; mudanca OpenSpec criada, planejada e revisada; ondas de subagentes Codex/Gemini encerradas ou bloqueios documentados; review pos-implementacao executado; verificacao OpenSpec executada ou impedimento registrado; workflow-log.md, subagents-context.md e implementation-report.md criados; resultados de testes/validacoes e instrucoes de negocio publicados na conversa; ou pare apos 20 turnos preservando o estado.
```

Se o workflow ja estiver rodando sob `/goal`, nao peca confirmacao a cada etapa operacional. Ao final de cada turno, exponha evidencias que o avaliador consegue ler: fase atual, arquivos criados, subagentes pendentes/concluidos, comandos/testes executados com resultado e criterios restantes.

Nao tente simular `/goal` manualmente. Se o usuario invocou `/orchestrator` diretamente e o trabalho nao couber em um turno, continue o maximo possivel e entregue o comando `/goal` acima preenchido para retomada autonoma.

## Comportamento

Quando este comando for invocado, siga **rigorosamente** esta ordem:

### Modo preflight

Se `$ARGUMENTS` for exatamente `preflight`, rode apenas:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs"
```

Mostre o resumo do JSON ao usuário e encerre. Não carregue a skill, não crie OpenSpec e não inicie workflow.

### Passo 1 — Preflight (obrigatório, antes de tudo)

Execute o script de verificação:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs"
```

Parse o JSON retornado:

- **`status: "ok"`** → siga para o Passo 2.
- **`status: "failed"`** → **CANCELE** imediatamente. Apresente ao usuário a lista de dependências ausentes lendo o campo `remediation`. Não tente fallback, não invoque subagentes, não crie mudança OpenSpec. Mensagem-padrão:

  ```
  Não posso iniciar o orquestrador. Faltam as seguintes dependências:

  • <target>
    <steps formatados em bullets>
    Docs: <docs>

  Instale/atualize as dependências acima e rode `/orchestrator` novamente.
  ```

Detalhes do preflight, remediação por dependência e troubleshooting em `references/preflight-check.md`.

### Passo 2 — Carregar a skill

`Skill(skill="cc-orchestrador-subagents:orchestrator-multi-agent-development")`.

Ela contém o workflow operacional completo (Fase 1 a 14). **Não duplique a lógica aqui** — o SKILL.md é a fonte da verdade. Se o Skill tool recusar a chamada porque a skill é manual-only (`disable-model-invocation: true`), leia `${CLAUDE_PLUGIN_ROOT}/skills/orchestrator-multi-agent-development/SKILL.md` e siga o conteúdo diretamente.

### Passo 3 — Validações leves antes da Fase 1

- Se a demanda é trivial (typo, padding, rename) → avise que o orquestrador é overkill e ofereça executar direto.
- Se o repositório atual **não** tem `openspec/` → ofereça `/openspec-onboard` antes de continuar.

### Passo 4 — Conduzir o workflow

Siga `SKILL.md` + `references/*.md`. Use templates de `assets/*.md` para criar artefatos no `openspec/changes/<nome>/`.

Antes de iniciar cada fase e antes de lançar/redelegar subagentes, faça um gate operacional:

- Se a mensagem mais recente do usuário indicar "cancela", "aborta", "para", "não continue", "pausa", "aguarde", reprovação do plano/contrato ou problema bloqueante, **interrompa imediatamente**.
- Não invoque novos subagentes, não edite implementação e não avance de fase.
- Atualize `monitoring.md`/`workflow-log.md`/`subagents-context.md` com `CANCELLED` ou `PAUSED` quando a mudança já tiver artefatos.
- Responda com o estado atual, artefatos preservados e o que será necessário para retomada.

### Passo 5 — Reportar updates

Mantenha o usuário informado com mensagens curtas:

- "preflight OK";
- "Context7 MCP detectado; vou exigir docs atuais nos prompts dos subagentes" ou "Context7 MCP não detectado; seguindo sem bloquear";
- "criando mudança OpenSpec <nome>";
- "lancei <N> subagentes em paralelo para a onda <N>, aviso quando completarem";
- no fim: caminhos do `workflow-log.md`, `implementation-report.md` e `subagents-context.md` + resumo de 2-3 frases + instruções de negócio para homologar/operar a feature.

## Quando o usuário invocar sem argumento

Se `$ARGUMENTS` estiver vazio:

```
AskUserQuestion(
  question="O que você quer orquestrar?",
  options=[
    {label: "Nova feature full-stack", description: "Implementação end-to-end com back-end + UI"},
    {label: "Refatoração de módulo", description: "Reorganizar código existente sem mudar comportamento"},
    {label: "Bug com impacto arquitetural", description: "Correção que afeta múltiplas camadas"},
    {label: "Migração / integração", description: "Migrar sistema ou integrar API externa"}
  ]
)
```

Use a resposta para enriquecer o contexto da fase 1.

## Quando NÃO usar

Se a demanda for:

- troca de texto / cor / padding;
- rename de variável;
- typo;
- correção de import order;
- ajuste pontual de 1-2 linhas;

ofereça execução direta sem orquestração. Citar:

> "Esta tarefa é pequena demais para o orquestrador. Posso executar direto — quer que eu siga?"
