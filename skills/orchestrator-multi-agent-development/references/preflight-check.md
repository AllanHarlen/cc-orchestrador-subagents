# Preflight Check — Verificação de Dependências

Este arquivo documenta o que o `scripts/preflight.mjs` verifica, como interpretar os resultados e como remediar cada falha.

## Como rodar

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs"
```

`CLAUDE_PLUGIN_ROOT` é injetado pelo Claude Code quando o plugin está ativo. Em desenvolvimento local, troque pelo caminho absoluto do plugin.

A saída é sempre JSON. O exit code é:

- **0** quando tudo está OK;
- **1** quando alguma dependência está ausente ou quebrada.

## Formato da saída

```json
{
  "status": "ok",
  "generatedAt": "<ISO8601>",
  "checks": {
    "cli": {
      "gemini":  { "ok": true|false, "version": "...", "error": "..." },
      "codex":   { "ok": true|false, "version": "...", "error": "..." },
      "openspec":{ "ok": true|false, "version": "...", "error": "..." }
    },
    "plugins": {
      "cc-gemini-plugin": { "ok": true|false, "version": "...", "path": "..." },
      "openai-codex":     { "ok": true|false, "version": "...", "path": "..." }
    },
    "skills": {
      "openspec": { "ok": true|false, "found": [...], "missing": [...] }
    },
    "permissions": {
      "codex-companion-bash": {
        "ok": true|false,
        "path": "...",
        "rules": [...],
        "profile": {
          "defaultMode": "auto|null",
          "allowCount": 0,
          "denyCount": 0,
          "askCount": 0,
          "hasBroadBashAccess": true|false,
          "hasWebSearch": true|false,
          "hasPlaywrightMcp": true|false,
          "sampleAllow": [...],
          "sampleDeny": [...],
          "sampleAsk": [...]
        },
        "error": "..."
      },
      "goal-hooks-enabled": { "ok": true|false, "inspected": [...], "error": "..." }
    },
    "optional": {
      "mcp": {
        "context7": { "ok": true|false, "optional": true, "evidence": [...], "error": "...", "install": [...] }
      }
    }
  },
  "failed": [ ... ],
  "remediation": [ ... ]  // null se status=ok
}
```

`checks.optional.mcp.context7` não entra em `failed` e nunca muda o exit code. Quando `ok=true`, use esse sinal para orientar Codex/Gemini a consultar Context7 em tasks que envolvam bibliotecas, frameworks, SDKs, APIs, CLIs ou cloud services. Quando `ok=false`, siga normalmente.

Quando `checks.permissions.codex-companion-bash.ok=true`, o preflight tambem tenta expor um resumo do perfil de permissoes encontrado em `profile`. Esse resumo nao e validacao de seguranca; ele existe para tornar visivel se o projeto distribui um perfil minimo ou um perfil operacional amplo para os agentes.

## Política de cancelamento

Se `status` for `"failed"`, o orquestrador **deve**:

1. Não invocar nenhum subagente.
2. Não criar mudança OpenSpec.
3. Apresentar a lista de dependências ausentes ao usuário.
4. Apresentar os passos de remediação do campo `remediation`.
5. Encerrar a operação. Não tentar fallback automático.

Mensagem-padrão para o usuário:

```
Não posso iniciar o orquestrador. Faltam as seguintes dependências:

• <target 1>
  Passos:
    <step 1>
    <step 2>
  Docs: <url>

• <target 2>
  ...

