# Proposal — client-list-crud

## Contexto

Projeto demo para demonstrar a capacidade do orquestrador multiagêntico de coordenar desenvolvimento full-stack. Não existe codebase anterior — esta é a implementação inicial da feature de lista de clientes.

## Objetivo

Entregar uma aplicação de lista de clientes com CRUD completo: backend C# ASP.NET Core Web API com storage em memória e frontend React + TypeScript com tabela interativa.

## Escopo incluído

- Backend: C# .NET 8 ASP.NET Core Web API
  - Modelo `Client` (Id, Name, Email, Phone, CreatedAt)
  - Endpoints REST: GET /api/clients, GET /api/clients/{id}, POST /api/clients, PUT /api/clients/{id}, DELETE /api/clients/{id}
  - Storage in-memory (List<Client> com lock thread-safe ou ConcurrentDictionary)
  - Validação de campos obrigatórios
  - Configuração CORS para o frontend local
- Frontend: React 18 + TypeScript
  - Componente `ClientList` com tabela de clientes
  - Formulário modal para criar/editar cliente
  - Confirmação de exclusão
  - Estados: loading, erro, empty, sucesso
  - Fetch via `fetch` nativo ou axios (sem biblioteca de estado global)

## Escopo excluído

- Autenticação/autorização (fora do escopo do demo)
- Banco de dados real (in-memory é suficiente para o demo)
- Paginação avançada (será simples lista completa)
- Deploy/CI/CD (apenas implementação local)
- Testes automatizados e2e (fora do escopo)

## Decisões técnicas

- Backend sem banco de dados: `ConcurrentDictionary<Guid, Client>` garante thread safety
- Frontend: hooks funcionais (`useState`, `useEffect`, `useCallback`), sem Redux/Zustand
- Comunicação: REST JSON simples, sem GraphQL ou gRPC
- CORS: permitir localhost:3000 / localhost:5173 (Vite)
