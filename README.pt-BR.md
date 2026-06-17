![cc-orchestrador-subagents](banner.png)

# cc-orchestrador-subagents

Plugin de Claude Code para conduzir um workflow de desenvolvimento multiagente a partir de um PRD/especificação já pronta, com Codex, Antigravity/AGY e artefatos de auditoria.

**[Read in English](README.md)** — English version available.

## Visão geral

O `cc-orchestrador-subagents` organiza o desenvolvimento como um **Orchestrador de Harness** para Claude CLI/Claude Code. O Claude atua como **Orchestrador Principal**: o seu único objetivo é **orquestrar o trabalho dos agentes**. Ele não faz discovery da demanda nem cria plano — atua exclusivamente em projetos com **PRD já montado ou especificações pré-estabelecidas**.

O usuário fornece a especificação via menção de arquivo (`@docs/prd.md`) ou envio do arquivo de PRD/spec. Esse documento é a **fonte da verdade**: o orquestrador o ingere, classifica as tasks, monta ondas, gera contratos, delega, monitora, integra e revisa.

Codex e Antigravity/AGY entram como subagentes especializados:

| Papel | Executor | Responsabilidade |
|---|---|---|
| Orchestrador de Harness | Claude CLI / Claude Code | Ingere o PRD/spec e coordena o workflow, contratos, ondas, validações, logs e decisões do usuário. |
| Implementação back-end, banco, testes e ajustes | Codex (`codex:codex-rescue`) | Executa tasks não front-end com `--effort medium`, sem fixar `--model`. |
| Implementação front-end e UX | Antigravity/AGY (`cc-antigravity-plugin:antigravity-agent`) | Executa tasks `FRONTEND_ONLY` e fatias front-end de `FULLSTACK`, incluindo setup Vite/React, rotas, e implementação de UI. |
| Review back-end pós-implementação | Codex (`codex:codex-rescue`) | Revisa **apenas o back-end** com `--effort high` ou cai para review interno read-only do orquestrador quando faltar quota. |
| Review front-end pós-implementação | Antigravity/AGY (`cc-antigravity-plugin:antigravity-agent`, `--model gemini-3.1-pro-high`) | Revisa **apenas o front-end** em modo read-only ou cai para review interno do orquestrador quando o AGY estiver indisponível. |

### Workflow completo

- **Fase 0 - Preflight:** executa `node scripts/preflight.mjs`, valida dependências, Codex, AGY, permissão `Bash(node:*)` e registra `autoRemediation` quando `.claude/settings.json` puder ser criado.
- **Fase 1 - Ingestão da especificação:** lê o PRD/spec fornecido pelo usuário (menção de arquivo ou arquivo enviado) e o trata como fonte da verdade. Extrai entregáveis, tasks, decisões técnicas e critérios de aceite, sem reabrir o entendimento. Lacunas bloqueantes são resolvidas com `AskUserQuestion` de forma pontual.
- **Fase 2 - Classificação das tasks:** gera `tasks-classification.md` com categoria, dependências, arquivos críticos, complexidade, `contractRequired`, `assignedAgent` e `routingReason`.
- **Fase 3 - Ondas de execução:** monta `waves.md`, respeitando dependências, contratos pendentes, schemas em mudança e arquivos centrais compartilhados. Depois roda `validate-routing.mjs` e corrige erros de roteamento.
- **Fase 4 - Contratos API/UI:** cria `contracts/*.md` para toda troca front-back, incluindo endpoint, método, wire format, casing JSON, exemplos completos, status codes, estados de UI, permissões e cenários de erro.
- **Fase 5 - Delegação paralela:** envia tasks aos subagentes conforme `waves.md`. Codex recebe prompts sem `--model`; AGY recebe `--model <agyModel>`. Se uma task AGY tiver dois ou mais entregáveis independentes, fan-out é ativado.
- **Fase 6 - Monitoramento:** acompanha `PENDING`, `RUNNING`, `BLOCKED`, `DONE`, `FAILED`, `QUOTA_EXAUSTED`, `AUTH_REQUIRED`, `AGY_MISSING`, `TIMEOUT` e outros estados, registrando evidências em `monitoring.md`.
- **Fase 7 - Integração:** valida aderência ao PRD/spec, contratos, wire format, casing JSON, serialização real, escopo de arquivos, testes e build. Ajustes pontuais voltam para Codex (back-end) ou AGY (front-end) conforme a categoria.
- **Fase 8 - Review back-end pós-implementação:** delega review final read-only ao Codex com `--effort high`, **somente do back-end**, e salva `review-final.md`. Se Codex ficar sem quota, o próprio Orchestrador faz review interno. Ignorada se não houver back-end.
- **Fase 9 - Review front-end pós-implementação:** delega review final read-only ao AGY com `--model gemini-3.1-pro-high`, **somente do front-end**, e salva `review-frontend.md`. Se o AGY estiver indisponível, o Orchestrador faz review interno. **Ignorada se não houver task front-end.**
- **Fase 10 - Relatórios finais:** cria `workflow-log.md`, `subagents-context.md` e `implementation-report.md`, consolidando timeline, contratos, validações, subagentes, Conversation IDs do AGY e status de entrega.
- **Fase 11 - Entrega ao usuário:** publica o resumo final, caminhos dos artefatos, validações executadas, bloqueios restantes e instruções de negócio.