Instale/atualize/configure as dependências acima e rode `/orchestrator` novamente.
```

## Dependências e remediação

### gemini CLI

- **O que é:** Google Gemini CLI (`@google/gemini-cli`). Necessário para o `cc-gemini-plugin:gemini-agent` chamar o modelo via bridge.
- **Como verificar manualmente:** `gemini --version`.
- **Como remediar:**

  ```bash
  npm install -g @google/gemini-cli
  # ou no macOS:
  brew install gemini-cli

  gemini auth
  ```
- **PATH global:** confirme com `which gemini` (macOS/Linux) ou `(Get-Command gemini).Source` (PowerShell).
- **Documentação:** https://ai.google.dev/gemini-api/docs/cli

### codex CLI

- **O que é:** OpenAI Codex CLI (`@openai/codex`). Necessário para `codex:codex-rescue` e `/codex:review` rodarem o cliente local.
- **Como verificar manualmente:** `codex --version`.
- **Como remediar:**

  ```bash
  npm install -g @openai/codex

  codex login
  ```
- **PATH global:** `which codex` ou `(Get-Command codex).Source`.
- **Documentação:** https://github.com/openai/codex

### openspec CLI

- **O que é:** OpenSpec CLI (`@fission-ai/openspec`). Mantém o diretório `openspec/` e instala/atualiza os skills `openspec-*`.
- **Como verificar manualmente:** `openspec --version`.
- **Como remediar:**

  ```bash
  npm install -g @fission-ai/openspec

  # No projeto onde a mudança será planejada:
  openspec init
  ```
- **PATH global:** `which openspec`.
- **Documentação:** https://github.com/Fission-AI/OpenSpec

### Plugin Claude Code: cc-gemini-plugin

- **O que é:** wrapper que expõe `/cc-gemini-plugin:gemini` e o subagente `cc-gemini-plugin:gemini-agent` no Claude Code.
- **Como verificar manualmente:** confira se existe `~/.claude/plugins/cache/cc-gemini-plugin/`.
- **Como remediar (dentro do Claude Code):**

  ```
  /plugin marketplace add thepushkarp/cc-gemini-plugin
  /plugin install cc-gemini-plugin@cc-gemini-plugin
  ```
- **Documentação:** https://github.com/thepushkarp/cc-gemini-plugin

### Plugin Claude Code: openai-codex (codex-plugin-cc)

- **O que é:** wrapper que expõe `/codex:review`, `/codex:rescue` e o subagente `codex:codex-rescue` no Claude Code.
- **Como verificar manualmente:** confira se existe `~/.claude/plugins/cache/openai-codex/codex/`.
- **Como remediar (dentro do Claude Code):**

  ```
  /plugin marketplace add openai/codex-plugin-cc
  /plugin install codex@openai-codex
  ```
- **Documentação:** https://github.com/openai/codex-plugin-cc

### OpenSpec skills (~/.claude/skills/openspec-*)

- **O que é:** conjunto de skills (`openspec-new-change`, `openspec-ff-change`, `openspec-apply-change`, `openspec-verify-change`, `openspec-archive-change`, `openspec-sync-specs`) instaladas pelo OpenSpec CLI.
- **Como verificar manualmente:** `ls ~/.claude/skills | grep openspec`.
- **Como remediar:**

  ```bash
  # Reinstale o CLI (que reinstala as skills associadas)
  npm install -g @fission-ai/openspec
  openspec init   # no projeto alvo
  ```
- **Documentação:** https://github.com/Fission-AI/OpenSpec

### Claude Code permission: codex-companion via Bash

- **O que e:** permissao do Claude Code que deixa o subagente `codex:codex-rescue` chamar `node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" task ...` via `Bash` sem pedir aprovacao manual.
- **Por que importa:** subagentes em background nao podem ficar bloqueados esperando aprovacao de Bash; sem essa permissao, o fluxo de back-end/review com Codex trava.
- **Como verificar manualmente:** confira se `.claude/settings.json`, `.claude/settings.local.json`, `~/.claude/settings.json` ou `~/.claude/settings.local.json` contem uma regra compativel em `permissions.allow`.
- **O que o preflight aceita como compativel:** `Bash(node:*)`, `Bash(*)`, `Bash`, ou uma regra especifica que mencione `codex-companion.mjs`.
- **Como remediar no projeto alvo:**

  ```json
  {
    "permissions": {
      "allow": [
        "Bash(node:*)"
      ]
    }
  }
  ```

- **Perfil ampliado:** o repositório pode distribuir um conjunto muito maior de permissoes em `.claude/settings.json` para dar autonomia aos agentes. Isso e aceitavel para o preflight desde que a regra minima compativel para o Codex companion esteja presente. Quando detectar esse perfil, o preflight passa a reportar contagens e amostras de `allow`, `deny` e `ask` no campo `profile`.

