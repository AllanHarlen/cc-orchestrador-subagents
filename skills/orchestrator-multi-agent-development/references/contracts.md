# Contratos API/UI

Para toda task FULLSTACK, **gere o contrato antes** de paralelizar back-end e front-end. Isso evita que o Codex devolva `descricao` enquanto o Gemini espera `description`.

## Onde salvar

```
openspec/changes/<nome>/contracts/<task-id>.md
```

Um arquivo por task FULLSTACK.

## Template

Use `assets/contract-template.md` como base. Estrutura mínima:

```markdown
# Contrato API/UI — <Task ID> — <Título>

## Endpoint
<URL relativa, ex.: /api/reservas>

## Método HTTP
<GET | POST | PUT | PATCH | DELETE>

## Request

### Headers
- Authorization: Bearer <jwt>
- Content-Type: application/json

### Path params
- <nome>: <tipo> — <descrição>

### Query params
- <nome>: <tipo> — <descrição>

### Body
```json
{
  "campo1": "tipo (constraint)",
  "campo2": "tipo"
}
```

## Response

### 200 OK
```json
{
  "id": "uuid",
  "campo1": "valor",
  ...
}
```

### 201 Created
<quando aplicável>

### 4xx
- 400 Bad Request — <quando>
- 401 Unauthorized — <quando>
- 403 Forbidden — <quando>
- 404 Not Found — <quando>
- 409 Conflict — <quando>

### 5xx
- 500 Internal Server Error — não vaza stack trace; UI mostra mensagem genérica

## Estados de loading
- spinner inline na lista após submit;
- skeleton na primeira carga.

## Estados de erro (UI)
- toast de erro com mensagem do back-end (campo `errors[].message`);
- formulário não é resetado, usuário pode corrigir e submeter de novo.

## Estados de empty
- card com texto "Nenhuma reserva encontrada" e CTA "Criar reserva".

## Permissões
- requer claim `reservations:read` para GET;
- requer claim `reservations:write` para POST/PUT/DELETE.

## Validações back-end
- `<campo>`: <regra>;
- ...

## Validações front-end
- `<campo>`: <regra> (deve espelhar back-end para feedback imediato).

## Campos obrigatórios
- <lista>

## Campos opcionais
- <lista>

## Exemplo de payload

### Request
```json
{
  "exemplo": "completo"
}
```

### Response
```json
{
  "exemplo": "completo"
}
```

## Decisões pendentes
- (nenhuma) ou
- <decisão> — bloqueia execução até resolver.
```

## Regras de qualidade do contrato

1. **Nomes de campo decidem aqui.** Não deixe para os subagentes decidirem entre `description` e `descricao`. Escolha agora, alinhe com a convenção do projeto.
2. **Tipos explícitos.** Nada de "string ou número" — escolha.
3. **Status codes exaustivos.** Liste todos os 4xx e 5xx esperados, mesmo os triviais.
4. **Estados de UI obrigatórios.** loading, erro, empty, sucesso. Se a tela não precisa de algum, marque "N/A — <motivo>".
5. **Permissões explícitas.** Citar a claim, role, ou policy.
6. **Validações duplas.** Espelhe back-end e front-end. Se diferem, justifique.
7. **Exemplos de payload completos.** Não trunque.

## Quando o contrato muda no meio da execução

Se um dos subagentes reportar necessidade de mudança (ex.: Codex descobriu que o domínio exige um campo a mais):

1. **NÃO** deixe o agente mudar o contrato unilateralmente.
2. Marque a task como `NEEDS_SYNC` no `monitoring.md`.
3. Avalie a sugestão:
   - válida → atualize o `<task-id>.md`, salve a versão antiga em `<task-id>.previous.md` para auditoria;
   - inválida → rejeite com justificativa e oriente o agente a seguir o contrato original;
4. Notifique **ambos** os agentes da dupla (back-end e front-end) com o contrato atualizado.
5. Marque de volta como `RUNNING`.

## Quando o contrato pode ser implícito (raríssimo)

Tasks FULLSTACK podem dispensar contrato formal quando:

- **for ajuste cosmético** numa tela que consome endpoint estável (ex.: só mudar cor, não mexer em campos);
- **for adicionar campo opcional** em uma estrutura já amplamente conhecida (e ainda assim, vale escrever 5 linhas).

Em todos os outros casos, escreva o contrato. O custo de escrever é minutos. O custo de retrabalhar uma dupla é horas.

## Validação cruzada antes do paralelismo

Antes de delegar back-end e front-end em paralelo, verifique:

- [ ] Endpoint definido;
- [ ] Método HTTP definido;
- [ ] Schema de request fechado;
- [ ] Schema de response fechado;
- [ ] Status codes mapeados;
- [ ] Permissões/claims definidas;
- [ ] Estados de UI cobertos;
- [ ] Validações alinhadas;
- [ ] Exemplo de payload conferido.

Só após esse checklist, delegue.
