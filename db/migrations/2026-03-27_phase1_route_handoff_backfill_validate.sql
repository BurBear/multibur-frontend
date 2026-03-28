-- Validacion posterior al backfill de handoff de ruta
-- Ejecutar despues de:
--   db/migrations/2026-03-27_phase1_route_handoff_backfill.sql

-- 1) Modulo actual por orden en ACABADOS macro
select
  o.id as orden_id,
  o.numero_orden_fisica,
  d.modulo_ruta_actual,
  nxt.proceso_codigo as siguiente_proceso,
  nxt.modulo_responsable as siguiente_modulo,
  nxt.estado as siguiente_estado,
  nxt.secuencia_efectiva
from public.ordenes o
join public.detalles_orden d on d.orden_id = o.id
left join lateral public.get_orden_proximo_proceso_ruta(o.id) nxt on true
where upper(o.estado::text) = 'ACABADOS'
order by o.id desc;

-- 2) Cuantas ordenes quedaron visibles para cada modulo
select
  d.modulo_ruta_actual,
  count(*)::integer as total_ordenes
from public.ordenes o
join public.detalles_orden d on d.orden_id = o.id
where upper(o.estado::text) = 'ACABADOS'
group by d.modulo_ruta_actual
order by d.modulo_ruta_actual;

-- 3) Ordenes con ruta vacia o sin definir
select
  o.id as orden_id,
  o.numero_orden_fisica,
  d.modulo_ruta_actual,
  d.ruta_procesos
from public.ordenes o
join public.detalles_orden d on d.orden_id = o.id
where upper(o.estado::text) = 'ACABADOS'
  and coalesce(jsonb_array_length(coalesce(d.ruta_procesos, '[]'::jsonb)), 0) = 0
order by o.id desc;
