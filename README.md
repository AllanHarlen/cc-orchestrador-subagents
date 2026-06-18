![cc-orchestrador-subagents](banner.png)

# cc-orchestrador-subagents

Plugin de Claude Code para conduzir um workflow de desenvolvimento multiagente com OpenSpec, Codex, Antigravity/AGY e artefatos de auditoria.

## Visao geral

O `cc-orchestrador-subagents` organiza o desenvolvimento como um **Orchestrador de Harness** para Claude CLI/Claude Code. O Claude atua como **Orchestrador Principal**: mantem contexto, conduz OpenSpec, toma decisoes de roteamento, prepara artefatos de coordenacao, monta prompts, monitora execucao e consolida resultados. Ele nao deve implementar codigo produtivo diretamente durante o workflow orquestrado.

Codex e Antigravity/AGY entram como subagentes especializados:

| Papel | Executor | Responsabilidade |
|---|---|---|
| Orchestrador de Harness | Claude CLI / Claude Code | Coordena o workflow, OpenSpec, contratos, ondas, validacoes, logs e decisoes do usuario. |
| Review de entendimento e plano | Codex (`codex:codex-rescue`) | Faz revisao critica read-only com `--effort high`. |
| Implementacao back-end, banco, testes e ajustes | Codex (`codex:codex-rescue`) | Executa tasks nao front-end com `--effort medium`, sem fixar `--model`. |
| Implementacao front-end e UX | Antigravity/AGY (`cc-antigravity-plugin:antigravity-agent`) | Executa tasks `FRONTEND_ONLY` e fatias front-end de `FULLSTACK`, incluindo setup Vite/React, rotas, tipos TypeScript, clients API, componentes, hooks, estado e UX. |
| Review pos-implementacao | Codex (`codex:codex-rescue`) | Revisa a entrega final com `--effort high` ou cai para review interno read-only do orquestrador quando faltar quota. |

### Workflow completo

