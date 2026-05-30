# cc-orchestrador-subagents

Plugin de Claude Code para conduzir um workflow de desenvolvimento multiagente com OpenSpec, Codex, Antigravity/AGY e artefatos de auditoria.

## O que mudou nesta versao

- **fan-out nativo de subagentes Gemini** via `--agy-parallel` e `--agy-subagent-model` (requer `cc-antigravity-plugin >= 3.6.0`);
- preflight com `autoRemediation` para `Bash(node:*)`;
- prompts Codex sem `--model`;
- contratos obrigatorios para qualquer troca front-back;
- roteamento por categoria: `FRONTEND_ONLY` vai para Antigravity/AGY, inclusive setup de front-end;
- selecao de modelo AGY por heuristica, com override opcional via `--agy-model`;
- foco explicito em wire format, casing JSON e serializacao real;
- fallback de review interno do orquestrador quando o Codex ficar sem quota no review;
- bloqueio com decisao do usuario quando o Codex ficar sem quota em implementacao;
- politica operacional para limites de sandbox Codex: rede externa bloqueada para pacotes/restore e escrita fora do working directory permitido;
- reforco de que UI sem dependencia de rede deve permanecer com Antigravity/AGY, registrando fallback para Codex apenas quando for seguro.

## Visao geral

O orquestrador:

1. roda preflight;
2. cria e planeja mudanca OpenSpec;
3. pede review de plano ao Codex;
4. classifica tasks e waves;
5. exige contratos antes do paralelismo quando houver troca de dados;
6. delega implementacao para Codex e Antigravity/AGY;
7. monitora, integra e revisa;
8. entrega `workflow-log.md`, `subagents-context.md` e `implementation-report.md`.

## Dependencias oficiais

Este plugin depende do Codex plugin oficial para Claude Code: https://github.com/openai/codex-plugin-cc.

```text
/plugin marketplace add openai/codex-plugin-cc
/plugin install codex@openai-codex
/reload-plugins
/codex:setup
```

O marketplace/dependency usado nos manifests e `openai-codex`, e o subagente esperado e `codex:codex-rescue`.

Para front-end, o orquestrador espera `cc-antigravity-plugin >= 3.6.0` (obrigatorio para `--parallel`/`--subagent-model`), com estes arquivos presentes no plugin instalado:

- `agents/antigravity-agent.md`
- `commands/antigravity.md`
- `scripts/antigravity-bridge.js`

## Codex: modelo e effort

O workflow nao fixa mais modelos Codex como `gpt-5.4` ou `gpt-5.5`.

Use:

- `codex:codex-rescue` com `--effort medium` para implementacao, handoff e ajustes;
- `codex:codex-rescue` com `--effort high` para review de plano e review pos-implementacao.

O modelo fica no padrao disponivel na conta do usuario.

## Codex: limites de sandbox

Quando o Codex estiver em ambiente sandboxado, trate como bloqueio operacional:

- falha de rede externa para pacotes, restore ou registries, como `NU1301` ao acessar `https://api.nuget.org/v3/index.json`;
- pacote necessario ausente do cache local;
- `UnauthorizedAccessException` ou erro equivalente ao tentar criar/editar arquivos fora do working directory permitido.

Nesses casos o subagente deve parar, registrar evidencia e retornar `Status: BLOCKED`, sem insistir em retries longos nem tentar contornar o sandbox. O orquestrador pede decisao do usuario ou ajusta o handoff. Para tasks de UI sem dependencia de rede, mantenha o roteamento primario para Antigravity/AGY.

## Roteamento de front-end

O agente e escolhido pela categoria da task, nao pela aparencia do trabalho. Se a task for `FRONTEND_ONLY`, use `cc-antigravity-plugin:antigravity-agent` mesmo quando ela for setup Vite/React, React Router, tipos TypeScript, servicos `fetch` ou componentes simples.

Codex so deve receber front-end como fallback operacional registrado depois de `QUOTA_EXAUSTED`, `AUTH_REQUIRED`, `AGY_MISSING`, `TIMEOUT`, falha de ferramenta/escrita do AGY ou decisao explicita do usuario.

## AGY: delegacao front-end

Tasks de front-end sao direcionadas ao Antigravity/AGY por categoria, passando `--model <agyModel>` para o bridge do plugin.

Politica padrao:

- `gemini-3.5-flash-medium` para a maioria das tasks;
- `gemini-3.1-pro-low` para tasks complexas, multi-rota, multi-arquivo, com contrato API/UI delicado ou risco alto de regressao;
- `gemini-3.1-pro-high` apenas em casos criticos;
- override manual disponivel em `/orchestrator --agy-model <modelo> <demanda>`.

