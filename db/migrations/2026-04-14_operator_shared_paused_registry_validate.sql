-- Validacion para trabajos pausados compartidos en operador
-- Ejecutar despues de aplicar:
--   db/migrations/2026-04-14_operator_shared_paused_registry.sql

select
  to_regprocedure('public.get_registros_pausados_disponibles()') as get_registros_pausados_disponibles;

select
  *
from public.get_registros_pausados_disponibles()
order by pausado_en desc nulls last, id desc
limit 50;