- **Fase 0 - Preflight:** executa `node scripts/preflight.mjs`, valida dependencias, Codex, AGY, permissao `Bash(node:*)` e registra `autoRemediation` quando `.claude/settings.json` puder ser criado ou atualizado com seguranca.
- **Fase 0.5 - Ingestao do Pensador (upstream):** descobre `.pensador/<slug>-vN/handoff.json` e ingere `prd`, `userhistory`, `architecture` e `comunication_json.md` conforme o contrato de handoff (`references/handoff-contract.md`). O `comunication_json.md` vira a base dos contratos da Fase 8. Adota o `slug` base como identidade; toda coordenacao vai para `.orchestration/<slug>/`.
- **Fase 1 - Entendimento da demanda:** roda `/opsx:explore`, le o estado do projeto, specs existentes e mudancas anteriores. Duvidas de escopo, conflito com specs ou decisoes arquiteturais abertas sao resolvidas com `AskUserQuestion` antes de avancar.
- **Fase 2 - Review do entendimento com Codex:** delega uma revisao read-only para Codex com `--effort high`, salva `review-entendimento.md` e resolve duvidas ou ajustes obrigatorios antes de criar artefatos OpenSpec. Hipoteses nao verificaveis exigem leitura dos arquivos relevantes antes de virar decisao no `design.md`.
- **Fase 3 - Criacao da mudanca OpenSpec:** cria `openspec/changes/<nome>/` via `/openspec-new-change <nome>`.
- **Fase 4 - Planejamento:** o Orchestrador Principal escreve diretamente `proposal.md`, `design.md` e `tasks.md`, com objetivo, escopo, impacto arquitetural, riscos, estrategia de testes e criterios de aceite.
- **Fase 4.5 - Gate de suficiencia do plano:** preenche `plan-sufficiency-check.md`; plano insuficiente nao segue para delegacao.
- **Fase 5 - Consolidacao do plano:** revisita o entendimento aprovado, aplica ajustes e torna `proposal.md`, `design.md` e `tasks.md` a fonte da verdade do restante do workflow.
- **Fase 6 - Classificacao das tasks:** gera `tasks-classification.md` com categoria, dependencias, arquivos criticos, complexidade, `contractRequired`, `assignedAgent` e `routingReason`. A categoria decide o agente: `FRONTEND_ONLY` vai para AGY; back-end, banco, testes e reviews vao para Codex; `FULLSTACK` divide back-end para Codex e front-end para AGY.
- **Fase 7 - Ondas de execucao:** monta `waves.md`, respeitando dependencias, contratos pendentes, schemas em mudanca e arquivos centrais compartilhados. Depois roda `validate-routing.mjs` e corrige qualquer divergencia antes de delegar.
- **Fase 8 - Contratos API/UI:** cria `contracts/*.md` para toda troca front-back, incluindo endpoint, metodo, wire format, casing JSON, exemplos completos, status codes, estados de UI, permissoes, validacoes e comprovacao de serializacao real contra TypeScript.
- **Fase 9 - Delegacao paralela:** envia tasks aos subagentes conforme `waves.md`. Codex recebe prompts sem `--model`; AGY recebe `--model <agyModel>`. Se uma task AGY tiver dois ou mais entregaveis independentes, o Orchestrador pode usar fan-out nativo Gemini via `--agy-parallel` e `--agy-subagent-model`.
- **Fase 10 - Monitoramento:** acompanha `PENDING`, `RUNNING`, `BLOCKED`, `DONE`, `FAILED`, `QUOTA_EXAUSTED`, `AUTH_REQUIRED`, `AGY_MISSING`, `TIMEOUT` e outros estados, registrando evidencias em `monitoring.md`, `workflow-log.md` e `subagents-context.md`.
- **Fase 11 - Integracao:** valida aderencia a `tasks.md`, contratos, wire format, casing JSON, serializacao real, escopo de arquivos, testes e build. Ajustes pontuais voltam para Codex com `--effort medium`.
- **Fase 12 - Review pos-implementacao:** delega review final read-only ao Codex com `--effort high` e salva `review-final.md`. Se Codex ficar sem quota em review, o proprio Orchestrador faz review interno read-only e registra o fallback.
- **Fase 13 - Verificacao OpenSpec:** executa `/openspec-verify-change <nome>`, `/openspec-sync-specs <nome>` e `/openspec-archive-change <nome>` quando aplicavel.
- **Fase 14 - Relatorios finais:** cria `workflow-log.md`, `subagents-context.md`, `implementation-report.md` e `handoff.json` em `.orchestration/<slug>/`, consolidando timeline, contratos, validacoes, subagentes, Conversation IDs do AGY e tokens por agente. O `handoff.json` e o manifesto que o `/cc-executor-subagents:executor` consome para o review.
- **Fase 15 - Entrega ao usuario:** publica o resumo final, caminhos dos artefatos, validacoes executadas, bloqueios restantes e instrucoes de negocio.

### Regras operacionais principais

- **Fan-out AGY:** `--agy-parallel` e `--agy-subagent-model` ativam subagentes Gemini nativos dentro da task AGY. Requer `cc-antigravity-plugin >= 3.6.0`.
- **Modelo AGY:** sem override, o Orchestrador escolhe `agyModel` por heuristica; o usuario pode forcar com `/orchestrator --agy-model <modelo> <demanda>`.
- **Prompts Codex:** nao fixam `--model`; usam apenas `--effort medium` para implementacao/handoff/ajustes e `--effort high` para reviews.
- **Contratos obrigatorios:** qualquer troca front-back exige contrato antes de paralelizar.
- **Wire format:** todo contrato precisa explicitar casing JSON, nomes de campos, exemplos completos e validacao de serializacao real.
- **Roteamento por categoria:** `FRONTEND_ONLY` fica com Antigravity/AGY, inclusive setup front-end; Codex so assume front-end como fallback operacional registrado.
- **Quota Codex:** falta de quota em implementacao bloqueia e pede decisao do usuario; falta de quota em review aciona review interno read-only do Orchestrador.
- **Sandbox Codex:** rede externa bloqueada para pacotes/restore, pacote ausente no cache local ou escrita fora do working directory permitido viram `BLOCKED` com evidencia.
- **Duvidas do `/opsx:explore`:** ambiguidades de escopo, conflitos com specs e decisoes arquiteturais abertas sao resolvidas antes do planejamento.
- **Hipoteses nao verificaveis:** ajustes obrigatorios do review Codex que dependem de inspecao do repositorio precisam ser confirmados ou descartados com leitura real de arquivos.
- **Limite AGY no Windows:** prompts AGY acima de 28.000 chars sao divididos em subtasks por entregaveis antes da delegacao para evitar `ENAMETOOLONG`.

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

