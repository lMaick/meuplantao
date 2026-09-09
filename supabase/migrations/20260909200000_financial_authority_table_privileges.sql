-- MAI-65 autoridade nao falsificavel (complemento ADITIVO da 20260909190000).
-- REVOKE de coluna e no-op quando existe GRANT em nivel de tabela (padrao
-- Supabase: UPDATE em tabela para authenticated); por isso
-- has_column_privilege() seguia true e o UPDATE direto das colunas
-- financeiras continuava possivel. Esta migration revoga UPDATE em nivel de
-- TABELA e devolve apenas as colunas nao financeiras ao papel chamador.
-- A RPC save_shift_with_obligation (SECURITY DEFINER) continua escrevendo
-- shifts.valor_previsto e obligations.valor_devido atomicamente; RLS,
-- ownership, locks, piso >= recebido, rollback, concorrencia e a edicao
-- direta de data_prevista/responsavel seguem intactos.
-- Migration ADITIVA: nao altera migrations anteriores; idempotente.

revoke update on public.shifts from anon, authenticated, public;
revoke update on public.obligations from anon, authenticated, public;

grant update (place_id, data, hora_inicio, hora_fim, status, idempotency_key, updated_at)
  on public.shifts to authenticated;

grant update (data_prevista, responsavel_place_id, responsavel_contact_id, updated_at)
  on public.obligations to authenticated;
