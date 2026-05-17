# Tasks — client-list-crud

## Task T1 — Backend ASP.NET Core Web API

- **ID:** T1
- **Categoria:** BACKEND_ONLY
- **Dependências:** nenhuma
- **Complexidade:** média
- **Descrição:** Criar projeto C# .NET 8 ASP.NET Core Web API com modelo Client, DTOs, serviço in-memory (ConcurrentDictionary), controller REST com endpoints GET/GET{id}/POST/PUT/DELETE, configuração CORS e tratamento global de erros.
- **Arquivos críticos:**
  - `ClientsApi/Program.cs`
  - `ClientsApi/Models/Client.cs`
  - `ClientsApi/DTOs/*.cs`
  - `ClientsApi/Services/ClientService.cs`
  - `ClientsApi/Controllers/ClientsController.cs`
- **Critérios de aceite:**
  - [ ] GET /api/clients retorna 200 com array (vazio ou com dados)
  - [ ] POST /api/clients cria e retorna 201 com Location header
  - [ ] PUT /api/clients/{id} retorna 200 com dado atualizado
  - [ ] DELETE /api/clients/{id} retorna 204
  - [ ] Campos inválidos retornam 400 com schema de erro padronizado
  - [ ] ID inexistente retorna 404
  - [ ] CORS configurado para localhost:3000 e localhost:5173

## Task T2 — Frontend React + TypeScript

- **ID:** T2
- **Categoria:** FRONTEND_ONLY
- **Dependências:** T1 (precisa do contrato API definido — já está em contracts/T1-T2-contract.md)
- **Complexidade:** média
- **Descrição:** Criar projeto React + TypeScript (Vite) com componente ClientList (tabela), hook useClients, formulário modal criar/editar, modal de confirmação de exclusão, estados loading/erro/empty/sucesso. Comunicar com backend via fetch.
- **Arquivos críticos:**
  - `client-app/src/types/client.ts`
  - `client-app/src/api/clientsApi.ts`
  - `client-app/src/hooks/useClients.ts`
  - `client-app/src/components/ClientList.tsx`
  - `client-app/src/components/ClientForm.tsx`
  - `client-app/src/components/DeleteConfirm.tsx`
  - `client-app/src/App.tsx`
- **Critérios de aceite:**
  - [ ] Tabela renderiza lista de clientes
  - [ ] Estado loading exibe indicador visual
  - [ ] Estado empty exibe mensagem com CTA
  - [ ] Estado erro exibe mensagem com botão de retry
  - [ ] Formulário cria cliente com validação
  - [ ] Formulário edita cliente (pré-preenchido)
  - [ ] Confirmação de exclusão antes de deletar
  - [ ] Feedback visual após cada operação (toast ou inline)

## Paralelização

- T1 e T2 podem rodar **em paralelo** após o contrato API/UI ser definido.
- T1 → Codex (backend)
- T2 → Gemini (frontend)

## Onda 1 (paralela)

| Task | Agente | Status |
|------|--------|--------|
| T1 — Backend | Codex gpt-5.4 medium | PENDING |
| T2 — Frontend | Gemini 3 Flash | PENDING |
