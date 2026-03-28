-- Handoff de ruta - Backfill seguro para ordenes ya existentes en ACABADOS
-- Uso recomendado:
--   1) Ejecutar despues de route_sequence_enable.sql
--   2) Ejecutar despues de route_handoff_enable.sql
--   3) Revisar el preview antes del bloque BEGIN/COMMIT

-- ---------------------------------------------------------------------------
-- PREVIEW: estado actual de ruta para ordenes macro en ACABADOS
-- ---------------------------------------------------------------------------
select
  o.id as orden_id,
  o.numero_orden_fisica,
  d.modulo_ruta_actual,
  jsonb_array_length(coalesce(d.ruta_procesos, '[]'::jsonb))::integer as pasos_ruta,
  count(op.id)::integer as procesos_sembrados,
  count(*) filter (where op.modulo_responsable = 'ACABADOS')::integer as procesos_acabados,
  count(*) filter (where op.modulo_responsable = 'CORTADOR')::integer as procesos_cortador
from public.ordenes o
join public.detalles_orden d on d.orden_id = o.id
left join public.orden_procesos op on op.orden_id = o.id
where upper(o.estado::text) = 'ACABADOS'
group by o.id, o.numero_orden_fisica, d.modulo_ruta_actual, d.ruta_procesos
order by o.id desc;

-- ---------------------------------------------------------------------------
-- BACKFILL: re-siembra la ruta completa y recalcula modulo_ruta_actual
-- ---------------------------------------------------------------------------
begin;

select
  o.id as orden_id,
  o.numero_orden_fisica,
  seed.sembrados,
  seed.total_acabados,
  public.sync_orden_modulo_ruta_actual(o.id, true) as modulo_ruta_actual,
  seed.mensaje
from public.ordenes o
join public.detalles_orden d on d.orden_id = o.id
cross join lateral public.ensure_orden_procesos_acabados(o.id) seed
where upper(o.estado::text) = 'ACABADOS'
order by o.id;

commit;
