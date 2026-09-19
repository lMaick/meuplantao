# MAI-123 — Discovery: Fluxo Guiado para Cadastrar Local, Pagador e Plantão

**Status:** Proposta de Discovery  
**Data:** 2026-09-19  
**Autor:** Antigravity (worker Orca)  
**Issue:** [MAI-123](https://linear.app/maickagent/issue/MAI-123)

---

## 1. Fluxo Atual — Mapeamento

### 1.1 Rotas e componentes relevantes

| Rota | Componente | Função |
|---|---|---|
| `/dashboard` | `Dashboard` | Painel financeiro + link para `/locais` e `/calendario` |
| `/locais` | `PlacesPage` | CRUD de locais de trabalho (modal bottom-sheet) |
| `/contatos` | `ContactsPage` | CRUD de contatos/pagadores (modal bottom-sheet) |
| `/calendario` | `ShiftCalendar` | Calendário + modal de criação/edição de plantão |
| `/calendario?novo=1` | `ShiftCalendar` (initialOpen=true) | Abre modal de criação imediatamente |
| `/calendario/plantao/:id` | Ficha do plantão | Detalhe + pagamentos |
| `/pagamentos` | Listagem de pagamentos | Recebimentos pendentes |

### 1.2 Entidades e contratos de dados

#### `Place` (local de trabalho)
```typescript
{ id, user_id, nome: string, endereco: string | null }
```
- `nome` é obrigatório; `endereco` é opcional.
- FK composta `(id, user_id)` garante isolamento por usuário.
- Criado via `createPlace()` → `DAL src/lib/places/index.ts`.

#### `Contact` (responsável pelo pagamento)
```typescript
{ id, user_id, nome: string, telefone: string | null, tipo: 'instituicao' | 'pessoa' | null }
```
- `nome` obrigatório; `telefone` e `tipo` opcionais.
- Criado via `createContact()` → `DAL src/lib/contacts/index.ts`.

#### `Shift` (plantão)
```typescript
{
  id, user_id,
  place_id: uuid,          // FK obrigatória → places
  data: date,              // obrigatória
  hora_inicio: time,       // obrigatória
  hora_fim: time,          // obrigatória (≠ hora_inicio)
  valor_previsto: numeric | null,
  status: 'agendado' | 'realizado' | 'cancelado'
}
```
- Salvo via RPC atômica `save_shift_with_obligation`.

#### `Obligation` (obrigação financeira — criada automaticamente ao marcar "realizado")
```typescript
{
  shift_id, valor_devido, data_prevista,
  responsavel_place_id: uuid | null,  // O próprio local
  responsavel_contact_id: uuid | null // Ou um contato
}
```
- **Invariante financeira:** `saldo = valor_devido − Σ(pagamentos registrados)`. Nunca calculado no cliente; derivado da view `obligations_with_balance`.
- Plantão `agendado` pode ter `valor_previsto` nulo (sem obrigação financeira criada).
- Plantão `realizado` exige `valor_previsto`, `data_prevista` e `responsavel_*` (validado em `shift-calendar.tsx:152`).

### 1.3 Passos atuais do primeiro uso

> **Cenário:** usuário sem nenhum cadastro abre o app pela primeira vez.

| Passo | Tela/Ação | Campo(s) | Obrigatório? | Ponto de abandono |
|---|---|---|---|---|
| 1 | Dashboard — card de onboarding | — | — | Alto: sem CTA clara para contatos |
| 2 | Clicar "Cadastrar primeiro local" | — | — | Médio: nav para `/locais` |
| 3 | `/locais` — clicar "+ Novo local" | `nome` (obrig.), `endereco` (opc.) | `nome` | Baixo: 2 campos |
| 4 | Salvar local → voltar ao dashboard | — | — | Médio: usuário precisa navegar manualmente |
| 5 | `/contatos` — clicar "Adicionar" | `nome` (obrig.), `telefone` (opc.), `tipo` | `nome` | Alto: o usuario precisa **saber** que precisa de contato |
| 6 | Salvar contato | — | — | — |
| 7 | Dashboard → clicar "Calendário e novo plantão" | — | — | Médio: rota diferente |
| 8 | `/calendario` — clicar "Novo plantão" | `place_id`, `data`, `hora_inicio`, `hora_fim` | todos | Baixo se local já cadastrado |
| 9 | Definir status como "realizado" | `valor_previsto`, `data_prevista`, `responsavel_tipo`, `responsavel_id` | todos se "realizado" | **Alto: contato pode não existir** |
| 10 | Salvar plantão | — | — | — |

**Total de telas visitadas:** ≥ 4 (`/dashboard`, `/locais`, `/contatos`, `/calendario`)  
**Número de interações estimado:** ≥ 14 cliques/preenchimentos  
**Maior ponto de atrito:** O usuário não sabe que precisa cadastrar contato antes de marcar um plantão como "realizado" — o formulário de plantão apenas mostra a mensagem "Nenhum contato disponível" na dropdown, sem guia de recuperação inline além de um link para `/contatos`.

### 1.4 Evidências do código — pontos de abandono

1. **`shift-calendar.tsx:664–674`** — Quando `places.length === 0`, o formulário de plantão exibe:
   ```
   "Nenhum local cadastrado." + link "/locais"
   ```
   O usuário é expulso para outra rota no meio do fluxo de criação.

2. **`shift-calendar.tsx:786–790`** — A dropdown de `responsavel_id` tipo "contato" lista `contacts[]` carregado em `useEffect`. Se vazio, o campo fica com `<option>Selecione...</option>` sem ação de criar contato inline.

3. **`dashboard.tsx:249–278`** — O card de onboarding só aparece quando `shifts.length === 0 && places.length === 0`, guia apenas para `/locais`, e não menciona a necessidade de cadastrar contatos.

4. **`places-page.tsx:199–207`** — Após cadastrar o primeiro local, há o link "Abra o calendário para cadastrar um plantão" — **não menciona contatos**.

5. **`contacts-page.tsx` header** — Sem nenhuma ligação contextual com plantões: "Cadastre quem cuida dos seus pagamentos para encontrar essa informação quando precisar." A urgência/contexto de uso é opaca.

---

## 2. Análise Comparativa de Alternativas

### Alternativa A — Wizard de Onboarding Multi-Step

**Descrição:** Modal ou página dedicada ativada no primeiro acesso com 3 etapas lineares: (1) Local, (2) Contato/Pagador, (3) Primeiro plantão.

**Prós:**
- Controle total da progressão; impossível pular etapa sem dados mínimos.
- Educação do usuário sobre o modelo conceitual (local → contato → plantão).
- Pode ser descartado ("Explorar sozinho") sem perda de dados.

**Contras:**
- Alta complexidade de implementação (rota/modal dedicado, estado persistido, lógica de retomada se o usuário fechar no meio).
- Aumenta o tempo até o primeiro valor percebido se as etapas forem longas.
- Usuários experientes (que já têm locais/contatos) seriam obrigados a passar pelo wizard ou teriam lógica de skip.
- Duplicação de formulários (local e contato já existem; o wizard teria versões inline).

**Estimativa de esforço:** Alto (2–3 PRs, novo estado de onboarding persistido, testes E2E completos).

---

### Alternativa B — Cadastro Inline dentro do Formulário de Plantão

**Descrição:** Dentro do modal de criação de plantão, ao selecionar o campo "Local" ou "Responsável", se a lista estiver vazia ou o usuário clicar em "+ Criar novo", um sub-formulário inline expande sem trocar de rota.

**Prós:**
- Fluxo ininterrupto: o usuário nunca sai do contexto de criação do plantão.
- Máxima economia de cliques para o primeiro plantão (≈ 8 interações vs. 14 atuais).
- Não quebra o CRUD existente nas páginas dedicadas (`/locais`, `/contatos`).
- Alinhado com o pattern "quick-create" amplamente validado (ex.: Notion, Linear).

**Contras:**
- O modal de plantão já é longo; um sub-formulário pode aumentar a altura e exigir scroll no mobile.
- Precisa de feedback visual claro que o sub-formulário criou a entidade e voltou ao contexto pai.
- Validação de RLS: a criação inline usa o mesmo DAL, sem risco adicional.
- Aumento de complexidade no componente `shift-calendar.tsx` (já com 872 linhas).

**Estimativa de esforço:** Médio (1–2 PRs, modificação do `Form` component, novos testes).

---

### Alternativa C — Quick-Create com Defaults e Reutilização

**Descrição:** O modal de plantão detecta ausência de local/contato e exibe um campo de criação rápida mínima (somente `nome`) que cria a entidade na hora com defaults, sem abrir sub-formulário completo. O usuário pode detalhar depois.

**Prós:**
- Menor atrito possível: 1 campo extra para criar local ou contato.
- Não altera a estrutura visual do modal.
- Cria entidades parciais com dados mínimos; o usuário completa depois.

**Contras:**
- Dados incompletos persistidos (local sem endereço, contato sem telefone/tipo).
- Usuário pode criar locais duplicados por não ver a lista existente.
- Para contatos de pagador, o campo `tipo` (instituição vs. pessoa) tem impacto de categorização; default silencioso pode gerar dados sujos.
- Menor educação sobre o modelo conceitual.

**Estimativa de esforço:** Baixo (1 PR, pequena modificação do `Form`).

---

## 3. Recomendação Principal — Alternativa B (Cadastro Inline)

### 3.1 Justificativa

A **Alternativa B** oferece o melhor equilíbrio entre redução de atrito e qualidade de dados. Evidências do código confirmam que os dois únicos pontos de bloqueio do fluxo atual são:

1. `place_id` obrigatório no plantão → usuário sem local não pode continuar.
2. `responsavel_contact_id` / `responsavel_place_id` obrigatório para plantões "realizados" → sem contato, o campo fica vazio sem saída.

O Wizard (A) resolve o problema mas adiciona overhead de desenvolvimento e força todos os usuários por um funil linear. O Quick-Create (C) é simples demais e gera sujeira nos dados. O Inline (B) é o padrão de "escape hatch" mais amplamente validado em SaaS e é compatível com o DAL existente sem alterar RLS ou migrations.

### 3.2 Wireflow Textual — Fluxo Proposto

```
[Dashboard]
  ├── Card onboarding (shifts=0, places=0) → CTA "Cadastrar primeiro plantão"
  │     └── abre modal /calendario?novo=1
  └── Botão "Novo plantão" (header)
         └── abre modal

[Modal: Novo plantão]
  ┌─────────────────────────────────────────┐
  │  Quando e onde?                         │
  │                                         │
  │  Local  [dropdown: lista de locais]     │
  │         ↓ se vazio OU clique "+"        │
  │  ┌──────────────────────────────────┐   │
  │  │ + Criar novo local               │   │
  │  │   Nome: [________________]       │   │
  │  │   Endereço: [__________] (opc.)  │   │
  │  │   [Salvar local] [Cancelar]      │   │
  │  └──────────────────────────────────┘   │
  │         ↓ após salvar: dropdown pre-    │
  │           selecionada com novo local    │
  │                                         │
  │  Data: [date]                           │
  │  Início: [time]  Fim: [time]            │
  │─────────────────────────────────────────│
  │  Valor e recebimento                    │
  │  Valor (R$): [_______] (opc.)          │
  │                                         │
  │  Status: [Agendado / Realizado]         │
  │   ↓ se "Realizado"                      │
  │  Quando espera receber? [date]          │
  │  Responsável pelo repasse               │
  │    Tipo: [Local / Contato]              │
  │    ↓ se "Contato" e contacts.length=0   │
  │  ┌──────────────────────────────────┐   │
  │  │ + Criar novo contato             │   │
  │  │   Nome: [________________]       │   │
  │  │   Telefone: [__________] (opc.)  │   │
  │  │   Tipo: [Instituição / Pessoa]   │   │
  │  │   [Salvar contato] [Cancelar]    │   │
  │  └──────────────────────────────────┘   │
  │         ↓ após salvar: dropdown pre-    │
  │           selecionada com novo contato  │
  │─────────────────────────────────────────│
  │  [Cancelar]              [Salvar plantão]│
  └─────────────────────────────────────────┘
```

### 3.3 Estados de erro, vazio e loading

| Contexto | Estado | Comportamento proposto |
|---|---|---|
| Modal abre, `places` carregando | Loading | Dropdown com shimmer skeleton (44px height) |
| `places.length === 0` | Vazio | Expand inline "Criar novo local" (não link externo) |
| `contacts.length === 0` ao selecionar "Contato" | Vazio | Expand inline "Criar novo contato" |
| Salvar local inline falha | Erro | Toast vermelho dentro do sub-formulário; campo fica aberto |
| Salvar plantão sem local | Erro | `aria-invalid` no campo Local; mensagem inline |
| Salvar plantão `realizado` sem responsável | Erro | Destaque no campo "Responsável"; mensagem: "Informe quem pagará este plantão." |
| `hora_fim === hora_inicio` | Erro | Validação client-side antes do submit (reflete constraint do DB) |

### 3.4 Comportamento mobile-first

- Modal bottom-sheet (já implementado): `rounded-t-2xl`, `items-end` no mobile.
- Sub-formulários inline expandem **acima** do botão "Salvar plantão" com animação `height: auto` → `fade-in` (180ms, ease-out).
- Touch targets: mínimo 44×44px em todos os botões de ação.
- `prefers-reduced-motion`: animações de expansão substituídas por exibição imediata (`display: block`).
- Scroll do modal: `max-h-[90dvh] overflow-y-auto` já presente; sub-formulário expande dentro.

### 3.5 Navegação de retorno

- O sub-formulário inline tem botão "Cancelar" que fecha o sub-form sem fechar o modal pai.
- Após salvar local/contato inline, foco retorna automaticamente ao campo de origem no modal principal (acessibilidade: `focus()` no `<select>` correspondente).
- O botão ESC fecha apenas o sub-formulário ativo (não o modal pai) quando sub-formulário está aberto.

---

## 4. Três Cenários de Uso

### Cenário 1 — Usuário sem nenhum cadastro

**Contexto:** Médico acaba de criar conta. `places=[]`, `contacts=[]`, `shifts=[]`.

**Fluxo proposto:**
1. Dashboard exibe card de onboarding com CTA "Cadastrar primeiro plantão" (já existe: `dashboard.tsx:269`, mas redireciona para `/locais`).
2. **Alteração proposta:** CTA abre `/calendario?novo=1` diretamente.
3. Modal de plantão detecta `places.length === 0` → expande sub-formulário de local automaticamente.
4. Usuário preenche nome do hospital → salva → local criado → dropdown pré-selecionada.
5. Usuário preenche data, horários.
6. Se quiser registrar como "agendado": salva sem contato. ✅ Invariante preservada (sem `obligation` criada).
7. Se quiser marcar como "realizado": seleciona "Contato" → detecta `contacts.length === 0` → expande sub-formulário de contato inline.
8. Preenche nome do contato → salva → contato criado → dropdown pré-selecionada.
9. Salva plantão via `saveShiftWithObligation`. ✅

**Interações:** ≈ 9–11 (vs. 14+ atuais)  
**Telas visitadas:** 2 (`/dashboard` → `/calendario`)

---

### Cenário 2 — Usuário que já possui local/contato

**Contexto:** Médico com 3 locais e 2 contatos cadastrados abre o modal de novo plantão.

**Fluxo proposto (sem mudança funcional):**
1. Abre modal via "Novo plantão".
2. Dropdown de Local já populada → seleciona hospital.
3. Preenche data, horários, valor.
4. Status "realizado" → dropdown de Responsável já populada → seleciona contato.
5. Salva. ✅

**Diferença vs. atual:** Nenhuma regressão; a lógica inline apenas ativa quando a lista está vazia ou o usuário clica em "+".

---

### Cenário 3 — Usuário cadastra plantão sem responsável conhecido

**Contexto:** Médico fez plantão, mas ainda não sabe quem vai pagar (escala de UTI com gestão terceirizada).

**Fluxo proposto:**
1. Abre modal de plantão.
2. Marca status como "agendado" (padrão).
3. Preenche local, data, horários, valor previsto (opcional).
4. **Não precisa preencher responsável.** Salva. ✅
5. `saveShiftWithObligation` com `status=agendado`: nenhuma `obligation` é criada (sem data_prevista, sem responsável).
6. Quando souber o responsável, edita o plantão, marca como "realizado", preenche os dados financeiros.

**Invariante preservada:** `valor_previsto` pode ser `null` para plantões agendados (`shifts/index.ts:5`). A obrigação financeira só é criada via RPC ao marcar "realizado" com dados completos.

---

## 5. Impacto nas Telas Existentes e Riscos

### 5.1 Alterações de impacto

| Arquivo/Componente | Tipo de impacto | Descrição |
|---|---|---|
| `src/components/shifts/shift-calendar.tsx` | Modificação | Adicionar estado + renderização do sub-formulário inline de local e contato |
| `src/components/dashboard/dashboard.tsx` | Modificação | Alterar CTA do card de onboarding de `/locais` para `/calendario?novo=1` |
| `src/lib/places/places-page.tsx` | Nenhuma | CRUD de locais permanece intacto |
| `src/components/contacts/contacts-page.tsx` | Nenhuma | CRUD de contatos permanece intacto |
| `src/lib/places/index.ts` | Nenhuma | DAL reutilizado tal como está |
| `src/lib/contacts/index.ts` | Nenhuma | DAL reutilizado tal como está |
| `supabase/migrations/` | Nenhuma | Sem novas migrations necessárias |

### 5.2 Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|---|---|---|
| Modal de plantão fica longo no mobile | Média | Usar `<details>`/acordeão em vez de expansão inline para sub-forms; ou extrair `<ShiftFormModal>` em componente separado |
| Criação de local duplicado (usuário digita nome diferente de existente) | Baixa | Futura feature: busca/autocomplete de local existente antes de criar novo |
| Contato criado sem `tipo` definido | Baixa | Default `tipo: "instituicao"` já está no `emptyForm` de `ContactsPage` |
| RLS: criação inline faz chamada autenticada | Nula | `createPlace()` e `createContact()` já chamam `getAuthenticatedUserId()` internamente |
| Regressão em testes E2E | Média | Adicionar specs Playwright para o fluxo inline antes de implementar |

---

## 6. MVP Fatiado em PRs/Etapas

> **Atenção:** Nenhuma linha de código de produção é implementada nesta issue (MAI-123). As etapas abaixo são propostas para issues futuras.

### PR 1 — Alterar CTA do onboarding no Dashboard
**Escopo:** Modificar `dashboard.tsx` para redirecionar o botão "Cadastrar primeiro local" para `/calendario?novo=1`.  
**Riscos:** Mínimo.  
**Dependências:** Nenhuma.

### PR 2 — Quick-create de local inline no modal de plantão
**Escopo:** Quando `places.length === 0`, expandir sub-formulário de criação de local dentro do `<Form>` de `shift-calendar.tsx`. Usar `createPlace()` do DAL existente. Após criação, re-popular a lista e pré-selecionar o novo local.  
**Riscos:** Aumento de tamanho do componente. Recomendado extrair `<InlinePlaceForm>`.  
**Dependências:** PR 1 (opcional — pode ser independente).

### PR 3 — Quick-create de contato inline no modal de plantão
**Escopo:** Quando `responsavel_tipo === "contato"` e `contacts.length === 0`, expandir sub-formulário inline de contato com campos `nome`, `telefone` (opc.) e `tipo`. Usar `createContact()`.  
**Riscos:** Similar ao PR 2. Recomendado extrair `<InlineContactForm>`.  
**Dependências:** PR 2.

### PR 4 — Atualizar card de onboarding do Dashboard (2 de 2)
**Escopo:** Após `places.length > 0 && shifts.length === 0`, exibir segundo card de onboarding: "Agora registre seu primeiro plantão" com CTA `/calendario?novo=1`.  
**Riscos:** Mínimo.  
**Dependências:** PR 1.

### PR 5 — Testes E2E Playwright para o fluxo completo
**Escopo:** Cobertura do fluxo zero-to-first-shift nos viewports 390px (iPhone) e 1280px (desktop):
- Criação de local inline a partir do modal de plantão.
- Criação de contato inline a partir do modal de plantão.
- Cadastro de plantão agendado sem responsável.
- Cadastro de plantão realizado com responsável.  
**Dependências:** PRs 1–3.

---

## 7. Métricas de Validação

| Métrica | Definição | Meta |
|---|---|---|
| **Conclusão do primeiro plantão** | % usuários que salvam ≥1 plantão em até 5 minutos do cadastro | > 60% (vs. baseline atual desconhecido) |
| **Tempo até primeiro plantão** | Mediana de segundos entre primeiro login e `save_shift_with_obligation` bem-sucedido | < 3 min |
| **Abandono por etapa** | Taxa de abandono em cada campo do modal de plantão (via Sentry / analytics de formulário) | Redução de ≥ 30% no campo "Local" e "Responsável" |
| **Reuso de local/contato** | % de plantões criados com local/contato pré-existente (vs. criação inline) | Monitorar para detectar padrão de duplicação |
| **Criações inline** | Contagem de locais/contatos criados dentro do modal de plantão | Linha de base para avaliar adoção do quick-create |

---

## 8. Notas Técnicas e Contratos Futuros

> Os itens abaixo são **propostas futuras** — não contratam mudanças de schema ou código sem uma issue dedicada.

- **Possível melhoria de schema (futura):** Adicionar coluna `place_id` na tabela `contacts` para associar um contato a um local específico (ex.: responsável financeiro do Hospital A ≠ Hospital B). Hoje não existe essa relação.
- **Possível busca/autocomplete (futura):** Ao criar local inline, uma busca por nome antes do submit reduziria duplicatas.
- **Possível deep link (futura):** `/calendario?novo=1&place_id=<uuid>` para criar plantão pré-selecionando um local (útil para atalhos do dashboard por local).
- **Valor previsto nulo em agendados:** O campo `valor_previsto` na migration `20260904204000_initial_schema.sql:37` tem `NOT NULL check (valor_previsto >= 0)`, mas o `ShiftInput` em `src/lib/shifts/index.ts:5` aceita `null`. A migration foi corrigida em versão posterior para permitir `null` para plantões agendados — confirmar antes de implementar PR 2.

---

## Referências

- [`src/lib/places/places-page.tsx`](../../src/lib/places/places-page.tsx)
- [`src/components/contacts/contacts-page.tsx`](../../src/components/contacts/contacts-page.tsx)
- [`src/components/shifts/shift-calendar.tsx`](../../src/components/shifts/shift-calendar.tsx)
- [`src/components/dashboard/dashboard.tsx`](../../src/components/dashboard/dashboard.tsx)
- [`src/lib/places/index.ts`](../../src/lib/places/index.ts)
- [`src/lib/contacts/index.ts`](../../src/lib/contacts/index.ts)
- [`src/lib/shifts/index.ts`](../../src/lib/shifts/index.ts)
- [`src/lib/obligations/index.ts`](../../src/lib/obligations/index.ts)
- [`supabase/migrations/20260904204000_initial_schema.sql`](../../supabase/migrations/20260904204000_initial_schema.sql)
- [`supabase/migrations/20260906120000_atomic_shift_obligation.sql`](../../supabase/migrations/20260906120000_atomic_shift_obligation.sql)
