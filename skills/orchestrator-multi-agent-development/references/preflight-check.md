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
    }
  },
  "failed": [ ... ],
  "remediation": [ ... ]  // null se status=ok
}
```

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

## Falsos negativos comuns

| Sintoma | Causa provável | Correção |
|---|---|---|
| `gemini` ou `codex` "não encontrado" mas funciona no terminal | PATH do shell não está exposto à sessão do Claude Code | Adicione o diretório do binário ao PATH **global** (variáveis de ambiente do sistema), não só ao `.zshrc`/`.bashrc` |
| Plugin instalado mas check falha | Versão antiga sem o diretório esperado | Rode `/plugin update <plugin>` no Claude Code |
| OpenSpec skills em local não-padrão | Instalação custom em outro path | Crie symlinks em `~/.claude/skills/` ou reinstale com `openspec init` |
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
