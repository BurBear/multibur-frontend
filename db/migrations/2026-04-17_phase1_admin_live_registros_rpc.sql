-- RPC optimizada para el panel lateral "En produccion" del admin
-- Objetivo:
--   - Evitar multiples consultas desde frontend por registros, ordenes, perfiles y maquinas
--   - Exponer una sola fuente enriquecida para el monitoreo en vivo

create or replace function public.get_admin_live_registros(
  p_preset text default 'today',
  p_from_date date default null,
  p_to_date date default null,
  p_orden_id bigint default null,
  p_user_id uuid default null,
  p_limit integer default 300
)
returns table (
  id bigint,
  orden_id bigint,
  user_id uuid,
  maquina_id bigint,
  hora_inicio timestamptz,
  hora_fin timestamptz,
  cantidad_buena integer,
  cantidad_mala integer,
  orden_juego_id bigint,
  juego_num integer,
  cara_impresion text,
  numero_orden_fisica text,
  cliente_nombre text,
  cliente_tipo text,
  descripcion_trabajo text,
  maquina_nombre text,
  operador_nombre text
)
language sql
security definer
set search_path = public
as $$
  with peru_now as (
    select timezone('America/Lima', now()) as now_pe
  ),
  bounds as (
    select
      case
        when lower(trim(coalesce(p_preset, ''))) = 'today'
          then (date_trunc('day', now_pe) at time zone 'America/Lima')
        when lower(trim(coalesce(p_preset, ''))) = 'yesterday'
          then ((date_trunc('day', now_pe) - interval '1 day') at time zone 'America/Lima')
        when lower(trim(coalesce(p_preset, ''))) = 'custom' and p_from_date is not null
          then (p_from_date::timestamp at time zone 'America/Lima')
        else null::timestamptz
      end as start_at,
      case
        when lower(trim(coalesce(p_preset, ''))) = 'today'
          then ((date_trunc('day', now_pe) + interval '1 day') at time zone 'America/Lima')
        when lower(trim(coalesce(p_preset, ''))) = 'yesterday'
          then (date_trunc('day', now_pe) at time zone 'America/Lima')
        when lower(trim(coalesce(p_preset, ''))) = 'custom' and coalesce(p_to_date, p_from_date) is not null
          then ((coalesce(p_to_date, p_from_date) + 1)::timestamp at time zone 'America/Lima')
        else null::timestamptz
      end as end_at
    from peru_now
  )
  select
    rp.id,
    rp.orden_id,
    rp.user_id,
    rp.maquina_id,
    rp.hora_inicio,
    rp.hora_fin,
    rp.cantidad_buena,
    rp.cantidad_mala,
    rp.orden_juego_id,
    rp.juego_num,
    rp.cara_impresion,
    coalesce(o.numero_orden_fisica, concat('#', rp.orden_id::text)) as numero_orden_fisica,
    coalesce(c.nombre, '-') as cliente_nombre,
    c.tipo_cliente as cliente_tipo,
    coalesce(o.descripcion_trabajo, '-') as descripcion_trabajo,
    coalesce(m.nombre, '-') as maquina_nombre,
    coalesce(nullif(trim(coalesce(p.nombre_completo, '')), ''), nullif(trim(coalesce(p.username, '')), ''), rp.user_id::text) as operador_nombre
  from public.registro_produccion rp
  left join public.ordenes o on o.id = rp.orden_id
  left join public.clientes c on c.id = o.cliente_id
  left join public.maquinas m on m.id = rp.maquina_id
  left join public.profiles p on p.id = rp.user_id
  cross join bounds b
  where (
      case
        when b.start_at is not null and b.end_at is not null
          then ((rp.hora_inicio >= b.start_at and rp.hora_inicio < b.end_at) or rp.hora_fin is null)
        when b.start_at is not null
          then (rp.hora_inicio >= b.start_at or rp.hora_fin is null)
        when b.end_at is not null
          then (rp.hora_inicio < b.end_at or rp.hora_fin is null)
        else true
      end
    )
    and (p_orden_id is null or rp.orden_id = p_orden_id)
    and (p_user_id is null or rp.user_id = p_user_id)
  order by rp.hora_inicio desc
  limit greatest(coalesce(p_limit, 300), 1)
$$;

grant execute on function public.get_admin_live_registros(text,date,date,bigint,uuid,integer) to authenticated;
