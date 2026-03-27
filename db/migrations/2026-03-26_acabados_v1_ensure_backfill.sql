-- ACABADOS V1 - Backfill seguro de procesos para ordenes ya en ACABADOS
-- Uso recomendado:
--   1) Ejecutar primero 2026-03-26_acabados_v1_ensure_seed.sql
--   2) Revisar el preview
--   3) Ejecutar el bloque de backfill dentro de una ventana controlada

-- ---------------------------------------------------------------------------
-- PREVIEW: ordenes actualmente en ACABADOS y cuantos procesos ACABADOS tienen
-- ---------------------------------------------------------------------------
select
  o.id as orden_id,
  o.numero_orden_fisica,
  o.estado::text as estado_actual,
  count(op.id)::integer as procesos_acabados_actuales
from public.ordenes o
left join public.orden_procesos op
  on op.orden_id = o.id
 and op.modulo_responsable = 'ACABADOS'
where upper(o.estado::text) = 'ACABADOS'
group by o.id, o.numero_orden_fisica, o.estado
order by o.id desc;

-- ---------------------------------------------------------------------------
-- BACKFILL IDPOTENTE: aplica ensure a todas las ordenes hoy en ACABADOS
-- ---------------------------------------------------------------------------
begin;

select
  res.orden_id,
  res.sembrados,
  res.total_acabados,
  res.mensaje
from public.ordenes o
cross join lateral public.ensure_orden_procesos_acabados(o.id) res
where upper(o.estado::text) = 'ACABADOS'
order by o.id;

commit;
