# Integração OpenSpec

O OpenSpec é o backbone de planejamento e rastreamento da mudança. Esta skill assume que o ambiente tem as skills `openspec-*` instaladas. Se não tiver, o preflight cancela o workflow orquestrado.

## Skills disponíveis

| Skill | Quando usar |
|---|---|
| `/openspec-onboard` | Primeira vez no projeto — guiar configuração inicial |
| `/openspec-explore` | Modo "thinking partner" para investigar antes de criar a mudança |
| `/openspec-new-change <nome>` | Criar diretório vazio da mudança |
| `/openspec-ff-change <nome>` | Fast-forward: criar todos os artefatos de uma vez |
| `/openspec-continue-change <nome>` | Workflow expandido: criar próximo artefato |
| `/openspec-apply-change <nome>` | Implementar a partir do `tasks.md` |
| `/openspec-verify-change <nome>` | Validar implementação |
| `/openspec-sync-specs <nome>` | Sincronizar deltas com specs principais (sem arquivar) |
| `/openspec-archive-change <nome>` | Arquivar mudança concluída |
| `/openspec-bulk-archive-change <nomes...>` | Arquivar várias mudanças em paralelo |

## Fluxos canônicos

### Fluxo rápido (skill recomenda **expandido**, mas se quiser rápido)

```
/openspec-new-change <nome>
# preencher proposal.md
/openspec-apply-change <nome>
/openspec-sync-specs <nome>
/openspec-archive-change <nome>
```

### Fluxo expandido (recomendado para mudanças relevantes)

```
/openspec-new-change <nome>
/openspec-ff-change <nome>        # cria proposal/design/tasks/specs de uma vez
# orquestrador conduz: planejamento, review, implementação
/openspec-verify-change <nome>
/openspec-archive-change <nome>
```

### Quando rodar `/openspec-sync-specs`

Antes de `/openspec-archive-change`, sempre que a mudança introduzir specs novos ou ajustar specs existentes. O sync move os deltas de `openspec/changes/<nome>/specs/` para `openspec/specs/`.

## Layout esperado

```
openspec/
├── specs/                                  # specs vigentes do projeto
└── changes/
    └── <nome-da-mudanca>/
        ├── proposal.md                     # o que e por quê
        ├── design.md                       # como (arquitetura, decisões)
        ├── tasks.md                        # quebra em tasks
        ├── tasks-classification.md         # gerado pelo orquestrador (fase 6)
        ├── waves.md                        # gerado pelo orquestrador (fase 7)
        ├── contracts/                      # contratos API/UI por task FULLSTACK
        │   └── <task-id>.md
        ├── monitoring.md                   # status das tasks (fase 10)
        ├── workflow-log.md                 # log auditável do workflow (fase 14)
        ├── subagents-context.md            # contexto consolidado dos subagentes (fase 14)
        ├── review-codex.md                 # output do review do plano (fase 4)
        ├── review-final.md                 # output do review pós-implementação (fase 12)
        ├── specs/                          # deltas de spec gerados nesta mudança
        ├── implementation-report.md        # relatório final (fase 14)
        └── README.md                       # (opcional)
```

## Boas práticas

- **Não pule `/openspec-verify-change`.** Mesmo que tudo pareça pronto, o verify pega referências quebradas em spec.
- **`/openspec-archive-change` é destrutivo no sentido de mover pastas.** Só rode depois de garantir `workflow-log.md`, `implementation-report.md` e `subagents-context.md` salvos e o usuário ciente.
- **Pode haver várias mudanças em paralelo no repo.** Não misture artefatos de mudanças diferentes — cada uma em seu diretório.

## Se OpenSpec não estiver disponível

Se as skills `openspec-*` não estiverem no ambiente:

1. Cancele o workflow conforme `references/preflight-check.md`.
2. Mostre a remediação do preflight.
3. Não crie estrutura manual, não pule comandos `/openspec-*` e não continue como Claude direto dentro do `/orchestrator`.
4. Se o usuário quiser trabalhar sem OpenSpec, isso deve acontecer fora deste fluxo orquestrado.

## Naming legado `/opsx:*`

O prefixo `/opsx:*` foi descontinuado. Use sempre `openspec-*`. Se encontrar referências a `/opsx:*` em documentos externos ou histórico de conversa, ignore-as — o nome correto está na tabela de skills acima.
