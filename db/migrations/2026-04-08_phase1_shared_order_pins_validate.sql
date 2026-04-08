-- Validaciones para anclado compartido de ordenes
-- Ejecutar despues de aplicar:
--   db/migrations/2026-04-08_phase1_shared_order_pins.sql

-- 1) Tabla esperada
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'ordenes_ancladas'
order by ordinal_position;

-- 2) RPCs esperadas
select
  to_regprocedure('public.get_ordenes_ancladas()') as get_ordenes_ancladas,
  to_regprocedure('public.set_orden_anclada(bigint,boolean)') as set_orden_anclada;

-- 3) Muestra los anclados actuales
select
  *
from public.get_ordenes_ancladas()
order by pinned_at asc, orden_id asc
limit 50;