## Duvidas do `/opsx:explore` (Fase 1)

Apos executar `/opsx:explore` na Fase 1, o orquestrador verifica se ha duvidas de planejamento pendentes no resultado. Se houver, usa `AskUserQuestion` para resolvê-las com o usuario antes de avancar para 1.2.

Situacoes que disparam `AskUserQuestion`:

- ambiguidade de escopo ou requisito que bloqueia o entendimento da demanda;
- conflito entre a demanda atual e specs ou mudancas anteriores em `openspec/`;
- decisao de arquitetura em aberto que impede mapear o impacto arquitetural corretamente.

O orquestrador nao avanca para 1.2 com duvidas pendentes do `/opsx:explore` sem registro da resposta do usuario.

## Limite de prompt AGY — limitacao do CLI no Windows

O CLI do AGY e invocado via `child_process` pelo bridge do plugin. No Windows, o Node.js passa o prompt como argumento de linha de comando, aplicando quoting automatico: cada `"` vira `\"` e cada `\` antes de `"` dobra. Isso infla o tamanho codificado em ~14% acima do tamanho raw do texto.

Resultado dos testes empiricos:

| Tipo de conteudo | Prompt maximo | Break point |
|---|---|---|
| Texto puro (xxx...) | 32.694 chars | 32.695 → `ENAMETOOLONG` |
| Prompt real (aspas, `\`, XML, `\n`) | ~28.520 chars | ~29.140 → `ENAMETOOLONG` |

**Threshold conservador adotado: 28.000 chars.**

Antes de delegar qualquer task para AGY, o orquestrador monta o prompt completo e conta os caracteres. Se exceder 28.000 chars:

1. Divide os entregaveis da task em dois grupos independentes (A e B).
2. Cria subtasks `<ID>-a` e `<ID>-b`, cada uma cobrindo um grupo.
3. Atualiza `tasks-classification.md` e `waves.md`.
4. Remonta os dois prompts e valida que cada um esta abaixo do limite.
5. Registra a divisao em `monitoring.md` e `workflow-log.md` com o tamanho original e o motivo.

Se a task for monolitica e indivisivel por entregaveis, o orquestrador tenta reduzir `Arquivos e modulos relevantes` e, como ultimo recurso, registra `promptOverflow: true` e pede decisao ao usuario.

## Hipoteses nao verificaveis no review Codex (Fase 2)

Ao processar os Ajustes Obrigatorios retornados pelo Codex na Fase 2, o orquestrador identifica itens que usam linguagem como "hipotese nao verificavel sem inspecionar o repositorio", "nao confirmado sem ler o codigo", "assume sem evidencia" ou similar.

Para cada item desse tipo, o orquestrador **nao escreve `design.md`** antes de:

1. identificar os arquivos relevantes para verificar a hipotese;
2. ler esses arquivos com `Read` ou `Grep`;
3. confirmar ou descartar a hipotese com base no codigo real;
4. registrar a conclusao em `review-entendimento.md` com o arquivo lido, o trecho relevante e a decisao tomada.

Hipoteses nao verificadas travadas como verdade no `design.md` causam cascata de implementacao errada detectada so no review pos-implementacao.

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
node skills/orchestrator-multi-agent-development/scripts/validate-routing.mjs .orchestration/<slug>
rg --line-number --fixed-strings -- 'QUOTA_EXAUSTED' README.md commands skills
rg --line-number --fixed-strings -- 'agyModelSource' README.md commands skills
rg --line-number --fixed-strings -- 'agyParallel' README.md commands skills
```
