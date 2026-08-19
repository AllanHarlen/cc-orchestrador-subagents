# Preflight check

## Como rodar

```bash
node "${CLAUDE_SKILL_DIR}/scripts/preflight.mjs"
```

## Saida

O JSON inclui:

- `status` — `"ok"` ou `"failed"`; so item obrigatorio reprovado muda para `"failed"`
- `generatedAt`
- `projectConfig` — bloco com os quatro papeis efetivos, `path`, `updatedAt` e `requiredCliSet`, ver abaixo
- `checks` — `config`, `runtime`, `cli`, `plugins`, `permissions`, `optional.mcp`
- `autoRemediation`
- `warnings` — array no topo, ver abaixo
- `failed` — so item **obrigatorio** reprovado
- `remediation`

## `projectConfig`

Resolvido antes de qualquer outro check, porque decide quais CLIs sao obrigatorias:

```json
{
  "source": "file",
  "path": ".orchestrator/project-config.md",
  "updatedAt": "2026-02-14T18:07:02Z",
  "roles": {
    "backendExecutor": "codex",
    "frontendExecutor": "agy",
    "backendReviewer": "codex",
    "frontendReviewer": "agy"
  },
  "requiredCliSet": ["codex", "agy"]
}
```

`source` e `"file"` quando `.orchestrator/project-config.md` existe e e valido, ou `"default"` quando o arquivo esta ausente (papeis `codex`/`agy`/`codex`/`agy`). Quando o arquivo existe mas e invalido, `checks.config["project-config"]` reprova (`ok: false`, `required: true`) com o codigo/mensagem do parser e `status` vira `"failed"` — o preflight nunca sobrescreve o arquivo invalido.

`requiredCliSet` decide, sozinho, se `cli.codex`/`plugins.openai-codex` e `cli.agy`/`plugins.cc-antigravity-plugin` sao obrigatorios (`required: true`) ou apenas informativos (`required: false`). Com os quatro papeis em `claude-code`, `requiredCliSet` e `[]` e nenhuma CLI externa e obrigatoria. `runtime.node-sqlite-fts5` e os itens de `permissions` sao obrigatorios em qualquer configuracao.

## `warnings`

Array no topo do relatorio com todo item **opcional** reprovado — nunca bloqueia `status`:

```json
[
  { "category": "mcp", "name": "context7", "required": false, "reason": "NOT_DETECTED" },
  { "category": "cli", "name": "agy", "required": false, "reason": "NOT_REQUIRED_BY_PROJECT_CONFIG" }
]
```

`reason` e `NOT_DETECTED` ou `TIMEOUT` para os dois MCPs (`checks.optional.mcp.codebase-memory`, `checks.optional.mcp.context7`), e `NOT_REQUIRED_BY_PROJECT_CONFIG` para uma CLI/plugin reprovado que nenhum papel da Project_Config exige.

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

## MCPs opcionais

`checks.optional.mcp.context7` e `checks.optional.mcp.codebase-memory` sao ambos detectados pelo preflight e continuam opcionais — ausencia de qualquer um vira `warnings`, nunca `failed`. Ver `references/mcp-context.md` para o protocolo de uso de cada um quando `ok: true`.
