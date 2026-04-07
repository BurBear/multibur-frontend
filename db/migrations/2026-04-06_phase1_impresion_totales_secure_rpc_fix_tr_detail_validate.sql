-- Validaciones para el ajuste del RPC de impresion segura T+R
-- Ejecutar despues de aplicar:
--   db/migrations/2026-04-06_phase1_impresion_totales_secure_rpc_fix_tr_detail.sql

-- 1) RPC esperada
select
  to_regprocedure('public.get_orden_impresion_totales(bigint[])') as get_orden_impresion_totales;

-- 2) Comparar placas configuradas vs detalle devuelto
select
  o.id as orden_id,
  o.numero_orden_fisica,
  count(j.id)::integer as placas_configuradas,
  coalesce(jsonb_array_length(coalesce(det.detalle, '[]'::jsonb)), 0)::integer as placas_devueltas,
  det.buena_total,
  det.mala_total
from public.ordenes o
join public.detalles_orden d on d.orden_id = o.id
left join public.orden_juegos_tr j on j.orden_id = o.id
join lateral public.get_orden_impresion_totales(array[o.id]) det on true
where upper(trim(coalesce(d.tipo_impresion::text, ''))) in ('TIRA_RETIRA', 'TIRA+RETIRA')
group by o.id, o.numero_orden_fisica, det.detalle, det.buena_total, det.mala_total
order by o.id desc
limit 20;

-- 3) Ver detalle plano por placa
select
  o.id as orden_id,
  o.numero_orden_fisica,
  det.detalle
from public.ordenes o
join public.detalles_orden d on d.orden_id = o.id
join lateral public.get_orden_impresion_totales(array[o.id]) det on true
where upper(trim(coalesce(d.tipo_impresion::text, ''))) in ('TIRA_RETIRA', 'TIRA+RETIRA')
order by o.id desc
limit 10;
