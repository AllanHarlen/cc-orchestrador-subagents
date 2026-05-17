# Design — client-list-crud

## Arquitetura

### Backend (C# .NET 8)

```
ClientsApi/
├── Program.cs                     # Configuração DI, CORS, Swagger
├── Models/
│   └── Client.cs                  # Record ou class com propriedades
├── DTOs/
│   ├── CreateClientRequest.cs
│   ├── UpdateClientRequest.cs
│   └── ClientResponse.cs
├── Services/
│   ├── IClientService.cs
│   └── ClientService.cs           # Lógica + ConcurrentDictionary
├── Controllers/
│   └── ClientsController.cs       # Endpoints REST
└── Middleware/
    └── ErrorHandlingMiddleware.cs  # Tratamento global de erros
```

### Frontend (React + TypeScript)

```
client-app/
├── src/
│   ├── types/
│   │   └── client.ts              # Interface Client, CreateClientDto, etc.
│   ├── api/
│   │   └── clientsApi.ts          # Funções fetch wrapper
│   ├── hooks/
│   │   └── useClients.ts          # Hook customizado com CRUD + estado
│   ├── components/
│   │   ├── ClientList.tsx         # Tabela principal
│   │   ├── ClientForm.tsx         # Formulário criar/editar (modal)
│   │   ├── DeleteConfirm.tsx      # Modal de confirmação de exclusão
│   │   └── ClientRow.tsx          # Linha da tabela (opcional)
│   └── App.tsx                    # Composição
```

## Fluxo de dados

1. `App.tsx` renderiza `ClientList` com hook `useClients`
2. `useClients` expõe: `clients`, `loading`, `error`, `createClient`, `updateClient`, `deleteClient`, `refetch`
3. `ClientList` usa `useClients` para renderizar tabela + botões de ação
4. Criar/editar abre `ClientForm` (modal) que chama `createClient` ou `updateClient`
5. Deletar abre `DeleteConfirm` que chama `deleteClient`

## Modelo de dados

### Client (backend)

```csharp
public record Client(
    Guid Id,
    string Name,
    string Email,
    string? Phone,
    DateTime CreatedAt
);
```

### Client (frontend TypeScript)

```typescript
export interface Client {
  id: string;
  name: string;
  email: string;
  phone?: string;
  createdAt: string;
}

export interface CreateClientRequest {
  name: string;
  email: string;
  phone?: string;
}

export interface UpdateClientRequest {
  name: string;
  email: string;
  phone?: string;
}
```

## Endpoints

| Método | URL | Corpo | Resposta |
|--------|-----|-------|----------|
| GET | /api/clients | — | 200: Client[] |
| GET | /api/clients/{id} | — | 200: Client / 404 |
| POST | /api/clients | CreateClientRequest | 201: Client |
| PUT | /api/clients/{id} | UpdateClientRequest | 200: Client / 404 |
| DELETE | /api/clients/{id} | — | 204 / 404 |

## CORS

Permitir: `http://localhost:3000`, `http://localhost:5173`
Métodos: GET, POST, PUT, DELETE, OPTIONS
Headers: Content-Type, Accept
