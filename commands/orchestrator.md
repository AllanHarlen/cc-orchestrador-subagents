---
description: Conduzir um workflow de desenvolvimento multiagêntico (OpenSpec + Claude planejamento + Codex review + Codex/Gemini execução paralela + relatório final)
argument-hint: "<descrição da demanda — ex.: 'implemente o fluxo de reservas com listagem, criação e cancelamento'>"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion, Agent, TaskCreate, TaskUpdate, TaskList, Skill
---

# /orchestrator

Inicia o **Orquestrador Multiagêntico de Desenvolvimento** para a demanda descrita pelo usuário. O orquestrador conduz o workflow completo:

1. Entendimento da demanda
2. Criação de mudança OpenSpec
3. Plano técnico (subagente `Plan` — Claude Sonnet 4.6 Effort High)
4. Review do plano (`codex:codex-rescue` — Codex gpt-5.5 Effort High)
5. Consolidação do plano (orquestrador, Claude Sonnet 4.6 Effort Medium)
6. Classificação das tasks
7. Identificação de paralelização
8. Contratos API/UI para tasks FULLSTACK
9. Delegação paralela em background:
   - Back-end → `codex:codex-rescue` (Codex gpt-5.4 Effort Medium)
   - Front-end → `cc-gemini-plugin:gemini-agent` (Gemini 3 ou Gemini 3 Flash)
10. Monitoramento (notificações ao concluir, sem polling)
11. Integração e resolução de divergências
12. Review pós-implementação (Codex gpt-5.5 high)
13. Verificação OpenSpec (`/openspec-verify-change` → `/openspec-sync-specs` → `/openspec-archive-change`)
14. `implementation-report.md` final

## Argumento

`$ARGUMENTS` — descrição da demanda em linguagem natural. Pode ser frase única ou parágrafo com contexto.

## Comportamento

Quando este comando for invocado:

1. **Carregue a skill `orchestrator-multi-agent-development`** via `Skill(skill="orchestrator-multi-agent-development")`. Ela contém o workflow operacional completo. **Não duplique a lógica aqui** — o SKILL.md é a fonte da verdade.

2. **Antes de seguir**, valide rapidamente:
   - se a demanda é trivial (typo, padding, rename), avise o usuário que o orquestrador é overkill e ofereça executar direto;
   - se o repositório atual **não** tem `openspec/`, ofereça `/openspec-onboard` antes de continuar;
   - se os plugins `openai-codex` e `cc-gemini-plugin` não estão disponíveis, avise e descreva o fallback (resolvido em `references/agent-stack.md`).

3. **Conduza o workflow** seguindo `SKILL.md` + `references/*.md`. Use templates de `assets/*.md` para criar artefatos no `openspec/changes/<nome>/`.

4. **Reporte ao usuário** apenas updates curtos:
   - "criando mudança OpenSpec <nome>";
   - "lancei <N> subagentes em paralelo para a onda <N>, aviso quando completarem";
   - no fim: caminho do `implementation-report.md` + resumo de 2-3 frases.

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
