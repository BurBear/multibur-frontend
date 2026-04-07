-- Cantidades de impresion seguras para ACABADOS / CORTADOR
-- Objetivo:
--   - Exponer buena/mala por orden sin depender de lectura directa a registro_produccion
--   - Para T+R / TIRA-RETIRA devolver tambien detalle por juego/par

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
  tr_detail as (
    select
      v.orden_id,
      sum(coalesce(v.buena_final_par, 0))::integer as buena_total,
      sum(coalesce(v.mala_final_par, 0))::integer as mala_total,
      jsonb_agg(
        jsonb_build_object(
          'juego_num', v.juego_num,
          'nombre_tira', v.nombre_tira,
          'nombre_retira', v.nombre_retira,
          'buena_tira', coalesce(v.buena_tira, 0),
          'buena_retira', coalesce(v.buena_retira, 0),
          'mala_tira', coalesce(v.mala_tira, 0),
          'mala_retira', coalesce(v.mala_retira, 0),
          'buena_final_par', coalesce(v.buena_final_par, 0),
          'mala_final_par', coalesce(v.mala_final_par, 0),
          'cantidad_objetivo_par', coalesce(v.cantidad_objetivo_par, 0)
        )
        order by v.juego_num
      ) as detalle
    from public.v_orden_juegos_tr_consolidado v
    where v.orden_id = any(coalesce(p_order_ids, array[]::bigint[]))
    group by v.orden_id
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
  left join tr_detail tr on tr.orden_id = t.orden_id
  order by t.orden_id;
$$;

grant execute on function public.get_orden_impresion_totales(bigint[]) to authenticated;
