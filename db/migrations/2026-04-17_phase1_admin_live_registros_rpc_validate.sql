-- Validacion para la RPC optimizada del panel "En produccion" del admin
-- Ejecutar despues de aplicar:
--   db/migrations/2026-04-17_phase1_admin_live_registros_rpc.sql

select
  to_regprocedure('public.get_admin_live_registros(text,date,date,bigint,uuid,integer)') as get_admin_live_registros;

select
  *
from public.get_admin_live_registros('today', null, null, null, null, 20)
order by hora_inicio desc nulls last, id desc
limit 20;
