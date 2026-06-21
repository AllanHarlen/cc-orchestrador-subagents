# Changelog

## [3.2.0] — 2026-06-21

### Design system (Open Design) como contrato visual de ponta a ponta

Fecha a lacuna que deixava o front-end com "cara de template": o orquestrador recebia o design system do Pensador mas **não passava os artefatos de design ao AGY** e revisava só bugs de runtime, nunca a fidelidade visual.

- **Prompt de implementação front-end (`references/subagent-prompts.md`):** novo bloco **Design System (Open Design)** carregando os caminhos de `tokens.css` (fonte de verdade), `components.html` (fixtures), `design-system.md`/`design.md` (decisões) e `preview/app.html` (alvo visual), com as regras obrigatórias do skills-protocol — consumir `var(--*)`, não inventar tokens, casar estados de `components.html`, accent ≤ 2×/página, sem emoji-ícone, sem sombra se Depth & Elevation = minimal, override sempre documentado.
- **Gate de design no review da Fase 9:** o review front-end passa a verificar consumo de `tokens.css`, accent contido, diff das telas-chave contra `preview/app.html`, atendimento da capability `ui-design-system` (modo Spec) e ausência dos anti-padrões da seção 9 do DESIGN.md. Violação de requisito explícito (token inventado, override sem justificativa, accent flood) é tratada como **BLOQUEANTE**.
- **Roteamento de modelo por fidelidade de design (`SKILL.md`):** task front-end que **implementa design system** nunca usa `gemini-3.5-flash-medium` — mínimo `gemini-3.1-pro-low`, subindo para `gemini-3.1-pro-high` quando a fidelidade visual é crítica (landing, vitrine, hero). Scaffold funcional puro segue a heurística padrão.
- **Regra central nova + handoff:** `SKILL.md` ganha a regra 15 (design system é contrato visual, não decoração); `references/handoff-contract.md` documenta a ingestão do `design-system` (PRD) ou `design.md` + `specs/ui-design-system/spec.md` (Spec/OpenSpec) e dos arquivos verbatim em `packages/ui/design-systems/<id>/`, carregados em toda task front-end.
- **Suporte ao modo Spec/OpenSpec:** quando a demanda veio do Pensador em modo Spec, o orquestrador lê as decisões de design do `design.md` do change e os requisitos da capability delta-spec `ui-design-system`, usando cada cenário como critério de aceite do gate.
- **Checklist mínimo** atualizado com os três itens de design (paths no prompt, modelo coerente, gate aplicado na Fase 9).
