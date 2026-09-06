-- Payments are historical records. Physical deletion is not part of the
-- authenticated product contract; logical cancellation preserves history.
drop policy if exists "payments_delete_own" on public.payments;
