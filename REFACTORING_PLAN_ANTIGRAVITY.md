# Plano de Refatoração: cc-gemini-plugin → cc-antigravity-plugin

> **Data:** 2026-05-24  
> **Autor:** Allan Harlen  
> **Escopo:** Migrar todas as referências de `cc-gemini-plugin` (terceiro, `thepushkarp`) para `cc-antigravity-plugin` (próprio, v3.2.0) no projeto `cc-orchestrador-subagents`.

---

## 1. Contexto e Motivação

O orquestrador atualmente depende do plugin `cc-gemini-plugin` (mantido por terceiro) para delegar tarefas front-end a subagentes Gemini. Esse plugin tende a ser descontinuado. O novo `cc-antigravity-plugin` (mantido internamente) oferece:

- **Streaming via ConPTY** em vez de `spawnSync` bloqueante
- **Timeout configurável** (`--timeout`)
- **Continuidade de conversa** (`--continue`, `--conversation <id>`)
- **Workspace nativo AGY** (`--add-dir`) para contextos grandes sem inlining
- **Modo interativo/agente** (`--agent`)
- **Sandbox e skip-permissions** para execução autônoma
- **Logging estruturado** (JSONL via `CC_ANTIGRAVITY_LOG_PATH`)
- **Compatibilidade Node 18+** (o antigo exige Node 22+)
- **Paths absolutos** (`${CLAUDE_PLUGIN_ROOT}`) — funciona após instalação marketplace

---

## 2. Mapeamento de Identidades

| Aspecto | Antigo (cc-gemini-plugin) | Novo (cc-antigravity-plugin) |
|---------|--------------------------|------------------------------|
| Plugin name | `cc-gemini-plugin` | `cc-antigravity-plugin` |
| Marketplace source | `thepushkarp/cc-gemini-plugin` | `AllanHarlen/cc-antigravity-plugin` |
| CLI binary | `gemini` | `agy` |
| Agent name | `gemini-agent` | `antigravity-agent` |
| Subagent type | `cc-gemini-plugin:gemini-agent` | `cc-antigravity-plugin:antigravity-agent` |
| Skill name | `gemini-integration` | `antigravity-integration` |
| Slash command | `/cc-gemini-plugin:gemini` | `/cc-antigravity-plugin:antigravity` |
| Auth | `gemini auth` | Abrir `agy` interativamente (keyring/browser) |
| Install CLI | `npm i -g @google/gemini-cli` | `irm https://antigravity.google/cli/install.ps1 \| iex` (Win) |

---

## 3. Delegacao AGY

O orquestrador nao seleciona modelo ou modo no AGY. Tarefas de front-end sao roteadas para `cc-antigravity-plugin:antigravity-agent`, e o plugin/CLI usa o padrao disponivel.

---

## 4. Inventário de Arquivos a Alterar

### 4.1 Plugin Metadata (2 arquivos)

| Arquivo | Alterações |
|---------|-----------|
| `.claude-plugin/plugin.json` | `dependencies.name`: `cc-gemini-plugin` → `cc-antigravity-plugin`; `dependencies.marketplace`: idem; `description`: remover "Gemini", usar "Antigravity/AGY"; `keywords`: `"gemini"` → `"antigravity"` |
| `.claude-plugin/marketplace.json` | `allowCrossMarketplaceDependenciesOn`: `cc-gemini-plugin` → `cc-antigravity-plugin`; `description`: atualizar; `keywords`: idem |

### 4.2 Comando Principal (1 arquivo)

| Arquivo | Alterações |
|---------|-----------|
| `commands/orchestrator.md` | Substituir `cc-gemini-plugin:gemini-agent` → `cc-antigravity-plugin:antigravity-agent`; substituir "Gemini" → "Antigravity/AGY" nas descrições do workflow; nao passar seletor de modelo ao AGY |

### 4.3 Skill Definition (1 arquivo)

| Arquivo | Alterações |
|---------|-----------|
| `skills/orchestrator-multi-agent-development/SKILL.md` | Tabela de stack: front-end → `AGY` sem seletor de modelo; política de cota |

### 4.4 Referências do Skill (4 arquivos)

| Arquivo | Alterações |
|---------|-----------|
| `skills/.../references/agent-stack.md` | Coluna subagent_type: `cc-gemini-plugin:gemini-agent` → `cc-antigravity-plugin:antigravity-agent`; cota; referência Context7 |
| `skills/.../references/subagent-prompts.md` | Seção 3 inteira: header "Front-end - Gemini" → "Front-end - Antigravity (AGY)"; subagent_type; sem flag de modelo; prompt body |
| `skills/.../references/workflow.md` | Fase 9: delegacao AGY sem seletor de modelo; política de cota |
| `skills/.../references/parallelization.md` | "Gemini" → "Antigravity/AGY" nas regras de paralelização |

