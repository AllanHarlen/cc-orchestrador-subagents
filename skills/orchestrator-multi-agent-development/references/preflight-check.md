# Preflight check

## Como rodar

```bash
node "${CLAUDE_SKILL_DIR}/scripts/preflight.mjs"
```

## Saida

O JSON inclui:

- `status`
- `checks`
- `failed`
- `remediation`
- `autoRemediation`

## `autoRemediation`

O campo `autoRemediation` registra apenas a tentativa de corrigir `codex-companion-bash` no projeto atual.

Campos esperados:

- `attempted`
- `changed`
- `target`
- `action`
- `revalidated`
- `ok`

Valores tipicos de `action`:

- `none`
- `created-settings-json`
- `updated-settings-json`
- `blocked-invalid-json`
- `blocked-non-object-root`
- `blocked-invalid-permissions-shape`
- `blocked-invalid-allow-shape`

## Politica

- so a permissao `Bash(node:*)` pode ser auto-remediada;
- nenhuma outra dependencia e instalada automaticamente;
- se `.claude/settings.json` existir com JSON invalido, o preflight falha e nao sobrescreve o arquivo;
- a correcao precisa ser revalidada no proprio preflight.

## Permissao aceita

O preflight aceita como compativel:

- `Bash(node:*)`
- `Bash(*)`
- `Bash`
- regra especifica que cite `codex-companion.mjs`

## Remediacao manual

Se a auto-remediacao nao puder agir, ajuste manualmente:

```json
{
  "permissions": {
    "allow": [
      "Bash(node:*)"
    ]
  }
}
```

## Context7

`checks.optional.mcp.context7` continua opcional e nunca bloqueia o workflow.
