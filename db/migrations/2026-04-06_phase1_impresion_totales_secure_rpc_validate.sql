-- Validaciones para cantidades seguras de impresion
-- Ejecutar despues de aplicar:
--   db/migrations/2026-04-06_phase1_impresion_totales_secure_rpc.sql

-- 1) RPC esperada
select
  to_regprocedure('public.get_orden_impresion_totales(bigint[])') as get_orden_impresion_totales;

-- 2) Muestra una muestra de totales por orden
select
  *
from public.get_orden_impresion_totales(
  array(
    select id
    from public.ordenes
    order by id desc
    limit 20
  )
)
order by orden_id desc;

-- 3) Muestra solo ordenes T+R / TIRA-RETIRA con detalle por juego
select
  o.id as orden_id,
  o.numero_orden_fisica,
  det.buena_total,
  det.mala_total,
  det.detalle
from public.ordenes o
join public.detalles_orden d on d.orden_id = o.id
join lateral public.get_orden_impresion_totales(array[o.id]) det on true
where upper(trim(coalesce(d.tipo_impresion::text, ''))) in ('TIRA_RETIRA', 'TIRA+RETIRA')
order by o.id desc
limit 20;