### 4.5 Templates de Assets (4 arquivos)

| Arquivo | Alterações |
|---------|-----------|
| `skills/.../assets/subagents-context-template.md` | `cc-gemini-plugin:gemini-agent` → `cc-antigravity-plugin:antigravity-agent` |
| `skills/.../assets/monitoring-template.md` | Subagent type; cota |
| `skills/.../assets/workflow-log-template.md` | Subagent type na tabela |
| `skills/.../assets/implementation-report-template.md` | Registrar AGY como agente front-end, sem seletor de modo pelo orquestrador |

### 4.6 Script de Preflight (1 arquivo — mudanças significativas)

| Arquivo | Alterações |
|---------|-----------|
| `skills/.../scripts/preflight.mjs` | Ver seção 5 abaixo |

### 4.7 Documentação (1 arquivo)

| Arquivo | Alterações |
|---------|-----------|
| `README.md` | Substituições textuais: "Gemini" → "Antigravity/AGY"; links; instruções de instalação |

**Total: 14 arquivos**

---

## 5. Preflight Script — Detalhamento

O `preflight.mjs` é o arquivo com mais lógica a alterar. Mudanças ponto a ponto:

### 5.1 Check de CLI

```diff
- checks.cli.gemini = checkCli("gemini")
+ checks.cli.agy = checkCli("agy")
```

### 5.2 Check de Plugin

```diff
- checks.plugins["cc-gemini-plugin"] = checkPlugin("cc-gemini-plugin", "cc-gemini-plugin")
+ checks.plugins["cc-antigravity-plugin"] = checkPlugin("cc-antigravity-plugin", "cc-antigravity-plugin")
```

### 5.3 Remediação CLI

```diff
- ❌ gemini-cli não encontrado
-    npm install -g @google/gemini-cli
-    Ou: brew install gemini-cli
+ ❌ agy (Antigravity CLI) não encontrado
+    Windows: irm https://antigravity.google/cli/install.ps1 | iex
+    macOS/Linux: curl -fsSL https://antigravity.google/cli/install.sh | bash
+    Depois: abra agy uma vez para autenticar
```

### 5.4 Remediação Plugin

```diff
- ❌ Plugin cc-gemini-plugin não instalado
-    claude plugin install thepushkarp/cc-gemini-plugin
+ ❌ Plugin cc-antigravity-plugin não instalado
+    claude plugin install AllanHarlen/cc-antigravity-plugin
```

### 5.5 Context7 Paths (verificar)

O preflight verifica `~/.gemini/settings.json` e `~/.gemini/mcp.json` para Context7. O AGY pode usar `~/.gemini/antigravity-cli/settings.json`. Confirmar paths reais do AGY e atualizar se necessário.

---

## 6. Novas Capacidades para Incorporar (Opcional)

Funcionalidades do `cc-antigravity-plugin` que o orquestrador pode aproveitar na migração ou em fase posterior:

### 6.1 Timeout Configurável

Adicionar `--timeout 180s` nos prompts de subagentes front-end para evitar tasks travadas. Considerar valores diferentes por complexidade:

| Complexidade | Timeout sugerido |
|-------------|-----------------|
| Front-end simples | `--timeout 120s` |
| Front-end complexo | `--timeout 300s` |

### 6.2 `--add-dir` para Workspace Nativo

Em vez de inlinar todos os arquivos no prompt (limite de 40 arquivos / 32KB cada), usar `--add-dir src/components` para que o AGY acesse o workspace nativamente. Mais escalável para projetos front-end grandes.

### 6.3 Continuidade de Conversa

Para tarefas front-end multi-round (ex: UI → ajustes → testes), usar `--continue` ou `--conversation <id>` para manter contexto entre invocações. Requer plumbing no prompt template.

### 6.4 Logging Estruturado

Setar `CC_ANTIGRAVITY_LOG_PATH` nos subagentes para capturar logs JSONL. Útil para debugging pós-execução e auditoria do workflow.

### 6.5 Sandbox Mode

Para execuções `/goal` autônomas, considerar `--sandbox` para isolar o ambiente do subagente.

---

## 7. Fases de Execução

### Fase 1 — Substituição Direta (Breaking: Sim)

Substituir todas as referências de identidade sem alterar comportamento. Isso é o **mínimo viável** para a migração funcionar.