Os artefatos de coordenação ficam em `orchestration/<nome>/`; os relatórios finais ficam na raiz de execução do agente.

### Regras operacionais principais

- **Premissa de uso:** o orquestrador só atua com PRD/spec já pronta. Ele não faz discovery, não cria plano e não reinterpreta a demanda.
- **Codex revisa apenas back-end;** AGY (`gemini-3.1-pro-high`) revisa apenas front-end.
- **Fan-out AGY:** `--agy-parallel` e `--agy-subagent-model` ativam subagentes Gemini nativos dentro da task AGY. Requer `cc-antigravity-plugin >= 3.6.0`.
- **Modelo AGY:** sem override, o Orchestrador escolhe `agyModel` por heurística; o usuário pode forçar com `/orchestrator --agy-model <modelo> <demanda>`. O review front-end usa sempre `gemini-3.1-pro-high`.
- **Prompts Codex:** não fixam `--model`; usam apenas `--effort medium` para implementação/handoff/ajustes e `--effort high` para review back-end.
- **Contratos obrigatórios:** qualquer troca front-back exige contrato antes de paralelizar.
- **Wire format:** todo contrato precisa explicitar casing JSON, nomes de campos, exemplos completos e validação de serialização real.
- **Roteamento por categoria:** `FRONTEND_ONLY` fica com Antigravity/AGY, inclusive setup front-end; Codex só assume front-end como fallback operacional registrado.
- **Quota Codex:** falta de quota em implementação bloqueia e pede decisão do usuário; falta de quota em review back-end aciona review interno read-only do Orchestrador.
- **Sandbox Codex:** rede externa bloqueada para pacotes/restore, pacote ausente no cache local ou escrita fora do working directory permitido viram `BLOCKED` com evidência.
- **Limite AGY no Windows:** prompts AGY acima de 28.000 chars são divididos em subtasks por entregáveis antes da delegação para evitar `ENAMETOOLONG`.

## Dependências oficiais

Este plugin depende do Codex plugin oficial para Claude Code: https://github.com/openai/codex-plugin-cc.

```text
/plugin marketplace add openai/codex-plugin-cc
/plugin install codex@openai-codex
/reload-plugins
/codex:setup
```

O marketplace/dependency usado nos manifests é `openai-codex`, e o subagente esperado é `codex:codex-rescue`.

Para front-end, o orquestrador espera `cc-antigravity-plugin >= 3.6.0` (obrigatório para `--parallel`/`--subagent-model`), com estes arquivos presentes no plugin instalado:

- `agents/antigravity-agent.md`
- `commands/antigravity.md`
- `scripts/antigravity-bridge.js`

## Como fornecer a especificação

O orquestrador não inventa a demanda. Forneça o PRD/spec de uma destas formas:

```text
# Menção de arquivo
/orchestrator @docs/prd-reservas.md

# Spec colada direto no argumento
/orchestrator "Implemente o fluxo de reservas conforme: <cole aqui a especificação completa>"

# Com override de modelo AGY
/orchestrator --agy-model gemini-3.1-pro-low @docs/prd-reservas.md
```

Se nenhum PRD/spec for fornecido, o orquestrador pede a especificação antes de continuar.

## Codex: modelo e effort

O workflow não fixa modelos Codex como `gpt-5.4` ou `gpt-5.5`.

Use:

- `codex:codex-rescue` com `--effort medium` para implementação, handoff e ajustes;
- `codex:codex-rescue` com `--effort high` para review back-end pós-implementação.

O modelo fica no padrão disponível na conta do usuário. Codex nunca revisa front-end.

## Codex: limites de sandbox

Quando o Codex estiver em ambiente sandboxado, trate como bloqueio operacional:

