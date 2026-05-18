-- Validacion para excluir ordenes ENTREGADO/TERMINADO del listado de pausados retomables
-- Ejecutar despues de aplicar:
--   db/migrations/2026-05-18_operator_shared_paused_registry_exclude_delivered.sql

select
  to_regprocedure('public.get_registros_pausados_disponibles()') as get_registros_pausados_disponibles;

select
  rp.*
from public.get_registros_pausados_disponibles() rp
join public.ordenes o
  on o.id = rp.orden_id
where upper(coalesce(o.estado::text, '')) in ('ENTREGADO', 'TERMINADO');
