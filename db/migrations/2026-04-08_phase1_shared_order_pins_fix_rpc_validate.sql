-- Validacion del fix para set_orden_anclada
-- Ejecutar despues de aplicar:
--   db/migrations/2026-04-08_phase1_shared_order_pins_fix_rpc.sql

select
  to_regprocedure('public.set_orden_anclada(bigint,boolean)') as set_orden_anclada;

-- Prueba no destructiva: muestra anclados actuales
select
  *
from public.get_ordenes_ancladas()
order by pinned_at asc, orden_id asc
limit 50;