- falha de rede externa para pacotes, restore ou registries, como `NU1301` ao acessar `https://api.nuget.org/v3/index.json`;
- pacote necessário ausente do cache local;
- `UnauthorizedAccessException` ou erro equivalente ao tentar criar/editar arquivos fora do working directory permitido.

Nesses casos o subagente deve parar, registrar evidência e retornar `Status: BLOCKED`, sem insistir em retries longos nem tentar contornar o sandbox.

## Roteamento de front-end

O agente é escolhido pela categoria da task, não pela aparência do trabalho. Se a task for `FRONTEND_ONLY`, use `cc-antigravity-plugin:antigravity-agent` mesmo quando ela for setup Vite/React, React routing ou outra infraestrutura front-end.

Codex só deve receber front-end como fallback operacional registrado depois de `QUOTA_EXAUSTED`, `AUTH_REQUIRED`, `AGY_MISSING`, `TIMEOUT`, falha de ferramenta/escrita do AGY ou decisão explícita.

## AGY: delegação front-end

Tasks de front-end são direcionadas ao Antigravity/AGY por categoria, passando `--model <agyModel>` para o bridge do plugin.

Política padrão (implementação):

- `gemini-3.5-flash-medium` para a maioria das tasks;
- `gemini-3.1-pro-low` para tasks complexas, multi-rota, multi-arquivo, com contrato API/UI delicado ou risco alto de regressão;
- `gemini-3.1-pro-high` apenas em casos críticos;
- override manual disponível em `/orchestrator --agy-model <modelo> <demanda>`.

O **review front-end (Fase 9)** usa sempre `gemini-3.1-pro-high`, independentemente do `agyModel` de implementação.

## AGY: fan-out nativo de subagentes Gemini

Quando uma task front-end produz dois ou mais entregáveis independentes (ex.: três componentes React, dois relatórios HTML), o orquestrador pode acionar o fan-out nativo do AGY via `DefineSubagent` dentro do prompt.

O mecanismo é puramente intra-task: continua sendo 1 task = 1 delegação AGY; `monitoring.md`, contratos e `validate-routing.mjs` ficam intactos.

### Flags novas

| Flag | Comportamento |
|---|---|
| `--agy-parallel` | Força fan-out em todas as tasks AGY da execução. O AGY decide a contagem. |
| `--agy-subagent-model <modelo>` | Modelo dos subagentes Gemini. Implica `--agy-parallel`. Default: `inherit` (herda `agyModel`). |

### Exemplos

```text
# Fan-out forçado pelo usuário
/orchestrator --agy-parallel "Crie três componentes React independentes: Header, Sidebar e Footer"

# Planejador Pro coordenando subagentes Flash
/orchestrator --agy-model gemini-3.1-pro-low --agy-subagent-model gemini-3.5-flash-medium \
  "Gere dois relatórios HTML: impostos em carros elétricos e em carros a combustão"

# Heurística automática (orquestrador decide)
/orchestrator "Crie Header, Sidebar e Footer como componentes separados em src/components/"
```

### Quando o fan-out é usado por heurística

O orquestrador liga `--parallel` automaticamente quando uma task `FRONTEND_ONLY` (ou fatia front-end de `FULLSTACK`) lista dois ou mais entregáveis independentes nos critérios de aceite — e a lógica da task não é compartilhada entre eles.

Entregáveis dependentes ou que compartilham estado permanecem no subagente AGY único, sem `--parallel`.

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

## Preflight e auto-remediação

Rode:

```bash
node scripts/preflight.mjs
```

O JSON inclui:

- `status`
- `checks`
- `failed`
- `remediation`
- `autoRemediation`

O `preflight` valida:

- versão do `agy` encontrada no PATH;
- Codex CLI no PATH;
- `cc-antigravity-plugin >= 3.6.0` e plugin `openai-codex`;
- presença de `agents/antigravity-agent.md`, `commands/antigravity.md` e `scripts/antigravity-bridge.js` no plugin AGY instalado;
- permissão `Bash(node:*)` para o companion do Codex.

> A partir da versão 3.0.0, o preflight não exige mais OpenSpec CLI nem skills `openspec-*`, porque o OpenSpec deixou de fazer parte do fluxo.

### Escopo da auto-remediação

Só existe auto-correção para `codex-companion-bash`:

- se `.claude/settings.json` não existir, ele pode ser criado;
- se existir com JSON válido, `permissions.allow` recebe `Bash(node:*)`;
- se existir com JSON inválido, o arquivo não é sobrescrito.

Exemplo de baseline mínimo:

```json
{
  "permissions": {
    "allow": [
      "Bash(node:*)"
    ]
  }
}
```