- **Documentacao:** https://docs.anthropic.com/en/docs/claude-code/settings

### Claude Code /goal hooks

- **O que e:** `/goal` usa um Stop hook de sessao para avaliar a condicao de conclusao depois de cada turno.
- **Por que importa:** se hooks estiverem desabilitados, o orquestrador nao consegue continuar autonomamente entre turnos.
- **Como verificar manualmente:** confira `.claude/settings.json`, `.claude/settings.local.json`, `~/.claude/settings.json`, `~/.claude/settings.local.json` e managed settings quando acessivel.
- **Configuracoes bloqueantes:** `disableAllHooks: true` bloqueia `/goal`; `allowManagedHooksOnly: true` pode impedir o hook de sessao usado pelo `/goal`.
- **Como remediar:** remova essas configuracoes bloqueantes no escopo aplicavel e aceite o trust dialog do workspace no Claude Code.
- **Documentacao:** https://code.claude.com/docs/en/goal

### Context7 MCP (opcional)

- **O que é:** MCP que fornece documentação atual de bibliotecas, frameworks, SDKs, APIs, CLIs e cloud services para reduzir decisões baseadas em memória desatualizada.
- **Como verificar manualmente:** confira se existe uma entrada `context7` em `.mcp.json`, `~/.claude.json`, `~/.claude/mcp.json`, `~/.codex/config.toml`, `~/.gemini/settings.json` ou skill `~/.claude/skills/context7*/SKILL.md`.
- **Como instalar/configurar:**

  ```bash
  npx ctx7 setup --claude

  # alternativa via MCP remoto:
  claude mcp add --scope user --header "CONTEXT7_API_KEY: YOUR_API_KEY" --transport http context7 https://mcp.context7.com/mcp
  ```
- **Política:** opcional. A ausência de Context7 não cancela o orquestrador; apenas remova a exigência dos prompts dos subagentes.
- **Documentação:** https://github.com/upstash/context7

## Falsos negativos comuns

| Sintoma | Causa provável | Correção |
|---|---|---|
| `gemini` ou `codex` "não encontrado" mas funciona no terminal | PATH do shell não está exposto à sessão do Claude Code | Adicione o diretório do binário ao PATH **global** (variáveis de ambiente do sistema), não só ao `.zshrc`/`.bashrc` |
| Plugin instalado mas check falha | Versão antiga sem o diretório esperado | Rode `/plugin update <plugin>` no Claude Code |
| OpenSpec skills em local não-padrão | Instalação custom em outro path | Crie symlinks em `~/.claude/skills/` ou reinstale com `openspec init` |
| Context7 instalado mas `ok=false` | Configuração em arquivo fora dos caminhos conhecidos | Adicione `context7` a `.mcp.json`, `~/.claude.json`, `~/.claude/mcp.json`, `~/.codex/config.toml` ou `~/.gemini/settings.json`, ou trate como opcional no prompt |
| Funciona no macOS, falha no Windows | PATH global ainda não recarregado após install | Feche e reabra o Claude Code |

## Variantes de plataforma

### macOS / Linux
O preflight detecta caminhos via `~/.claude/...`. Funciona sem ajuste.

### Windows
O preflight resolve para `%USERPROFILE%\.claude\...` automaticamente via `os.homedir()`. Garanta que:

- Node esteja instalado e no PATH;
- Os instaladores CLI (`npm i -g ...`) tenham acrescentado o diretório global ao PATH **do sistema**, não apenas do usuário, se você precisa que outros agentes acessem;
- Após instalar uma CLI, reinicie o Claude Code para que o PATH seja relido.

## Por que não fazer fallback automático

O orquestrador tem agentes especializados para cada papel. Sem Codex ou Gemini, o "orquestrador" vira um Claude tentando fazer tudo sozinho — perde paralelismo, perde especialização e o objetivo da skill se desfaz. Por isso a política é **cancelar** em vez de degradar silenciosamente.

Se o usuário **realmente** quiser rodar sem alguma dependência (ex.: prototipagem rápida sem Codex), oriente-o a desinstalar/desabilitar este plugin temporariamente e usar o Claude direto. Não burle o preflight.
