# Changelog

## [3.3.0] — 2026-07-13

### Execução contínua até a conclusão integral — fim do corte silencioso de escopo

Corrige um problema real observado em produção: numa demanda com PRD grande (SaaS multi-domínio) vinda da integração Pensador → Orquestrador, o orquestrador extraiu o escopo completo mentalmente, decidiu sozinho reduzir a execução a uma "Onda 1 — Fundação" e só comunicou esse corte de escopo no relatório final, depois de já ter implementado, revisado e fechado a entrega. O usuário nunca teve a chance de reagir a essa redução, porque nunca foi consultado sobre ela.

- **Nova regra central 16 (`SKILL.md`):** "Execução contínua até a conclusão integral do que já foi elaborado — sem corte unilateral de escopo, sem pausa para perguntar sobre fasear." A decisão de escopo já foi tomada rio acima — pelo Pensador (que já conduziu a entrevista de descoberta com o usuário no modo conjunto) ou pelo próprio usuário ao escrever/fornecer o PRD/spec (modo independente). O orquestrador **implementa o que já foi decidido até o fim**, montando todas as ondas necessárias e executando-as sequencialmente sem parar entre elas para confirmar se deve continuar.
- **Nova seção 1.3a (`references/workflow.md`):** "Execução contínua até a conclusão integral" — reforça que as únicas pausas legítimas durante a execução são por bloqueio real (lacuna bloqueante da Fase 1.3, bloqueio de sandbox/quota, reprovação em review na Fase 8/9), nunca por incerteza sobre o tamanho do escopo. Redução de escopo só é aceitável se o próprio usuário pedir isso explicitamente na mensagem que invocou o orquestrador.
- **Checklist mínimo atualizado** com o item correspondente: todas as tasks extraídas e todas as ondas executadas sequencialmente até a conclusão, sem pausa para perguntar sobre fasear.

## [3.2.2] — 2026-06-23

### Coerência do roteamento de modelo por fidelidade de design

- **`gemini-3.5-flash-high` agora está na escada da heurística (GAP #2 do review):** a regra de fidelidade de design fixava o piso em `flash-high`, mas a heurística base (default/complexa/crítica) nunca listava esse tier — o leitor não via onde ele se posicionava. Adicionada a linha `flash-high` (design system não-crítico) à heurística e a escada de capacidade explícita: `flash-low < flash-medium < flash-high < pro-low < pro-high` (allowlist `validate-routing.mjs`).
- **Checklist desambiguado (GAP #3):** o item dizia "`-high` quando crítico" (ambíguo entre `flash-high` e `pro-high`); agora diz `gemini-3.1-pro-high` por extenso, alinhado à regra 15.

## [3.2.1] — 2026-06-23

### Correções do review e2e Open Design

- **`preview/` em vez de `preview/app.html` (GAP 1 — bug real):** dos ~152 systems curados do Open Design, só 1 traz `preview/app.html`; a maioria traz `preview/colors.html`, `preview/spacing.html` e `preview/typography.html`. Todas as referências operacionais (`SKILL.md` regra 15, checklist, `references/subagent-prompts.md` prompt de implementação/regra de comparação/gate de design Fase 9, `references/handoff-contract.md` passo 5) foram atualizadas para apontar para o diretório `preview/` — igual ao que o `od-fetch-system.mjs` já fazia ao copiar o diretório inteiro via `copyTree`.
- **`design-system` role no handoff-contract (GAP 2):** a tabela do Pensador em `references/handoff-contract.md` estava sem a linha `design-system`, quebrando a promessa de documento idêntico entre os três plugins. Adicionada com o diretório verbatim `packages/ui/design-systems/<id>/` explícito no contrato.

## [3.2.0] — 2026-06-21

### Design system (Open Design) como contrato visual de ponta a ponta

Fecha a lacuna que deixava o front-end com "cara de template": o orquestrador recebia o design system do Pensador mas **não passava os artefatos de design ao AGY** e revisava só bugs de runtime, nunca a fidelidade visual.

- **Prompt de implementação front-end (`references/subagent-prompts.md`):** novo bloco **Design System (Open Design)** carregando os caminhos de `tokens.css` (fonte de verdade), `components.html` (fixtures), `design-system.md`/`design.md` (decisões) e `preview/app.html` (alvo visual), com as regras obrigatórias do skills-protocol — consumir `var(--*)`, não inventar tokens, casar estados de `components.html`, accent ≤ 2×/página, sem emoji-ícone, sem sombra se Depth & Elevation = minimal, override sempre documentado.
- **Gate de design no review da Fase 9:** o review front-end passa a verificar consumo de `tokens.css`, accent contido, diff das telas-chave contra `preview/app.html`, atendimento da capability `ui-design-system` (modo Spec) e ausência dos anti-padrões da seção 9 do DESIGN.md. Violação de requisito explícito (token inventado, override sem justificativa, accent flood) é tratada como **BLOQUEANTE**.
- **Roteamento de modelo por fidelidade de design (`SKILL.md`):** task front-end que **implementa design system** nunca usa `gemini-3.5-flash-medium` — mínimo `gemini-3.1-pro-low`, subindo para `gemini-3.1-pro-high` quando a fidelidade visual é crítica (landing, vitrine, hero). Scaffold funcional puro segue a heurística padrão.
- **Regra central nova + handoff:** `SKILL.md` ganha a regra 15 (design system é contrato visual, não decoração); `references/handoff-contract.md` documenta a ingestão do `design-system` (PRD) ou `design.md` + `specs/ui-design-system/spec.md` (Spec/OpenSpec) e dos arquivos verbatim em `packages/ui/design-systems/<id>/`, carregados em toda task front-end.
- **Suporte ao modo Spec/OpenSpec:** quando a demanda veio do Pensador em modo Spec, o orquestrador lê as decisões de design do `design.md` do change e os requisitos da capability delta-spec `ui-design-system`, usando cada cenário como critério de aceite do gate.
- **Checklist mínimo** atualizado com os três itens de design (paths no prompt, modelo coerente, gate aplicado na Fase 9).