## Limite de prompt AGY — limitação do CLI no Windows

O CLI do AGY é invocado via `child_process` pelo bridge do plugin. No Windows, o Node.js passa o prompt como argumento de linha de comando, aplicando quoting automático: cada `"` vira `\"` e cada `\` se duplica.

Resultado dos testes empíricos:

| Tipo de conteúdo | Prompt máximo | Break point |
|---|---|---|
| Texto puro (xxx...) | 32.694 chars | 32.695 → `ENAMETOOLONG` |
| Prompt real (aspas, `\`, XML, `\n`) | ~28.520 chars | ~29.140 → `ENAMETOOLONG` |

**Threshold conservador adotado: 28.000 chars.**

Antes de delegar qualquer task para AGY, o orquestrador monta o prompt completo e conta os caracteres. Se exceder 28.000 chars:

1. Divide os entregáveis da task em dois grupos independentes (A e B).
2. Cria subtasks `<ID>-a` e `<ID>-b`, cada uma cobrindo um grupo.
3. Atualiza `tasks-classification.md` e `waves.md`.
4. Remonta os dois prompts e valida que cada um está abaixo do limite.
5. Registra a divisão em `monitoring.md` e `workflow-log.md` com o tamanho original e o motivo.

Se a task for monolítica e indivisível por entregáveis, o orquestrador tenta reduzir `Arquivos e módulos relevantes` e, como último recurso, registra `promptOverflow: true` e pede decisão ao usuário.

## Política de quota

### Codex em implementação, ajuste ou handoff

Se houver `QUOTA_EXHAUSTED`:

- marcar `BLOCKED`;
- registrar evidência;
- pedir decisão ao usuário.

O orquestrador não continua editando código produtivo por conta própria.

### Codex em review back-end

Se houver `QUOTA_EXHAUSTED`:

- o orquestrador faz review interno read-only;
- salva o resultado em `review-final.md`;
- não edita código produtivo.

### AGY em review front-end

Se houver `QUOTA_EXAUSTED`, `AUTH_REQUIRED`, `AGY_MISSING` ou `TIMEOUT`:

- o orquestrador faz review interno read-only;
- salva o resultado em `review-frontend.md`;
- não edita código produtivo.

### Antigravity/AGY em implementação

Continua com fallback controlado para Codex apenas quando for seguro. O bridge do plugin retorna status cru:

- `QUOTA_EXAUSTED`
- `AUTH_REQUIRED`
- `TIMEOUT`
- `AGY_MISSING`

O orquestrador deve registrar esses valores como vierem do bridge.

## Contratos obrigatórios

Contrato é obrigatório sempre que houver troca de dados entre front-end e back-end.

Isso vale para:

- tasks `FULLSTACK`;
- pares dependentes `BACKEND_ONLY` + `FRONTEND_ONLY`.

Na Fase 2, cada task deve registrar `contractRequired: yes|no`.

Para tasks `FRONTEND_ONLY` e para a fatia front-end de `FULLSTACK`, registre também:

- `agyModel`
- `agyModelSource: user|heuristic`

O validador de roteamento exige esses campos nas tasks AGY e falha se:

- uma task AGY não registrar `agyModel`;
- `agyModelSource` estiver ausente;
- o modelo estiver fora da allowlist;
- `FRONTEND_ONLY` estiver apontando para Codex como agente primário.

Na Fase 4, o orquestrador cria `contracts/*.md` para todo item com `contractRequired: yes`.

## Wire format e serialização

Todo contrato deve documentar:

- casing JSON esperado;
- nomes exatos dos campos;
- exemplos completos de request e response;
- serializer global ou atributos de serialização quando houver;
- validação da serialização real contra o TypeScript consumidor.

Em especial para C# + TypeScript:

- DTO interno em `PascalCase` não basta;
- payload JSON esperado em `camelCase` precisa estar documentado;
- a compatibilidade deve ser validada no payload real, não apenas em tipos TypeScript.

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

## Validação recomendada

```bash
node --check skills/orchestrator-multi-agent-development/scripts/preflight.mjs
node scripts/preflight.mjs
node skills/orchestrator-multi-agent-development/scripts/validate-routing.mjs orchestration/<nome>
rg --line-number --fixed-strings -- 'QUOTA_EXAUSTED' README.md commands skills
rg --line-number --fixed-strings -- 'agyModelSource' README.md commands skills
rg --line-number --fixed-strings -- 'agyParallel' README.md commands skills
rg --line-number --fixed-strings -- 'gemini-3.1-pro-high' README.md commands skills
```