**Escopo:**
1. `.claude-plugin/plugin.json` — dependency + description
2. `.claude-plugin/marketplace.json` — cross-dep + description
3. `commands/orchestrator.md` — subagent type + delegacao AGY sem seletor de modelo
4. Todos os `references/*.md` — subagent type + delegacao AGY sem seletor de modelo
5. Todos os `assets/*-template.md` — subagent type
6. `skills/.../SKILL.md` — stack table
7. `README.md` — texto

**Critério de aceite:** nao restam referencias ao plugin antigo em arquivos ativos; AGY e delegado sem seletor de modelo.

### Fase 2 — Preflight Script

Atualizar `preflight.mjs` com os novos checks e remediações.

**Escopo:**
1. Substituir check CLI `gemini` → `agy`
2. Substituir check plugin `cc-gemini-plugin` → `cc-antigravity-plugin`
3. Atualizar toda a seção de remediação
4. Verificar e atualizar paths de Context7

**Critério de aceite:** `node preflight.mjs` executa com sucesso em ambiente com `agy` instalado e `cc-antigravity-plugin` ativo.

### Fase 3 — Validação End-to-End

Testar o fluxo completo do orquestrador com o novo plugin.

**Escopo:**
1. Executar `/orchestrator` com um projeto de teste
2. Confirmar que subagentes front-end são delegados via `cc-antigravity-plugin:antigravity-agent`
3. Confirmar que o AGY e delegado sem seletor de modelo
4. Confirmar que o streaming funciona (output aparece incrementalmente)
5. Confirmar que o preflight detecta ausência de `agy` corretamente

### Fase 4 — Capacidades Avançadas (Opcional/Futura)

Incorporar gradualmente as novas funcionalidades (seção 6):
- Timeout configurável nos prompts
- `--add-dir` para workspaces grandes
- Continuidade de conversa para multi-round
- Logging para auditoria

---

## 8. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| AGY CLI não disponível no ambiente do usuário | Preflight falha | Mensagens de remediação claras com URLs de instalação por plataforma |
| Seletor de modelo enviado ao AGY | Subagente pode falhar porque o AGY nao aceita selecao pelo orquestrador | Nao passar `--model`; validar prompts e artefatos antes da delegacao |
| Context7 paths diferem entre gemini-cli e AGY | Preflight reporta Context7 como ausente | Verificar paths reais antes de implementar Fase 2 |
| Streaming muda o padrão de output do monitoring | Heartbeat/SLOW_CHECKIN detecta diferente | Testar pattern matching do monitoring com output streaming |
| `--add-dir` conflita com `--dirs` inline | Arquivos duplicados no contexto | Usar um ou outro, não ambos. Documentar regra no subagent-prompts.md |

---

## 9. Checklist de Migração

- [ ] **Fase 1.1** — Atualizar `.claude-plugin/plugin.json`
- [ ] **Fase 1.2** — Atualizar `.claude-plugin/marketplace.json`
- [ ] **Fase 1.3** — Atualizar `commands/orchestrator.md`
- [ ] **Fase 1.4** — Atualizar `skills/.../SKILL.md`
- [ ] **Fase 1.5** — Atualizar `skills/.../references/agent-stack.md`
- [ ] **Fase 1.6** — Atualizar `skills/.../references/subagent-prompts.md`
- [ ] **Fase 1.7** — Atualizar `skills/.../references/workflow.md`
- [ ] **Fase 1.8** — Atualizar `skills/.../references/parallelization.md`
- [ ] **Fase 1.9** — Atualizar `skills/.../assets/subagents-context-template.md`
- [ ] **Fase 1.10** — Atualizar `skills/.../assets/monitoring-template.md`
- [ ] **Fase 1.11** — Atualizar `skills/.../assets/workflow-log-template.md`
- [ ] **Fase 1.12** — Atualizar `skills/.../assets/implementation-report-template.md`
- [ ] **Fase 1.13** — Atualizar `README.md`
- [ ] **Fase 1.14** — Validar: `grep -ri "cc-gemini-plugin"` retorna 0
- [ ] **Fase 2.1** — Atualizar check CLI no `preflight.mjs`
- [ ] **Fase 2.2** — Atualizar check plugin no `preflight.mjs`
- [ ] **Fase 2.3** — Atualizar remediações no `preflight.mjs`
- [ ] **Fase 2.4** — Verificar paths Context7 para AGY
- [ ] **Fase 2.5** — Testar preflight isolado
- [ ] **Fase 3.1** — Teste e2e com `/orchestrator`
- [ ] **Fase 3.2** — Confirmar delegação via `antigravity-agent`
- [ ] **Fase 3.3** — Confirmar resolução de modelos
- [ ] **Fase 3.4** — Confirmar streaming
- [ ] **Fase 3.5** — Confirmar preflight detecta ausência de `agy`
