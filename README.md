# cc-orchestrador-subagents

Plugin de Claude Code para conduzir um workflow de desenvolvimento multiagente com OpenSpec, Codex, Gemini e artefatos de auditoria.

## O que mudou nesta versao

- preflight com `autoRemediation` para `Bash(node:*)`;
- prompts Codex sem `--model`;
- contratos obrigatorios para qualquer troca front-back;
- foco explicito em wire format, casing JSON e serializacao real;
- fallback de review interno do orquestrador quando o Codex ficar sem quota no review;
- bloqueio com decisao do usuario quando o Codex ficar sem quota em implementacao.

## Visao geral

O orquestrador:

1. roda preflight;
2. cria e planeja mudanca OpenSpec;
3. pede review de plano ao Codex;
4. classifica tasks e waves;
5. exige contratos antes do paralelismo quando houver troca de dados;
6. delega implementacao para Codex e Gemini;
7. monitora, integra e revisa;
8. entrega `workflow-log.md`, `subagents-context.md` e `implementation-report.md`.

## Codex: modelo e effort

O workflow nao fixa mais modelos Codex como `gpt-5.4` ou `gpt-5.5`.

Use:

- `codex:codex-rescue` com `--effort medium` para implementacao, handoff e ajustes;
- `codex:codex-rescue` com `--effort high` para review de plano e review pos-implementacao.

O modelo fica no padrao disponivel na conta do usuario.

## Preflight e auto-remediacao

Rode:

```bash
node scripts/preflight.mjs
```

O JSON agora inclui:

- `status`
- `checks`
- `failed`
- `remediation`
- `autoRemediation`

### Escopo da auto-remediacao

So existe auto-correcao para `codex-companion-bash`:

- se `.claude/settings.json` nao existir, ele pode ser criado;
- se existir com JSON valido, `permissions.allow` recebe `Bash(node:*)`;
- se existir com JSON invalido, o arquivo nao e sobrescrito.

Exemplo de baseline minimo:

```json
{
  "permissions": {
    "allow": [
      "Bash(node:*)"
    ]
  }
}
```

## Politica de quota

### Codex em implementacao, ajuste ou handoff

Se houver `QUOTA_EXHAUSTED`:

- marcar `BLOCKED`;
- registrar evidencia;
- pedir decisao ao usuario.

O orquestrador nao continua editando codigo produtivo por conta propria.

### Codex em review

Se houver `QUOTA_EXHAUSTED`:

- o orquestrador faz review interno read-only;
- salva o resultado em `review-final.md`;
- nao edita codigo produtivo.

### Gemini

Gemini continua com fallback controlado para Codex apenas quando for seguro.

## Contratos obrigatorios

Contrato e obrigatorio sempre que houver troca de dados entre front-end e back-end.

Isso vale para:

- tasks `FULLSTACK`;
- pares dependentes `BACKEND_ONLY` + `FRONTEND_ONLY`.

Na Fase 6, cada task deve registrar `contractRequired: yes|no`.

Na Fase 8, o orquestrador cria `contracts/*.md` para todo item com `contractRequired: yes`.

## Wire format e serializacao

Todo contrato deve documentar:

- casing JSON esperado;
- nomes exatos dos campos;
- exemplos completos de request e response;
- serializer global ou atributos de serializacao quando houver;
- validacao da serializacao real contra o TypeScript consumidor.

Em especial para C# + TypeScript:

- DTO interno em `PascalCase` nao basta;
- payload JSON esperado em `camelCase` precisa estar documentado;
- a compatibilidade deve ser validada no payload real, nao apenas em tipos TypeScript.

## Arquivos principais

- `commands/orchestrator.md`
- `skills/orchestrator-multi-agent-development/SKILL.md`
- `skills/orchestrator-multi-agent-development/references/workflow.md`
- `skills/orchestrator-multi-agent-development/references/agent-stack.md`
- `skills/orchestrator-multi-agent-development/references/subagent-prompts.md`
- `skills/orchestrator-multi-agent-development/references/contracts.md`
- `skills/orchestrator-multi-agent-development/assets/contract-template.md`
- `skills/orchestrator-multi-agent-development/assets/monitoring-template.md`
- `skills/orchestrator-multi-agent-development/assets/implementation-report-template.md`

## Validacao recomendada

```bash
node --check skills/orchestrator-multi-agent-development/scripts/preflight.mjs
node scripts/preflight.mjs
rg --line-number --fixed-strings -- '--model gpt-5.4-codex' commands skills
rg --line-number --fixed-strings -- '--model gpt-5.5-codex' commands skills
```