## AGY: fan-out nativo de subagentes Gemini

Quando uma task front-end produz dois ou mais entregaveis independentes (ex.: tres componentes React, dois relatorios HTML), o orquestrador pode acionar o fan-out nativo do AGY via `DefineSubagent`/`invoke_subagent`/`ManageSubagents`. O AGY decide a contagem, executa concorrentemente e reporta um Conversation ID por subagente.

O mecanismo e puramente intra-task: continua sendo 1 task = 1 delegacao AGY; `monitoring.md`, contratos e `validate-routing.mjs` ficam intactos.

### Flags novas

| Flag | Comportamento |
|---|---|
| `--agy-parallel` | Forca fan-out em todas as tasks AGY da execucao. O AGY decide a contagem. |
| `--agy-subagent-model <modelo>` | Modelo dos subagentes Gemini. Implica `--agy-parallel`. Default: `inherit` (herda `agyModel`). |

### Exemplos

```text
# Fan-out forcado pelo usuario
/orchestrator --agy-parallel "Crie tres componentes React independentes: Header, Sidebar e Footer"

# Planejador Pro coordenando subagentes Flash
/orchestrator --agy-model gemini-3.1-pro-low --agy-subagent-model gemini-3.5-flash-medium \
  "Gere dois relatorios HTML: impostos em carros eletricos e em carros a combustao"

# Heuristica automatica (orquestrador decide)
/orchestrator "Crie Header, Sidebar e Footer como componentes separados em src/components/"
```

### Quando o fan-out e usado por heuristica

O orquestrador liga `--parallel` automaticamente quando uma task `FRONTEND_ONLY` (ou fatia front-end de `FULLSTACK`) lista dois ou mais entregaveis independentes nos criterios de aceite — e nenhum deles compartilha arquivo central, depende de contrato pendente ou schema em mudanca.

Entregaveis dependentes ou que compartilham estado permanecem no subagente AGY unico, sem `--parallel`.

### Campos novos em `tasks-classification.md` e `waves.md` (tasks AGY)

- `agyParallel: yes|no`
- `agyParallelSource: user|heuristic`
- `agySubagentModel: <modelo>|inherit`

Modelos aceitos em `--agy-model` e `--agy-subagent-model`:

| Modelo | Tier |
|---|---|
| `gemini-3.5-flash-low` | Flash |
| `gemini-3.5-flash-medium` | Flash |
| `gemini-3.5-flash-high` | Flash |
| `gemini-3.1-pro-low` | Pro |
| `gemini-3.1-pro-high` | Pro |
| `claude-4.6-sonnet-thinking` | Claude |
| `claude-4.6-opus-thinking` | Claude |
| `gpt-oss-120b-medium` | GPT |
| `auto` | — |

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

O `preflight` agora tambem valida:

- versao do `agy` encontrada no PATH;
- `cc-antigravity-plugin >= 3.6.0`;
- presenca de `agents/antigravity-agent.md`, `commands/antigravity.md` e `scripts/antigravity-bridge.js` no plugin AGY instalado.

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

### Antigravity/AGY

Antigravity/AGY continua com fallback controlado para Codex apenas quando for seguro.

O bridge do plugin retorna status cru:

- `QUOTA_EXAUSTED`
- `AUTH_REQUIRED`
- `TIMEOUT`
- `AGY_MISSING`

O orquestrador deve registrar esses valores como vierem do bridge.

## Contratos obrigatorios

Contrato e obrigatorio sempre que houver troca de dados entre front-end e back-end.

Isso vale para:

- tasks `FULLSTACK`;
- pares dependentes `BACKEND_ONLY` + `FRONTEND_ONLY`.

Na Fase 6, cada task deve registrar `contractRequired: yes|no`.

Para tasks `FRONTEND_ONLY` e para a fatia front-end de `FULLSTACK`, registre tambem:

- `agyModel`
- `agyModelSource: user|heuristic`

O validador de roteamento passa a exigir esses campos nas tasks AGY e falha se:

- uma task AGY nao registrar `agyModel`;
- `agyModelSource` estiver ausente;
- o modelo estiver fora da allowlist;
- `FRONTEND_ONLY` estiver apontando para Codex como agente primario.

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
node skills/orchestrator-multi-agent-development/scripts/validate-routing.mjs openspec/changes/<nome>
rg --line-number --fixed-strings -- 'QUOTA_EXAUSTED' README.md commands skills
rg --line-number --fixed-strings -- 'agyModelSource' README.md commands skills
rg --line-number --fixed-strings -- 'agyParallel' README.md commands skills
```
