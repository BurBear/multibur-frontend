-- Ajuste del RPC de impresion segura:
-- - Para T+R / TIRA-RETIRA usar cantidades reales por placa
-- - No inferir mala por faltante contra objetivo
-- - No inventar caras/placas faltantes

create or replace function public.get_orden_impresion_totales(
  p_order_ids bigint[]
)
returns table (
  orden_id bigint,
  buena_total integer,
  mala_total integer,
  detalle jsonb
)
language sql
security definer
set search_path = public
as $$
  with target_orders as (
    select
      o.id as orden_id,
      coalesce(d.requiere_juegos_placa, false) as requiere_juegos_placa,
      upper(trim(coalesce(d.tipo_impresion::text, ''))) as tipo_impresion
    from public.ordenes o
    join public.detalles_orden d on d.orden_id = o.id
    where o.id = any(coalesce(p_order_ids, array[]::bigint[]))
  ),
  rp_agg as (
    select
      rp.orden_id,
      sum(coalesce(rp.buena_reportada, rp.cantidad_buena, 0))::integer as buena_total,
      sum(coalesce(rp.mala_reportada, rp.cantidad_mala, 0))::integer as mala_total
    from public.registro_produccion rp
    where rp.orden_id = any(coalesce(p_order_ids, array[]::bigint[]))
    group by rp.orden_id
  ),
  rp_side as (
    select
      rp.orden_id,
      rp.juego_num,
      rp.cara_impresion as cara,
      sum(coalesce(rp.buena_reportada, rp.cantidad_buena, 0))::integer as buena,
      sum(coalesce(rp.mala_reportada, rp.cantidad_mala, 0))::integer as mala
    from public.registro_produccion rp
    where rp.orden_id = any(coalesce(p_order_ids, array[]::bigint[]))
      and rp.juego_num is not null
      and rp.cara_impresion in ('TIRA', 'RETIRA')
    group by rp.orden_id, rp.juego_num, rp.cara_impresion
  ),
  tr_plate_detail as (
    select
      j.orden_id,
      j.juego_num,
      j.cara,
      j.nombre,
      coalesce(rp.buena, 0)::integer as buena,
      coalesce(rp.mala, 0)::integer as mala
    from public.orden_juegos_tr j
    left join rp_side rp
      on rp.orden_id = j.orden_id
     and rp.juego_num = j.juego_num
     and rp.cara = j.cara
    where j.orden_id = any(coalesce(p_order_ids, array[]::bigint[]))
  ),
  tr_agg as (
    select
      p.orden_id,
      sum(coalesce(p.buena, 0))::integer as buena_total,
      sum(coalesce(p.mala, 0))::integer as mala_total,
      jsonb_agg(
        jsonb_build_object(
          'juego_num', p.juego_num,
          'cara', p.cara,
          'nombre', p.nombre,
          'buena', coalesce(p.buena, 0),
          'mala', coalesce(p.mala, 0)
        )
        order by p.juego_num, case when p.cara = 'TIRA' then 1 else 2 end
      ) as detalle
    from tr_plate_detail p
    group by p.orden_id
  )
  select
    t.orden_id,
    case
      when t.requiere_juegos_placa and t.tipo_impresion in ('TIRA_RETIRA', 'TIRA+RETIRA')
        then coalesce(tr.buena_total, 0)
      else coalesce(rp.buena_total, 0)
    end as buena_total,
    case
      when t.requiere_juegos_placa and t.tipo_impresion in ('TIRA_RETIRA', 'TIRA+RETIRA')
        then coalesce(tr.mala_total, 0)
      else coalesce(rp.mala_total, 0)
    end as mala_total,
    case
      when t.requiere_juegos_placa and t.tipo_impresion in ('TIRA_RETIRA', 'TIRA+RETIRA')
        then coalesce(tr.detalle, '[]'::jsonb)
      else null
    end as detalle
  from target_orders t
  left join rp_agg rp on rp.orden_id = t.orden_id
  left join tr_agg tr on tr.orden_id = t.orden_id
  order by t.orden_id;
$$;

grant execute on function public.get_orden_impresion_totales(bigint[]) to authenticated;
