-- MAI-57: the atomic RPC is now the only normal-flow authority for this value.
-- Keep all financial validation/creation triggers; remove only the duplicate
-- post-update synchronization from 20260906100000.
drop trigger if exists shifts_realized_obligation_value on public.shifts;
drop function if exists public.sync_realized_obligation_value();
