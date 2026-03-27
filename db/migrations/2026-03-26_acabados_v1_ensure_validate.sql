-- ACABADOS V1 - Validaciones posteriores al seed/backfill
-- Requiere:
--   1) 2026-03-26_acabados_v1_ensure_seed.sql
--   2) Haber ejecutado el backfill si existen ordenes actuales en ACABADOS

-- 1) Funcion esperada
select
  to_regprocedure('public.ensure_orden_procesos_acabados(bigint)') as ensure_rpc;

-- 2) Cuantas ordenes hay hoy en ACABADOS
select
  count(*)::integer as ordenes_en_acabados
from public.ordenes
where upper(estado::text) = 'ACABADOS';

-- 3) Cuantas de esas ordenes ya tienen al menos un proceso ACABADOS sembrado
select
  count(distinct op.orden_id)::integer as ordenes_acabados_con_procesos
from public.orden_procesos op
where op.modulo_responsable = 'ACABADOS'
  and op.orden_id in (
    select o.id
    from public.ordenes o
    where upper(o.estado::text) = 'ACABADOS'
  );

-- 4) Ordenes en ACABADOS que quedaron sin procesos sembrados
select
  o.id as orden_id,
  o.numero_orden_fisica
from public.ordenes o
left join lateral (
  select count(*)::integer as total
  from public.orden_procesos op
  where op.orden_id = o.id
    and op.modulo_responsable = 'ACABADOS'
) p on true
where upper(o.estado::text) = 'ACABADOS'
  and coalesce(p.total, 0) = 0
order by o.id desc;

-- 5) Verifica duplicados por la clave natural de siembra
select
  op.orden_id,
  op.proceso_codigo,
  op.secuencia,
  count(*)::integer as total
from public.orden_procesos op
where op.modulo_responsable = 'ACABADOS'
group by op.orden_id, op.proceso_codigo, op.secuencia
having count(*) > 1
order by op.orden_id, op.proceso_codigo, op.secuencia;

-- 6) Muestra una muestra de procesos ACABADOS sembrados
select
  op.id,
  op.orden_id,
  op.proceso_codigo,
  op.estado,
  op.secuencia,
  op.configuracion,
  op.assigned_user_id,
  op.started_at,
  op.finished_at
from public.orden_procesos op
where op.modulo_responsable = 'ACABADOS'
order by op.orden_id desc, op.secuencia asc, op.id asc
limit 50;
