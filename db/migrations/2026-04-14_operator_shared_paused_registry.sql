-- Exponer trabajos pausados disponibles para cualquier operador autenticado
-- sin depender de lectura directa sobre registro_produccion.

create or replace function public.get_registros_pausados_disponibles()
returns table (
  id bigint,
  orden_id bigint,
  user_id uuid,
  maquina_id bigint,
  orden_juego_id bigint,
  juego_num integer,
  cara_impresion text,
  flujo_trabajo_id uuid,
  motivo_pausa text,
  obs_pausa text,
  hora_inicio timestamptz,
  pausado_en timestamptz,
  hora_fin timestamptz,
  estado_registro text
)
language sql
security definer
set search_path = public
as $$
  select
    rp.id,
    rp.orden_id,
    rp.user_id,
    rp.maquina_id,
    rp.orden_juego_id,
    rp.juego_num,
    rp.cara_impresion,
    rp.flujo_trabajo_id,
    rp.motivo_pausa,
    rp.obs_pausa,
    rp.hora_inicio,
    rp.pausado_en,
    rp.hora_fin,
    rp.estado_registro
  from public.registro_produccion rp
  where rp.estado_registro = 'PAUSADO'
    and rp.hora_fin is not null
    and not exists (
      select 1
      from public.registro_produccion child
      where child.retoma_de_registro_id = rp.id
    )
  order by rp.pausado_en desc nulls last, rp.id desc
$$;

grant execute on function public.get_registros_pausados_disponibles() to authenticated;
