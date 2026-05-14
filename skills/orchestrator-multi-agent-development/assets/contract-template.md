# Contrato API/UI — <TASK ID> — <TÍTULO>

> Salve em `openspec/changes/<nome>/contracts/<task-id>.md`. Um arquivo por task FULLSTACK.

## Endpoint

`<URL relativa — ex.: /api/reservas/{id}>`

## Método HTTP

`<GET | POST | PUT | PATCH | DELETE>`

## Request

### Headers

- `Authorization: Bearer <jwt>`
- `Content-Type: application/json`
- `<outros, se houver>`

### Path params

| Nome | Tipo | Descrição |
|---|---|---|
| `<nome>` | `<tipo>` | `<descrição>` |

### Query params

| Nome | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `<nome>` | `<tipo>` | sim/não | `<descrição>` |

### Body

```json
{
  "<campo1>": "<tipo (constraint)>",
  "<campo2>": "<tipo>"
}
```

## Response

### 200 OK

```json
{
  "id": "<uuid>",
  "<campo1>": "<valor exemplo>"
}
```

### 201 Created

`<aplicável quando POST cria recurso novo. Header Location: /api/.../<id>>`

### 204 No Content

`<aplicável quando DELETE ou PUT sem corpo de retorno>`

### 4xx — Erros do cliente

| Status | Quando |
|---|---|
| 400 Bad Request | validação de payload falhou |
| 401 Unauthorized | token ausente/inválido |
| 403 Forbidden | usuário autenticado sem permissão |
| 404 Not Found | recurso não existe |
| 409 Conflict | violação de regra de negócio (ex.: já reservado) |
| 422 Unprocessable Entity | semântica errada (campos válidos mas estado inválido) |

Schema de erro padronizado:

```json
{
  "errors": [
    { "field": "<campo>", "code": "<CODE>", "message": "<mensagem amigável>" }
  ]
}
```

### 5xx — Erros do servidor

- `500 Internal Server Error` — não vaza stack trace ou dado interno; UI mostra mensagem genérica e botão "tentar de novo".

## Estados de UI

### Loading
- `<descrição: spinner inline / skeleton / progress bar>`

### Erro
- `<descrição: toast / banner / mensagem inline>`

### Empty
- `<descrição: card com CTA / texto explicativo>`

### Sucesso
- `<descrição: toast de confirmação / redirect / atualização inline>`

## Permissões

- requer claim/role: `<claim ou role>`
- regras adicionais: `<ex.: usuário só pode ver suas próprias reservas>`

## Validações back-end

- `<campo>`: `<regra>` (mensagem: `<...>`)
- `<campo>`: `<regra>`

## Validações front-end

- `<campo>`: `<regra>` (espelha back-end para feedback imediato)

## Campos obrigatórios

- `<campo>`
- `<campo>`

## Campos opcionais

- `<campo>` (default: `<valor>`)
- `<campo>`

## Exemplo de payload completo

### Request

```http
POST /api/reservas HTTP/1.1
Authorization: Bearer eyJ...
Content-Type: application/json

{
  "imovelId": "abc-123",
  "checkin": "2026-06-01",
  "checkout": "2026-06-05",
  "hospedes": 2
}
```

### Response 201

```http
HTTP/1.1 201 Created
Location: /api/reservas/r-789
Content-Type: application/json

{
  "id": "r-789",
  "imovelId": "abc-123",
  "checkin": "2026-06-01",
  "checkout": "2026-06-05",
  "hospedes": 2,
  "status": "PENDING",
  "createdAt": "2026-05-14T13:42:11Z"
}
```

## Decisões pendentes

- `<nenhuma>` ou `<decisão>` — bloqueia execução até resolver.

## Histórico de alterações no contrato

| Data | Quem | O quê | Por quê |
|---|---|---|---|
| `<data>` | `<orquestrador>` | `<mudança>` | `<motivo>` |
