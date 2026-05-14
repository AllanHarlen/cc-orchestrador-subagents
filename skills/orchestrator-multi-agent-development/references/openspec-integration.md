# Integração OpenSpec

O OpenSpec é o backbone de planejamento e rastreamento da mudança. Esta skill assume que o ambiente tem as skills `openspec-*` instaladas. Se não tiver, use o fallback documentado no fim.

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
        ├── review-codex.md                 # output do review do plano (fase 4)
        ├── review-final.md                 # output do review pós-implementação (fase 12)
        ├── specs/                          # deltas de spec gerados nesta mudança
        ├── implementation-report.md        # entregável final (fase 14)
        └── README.md                       # (opcional)
```

## Boas práticas

- **Não pule `/openspec-verify-change`.** Mesmo que tudo pareça pronto, o verify pega referências quebradas em spec.
- **`/openspec-archive-change` é destrutivo no sentido de mover pastas.** Só rode depois de garantir o `implementation-report.md` salvo e o usuário ciente.
- **Pode haver várias mudanças em paralelo no repo.** Não misture artefatos de mudanças diferentes — cada uma em seu diretório.

## Fallback se OpenSpec não estiver disponível

Se as skills `openspec-*` não estiverem no ambiente:

1. Avise o usuário e ofereça instalar via `npx skills add anthropics/skills@openspec-*` (ou o canal apropriado).
2. Se o usuário não puder instalar, crie a estrutura manualmente:

```
mkdir -p openspec/changes/<nome>/specs
mkdir -p openspec/changes/<nome>/contracts
```

3. Preencha proposal/design/tasks "à mão" (você ou o subagente Plan).
4. Pule os comandos `/openspec-*` e use o `implementation-report.md` como entregável.

## Mapeamento de comandos `/opsx:*` mencionados em outras referências

Documentos externos podem usar o naming antigo `/opsx:*`. A correspondência é:

| `/opsx:*` antigo | Skill `openspec-*` atual |
|---|---|
| `/opsx:propose` | `/openspec-new-change` (e edita o proposal direto) |
| `/opsx:new` | `/openspec-new-change` |
| `/opsx:ff` | `/openspec-ff-change` |
| `/opsx:continue` | `/openspec-continue-change` |
| `/opsx:apply` | `/openspec-apply-change` |
| `/opsx:verify` | `/openspec-verify-change` |
| `/opsx:sync` | `/openspec-sync-specs` |
| `/opsx:archive` | `/openspec-archive-change` |

Se o usuário pedir `/opsx:foo`, traduza mentalmente para `/openspec-foo-change` (ou variante apropriada) antes de chamar.
