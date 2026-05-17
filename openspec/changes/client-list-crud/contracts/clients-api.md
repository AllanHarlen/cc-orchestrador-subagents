# Contrato API/UI — Clients CRUD

> Válido para T1 (Backend) e T2 (Frontend). Fonte da verdade para ambos os subagentes.

## Base URL

`http://localhost:5000` (desenvolvimento)

---

## Endpoints

### GET /api/clients

**Propósito:** Listar todos os clientes

**Response 200:**
```json
[
  {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "name": "João Silva",
    "email": "joao@example.com",
    "phone": "+55 11 99999-0000",
    "createdAt": "2026-05-17T16:00:00Z"
  }
]
```

Array vazio `[]` quando não há clientes.

---

### GET /api/clients/{id}

**Propósito:** Buscar um cliente por ID

**Path params:**

| Nome | Tipo | Descrição |
|------|------|-----------|
| `id` | `uuid` | ID do cliente |

**Response 200:**
```json
{
  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "name": "João Silva",
  "email": "joao@example.com",
  "phone": "+55 11 99999-0000",
  "createdAt": "2026-05-17T16:00:00Z"
}
```

**Response 404:**
```json
{
  "errors": [
    { "field": "id", "code": "NOT_FOUND", "message": "Cliente não encontrado." }
  ]
}
```

---

### POST /api/clients

**Propósito:** Criar novo cliente

**Headers:**
- `Content-Type: application/json`

**Body:**
```json
{
  "name": "string (obrigatório, 2-100 chars)",
  "email": "string (obrigatório, formato email, único)",
  "phone": "string (opcional, max 20 chars)"
}
```

**Response 201:**
```json
{
  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "name": "João Silva",
  "email": "joao@example.com",
  "phone": "+55 11 99999-0000",
  "createdAt": "2026-05-17T16:00:00Z"
}
```

**Header:** `Location: /api/clients/3fa85f64-5717-4562-b3fc-2c963f66afa6`

**Response 400 (validação):**
```json
{
  "errors": [
    { "field": "name", "code": "REQUIRED", "message": "Nome é obrigatório." },
    { "field": "email", "code": "INVALID_FORMAT", "message": "Email inválido." }
  ]
}
```

**Response 409 (email duplicado):**
```json
{
  "errors": [
    { "field": "email", "code": "DUPLICATE", "message": "Email já cadastrado." }
  ]
}
```

---

### PUT /api/clients/{id}

**Propósito:** Atualizar cliente existente

**Path params:**

| Nome | Tipo | Descrição |
|------|------|-----------|
| `id` | `uuid` | ID do cliente |

**Body:**
```json
{
  "name": "string (obrigatório, 2-100 chars)",
  "email": "string (obrigatório, formato email)",
  "phone": "string (opcional)"
}
```

**Response 200:** (mesmo schema do GET /api/clients/{id})

**Response 404:** (mesmo schema acima)

**Response 400:** (mesmo schema de validação)

---

### DELETE /api/clients/{id}

**Propósito:** Excluir cliente

**Path params:**

| Nome | Tipo | Descrição |
|------|------|-----------|
| `id` | `uuid` | ID do cliente |

**Response 204:** No Content

**Response 404:**
```json
{
  "errors": [
    { "field": "id", "code": "NOT_FOUND", "message": "Cliente não encontrado." }
  ]
}
```

---

## Schema de erro padronizado

```typescript
interface ApiError {
  errors: Array<{
    field: string;
    code: string;
    message: string;
  }>;
}
```

## Campos do modelo Client

| Campo | Tipo TS | Tipo C# | Obrigatório | Regras |
|-------|---------|---------|-------------|--------|
| `id` | `string` (UUID) | `Guid` | sim (gerado) | UUID v4 gerado no servidor |
| `name` | `string` | `string` | sim | 2-100 chars |
| `email` | `string` | `string` | sim | formato email, único |
| `phone` | `string \| undefined` | `string?` | não | max 20 chars |
| `createdAt` | `string` (ISO 8601) | `DateTime` | sim (gerado) | UTC, gerado no servidor |

## Estados de UI

### Loading
- Spinner centralizado ou skeleton da tabela durante fetch

### Erro
- Banner vermelho no topo com mensagem de erro e botão "Tentar novamente"

### Empty
- Mensagem "Nenhum cliente cadastrado." com botão "Adicionar Cliente"

### Sucesso (após create/update/delete)
- Toast verde com mensagem contextual (ex.: "Cliente criado com sucesso.")
- Duração: 3 segundos, auto-dismiss

## Permissões

- Sem autenticação neste demo. Todos os endpoints são públicos.

## Validações back-end

- `name`: obrigatório, minLength 2, maxLength 100
- `email`: obrigatório, formato email válido, único na coleção
- `phone`: opcional, maxLength 20

## Validações front-end (espelham back-end para feedback imediato)

- `name`: obrigatório, minLength 2
- `email`: obrigatório, formato email (regex simples)
- `phone`: opcional, exibir como campo de texto livre

## Decisões pendentes

- Nenhuma. Contrato está completo para iniciar implementação paralela.

## Histórico

| Data | Quem | O quê | Por quê |
|------|------|-------|---------|
| 2026-05-17 | Orquestrador | Criação inicial | Demanda fullstack client-list-crud |
