-- Migration: incidencias compatibles con T+R por juego/cara
-- Ajusta pausar/reanudar/devolver para sincronizar orden_juegos_tr.

begin;

create or replace function public.pausar_trabajo(
  p_registro_id bigint,
  p_motivo_incidencia text,
  p_obs_incidencia text default null
)
returns table (
  registro_id bigint,
  orden_id bigint,
  estado_registro text,
  nuevo_estado text,
  mensaje text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_orden_id bigint;
  v_orden_juego_id bigint;
  v_juego_num integer;
  v_cara text;
begin
  if v_user is null then
    raise exception 'Usuario no autenticado.';
  end if;
  if p_registro_id is null or p_registro_id <= 0 then
    raise exception 'registro_id invalido.';
  end if;
  if nullif(trim(coalesce(p_motivo_incidencia, '')), '') is null then
    raise exception 'Motivo de incidencia obligatorio.';
  end if;

  select rp.orden_id, rp.orden_juego_id, rp.juego_num, rp.cara_impresion
    into v_orden_id, v_orden_juego_id, v_juego_num, v_cara
  from public.registro_produccion rp
  where rp.id = p_registro_id
    and rp.user_id = v_user
    and rp.hora_fin is null
  limit 1;

  if v_orden_id is null then
    raise exception 'No existe registro activo para pausar (o no pertenece al usuario actual).';
  end if;

  update public.registro_produccion
  set
    estado_registro = 'PAUSADO',
    hora_pausa = now(),
    motivo_incidencia = trim(p_motivo_incidencia),
    obs_incidencia = nullif(trim(coalesce(p_obs_incidencia, '')), '')
  where id = p_registro_id;

  -- En T+R, pausado sigue reservado para el mismo operador/cara: se mantiene EN_PROCESO.
  if v_orden_juego_id is not null then
    update public.orden_juegos_tr
    set estado = 'EN_PROCESO'
    where id = v_orden_juego_id
      and estado <> 'FINALIZADO';
  end if;

  registro_id := p_registro_id;
  orden_id := v_orden_id;
  estado_registro := 'PAUSADO';
  nuevo_estado := 'IMPRESION';
  mensaje := format('Trabajo pausado para juego %s %s.', coalesce(v_juego_num::text, '-'), coalesce(v_cara, '-'));
  return next;
end;
$$;

create or replace function public.reanudar_trabajo(
  p_registro_id bigint
)
returns table (
  registro_id bigint,
  orden_id bigint,
  estado_registro text,
  nuevo_estado text,
  mensaje text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_orden_id bigint;
  v_orden_juego_id bigint;
  v_juego_num integer;
  v_cara text;
begin
  if v_user is null then
    raise exception 'Usuario no autenticado.';
  end if;
  if p_registro_id is null or p_registro_id <= 0 then
    raise exception 'registro_id invalido.';
  end if;

  select rp.orden_id, rp.orden_juego_id, rp.juego_num, rp.cara_impresion
    into v_orden_id, v_orden_juego_id, v_juego_num, v_cara
  from public.registro_produccion rp
  where rp.id = p_registro_id
    and rp.user_id = v_user
    and rp.hora_fin is null
    and rp.estado_registro = 'PAUSADO'
  limit 1;

  if v_orden_id is null then
    raise exception 'No existe registro pausado para reanudar (o no pertenece al usuario actual).';
  end if;

  update public.registro_produccion
  set
    estado_registro = 'ACTIVO'
  where id = p_registro_id;

  if v_orden_juego_id is not null then
    update public.orden_juegos_tr
    set estado = 'EN_PROCESO'
    where id = v_orden_juego_id
      and estado <> 'FINALIZADO';
  end if;

  update public.ordenes
  set estado = 'IMPRESION'
  where id = v_orden_id
    and upper(estado::text) in ('PLACAS', 'DISENO', 'IMPRESION');

  registro_id := p_registro_id;
  orden_id := v_orden_id;
  estado_registro := 'ACTIVO';
  nuevo_estado := 'IMPRESION';
  mensaje := format('Trabajo reanudado para juego %s %s.', coalesce(v_juego_num::text, '-'), coalesce(v_cara, '-'));
  return next;
end;
$$;

create or replace function public.devolver_trabajo_a_placas(
  p_registro_id bigint,
  p_motivo_incidencia text,
  p_obs_incidencia text default null
)
returns table (
  registro_id bigint,
  orden_id bigint,
  estado_registro text,
  nuevo_estado text,
  mensaje text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_orden_id bigint;
  v_orden_juego_id bigint;
  v_juego_num integer;
  v_cara text;
  v_es_tr boolean;
  v_tiene_otro_activo boolean;
begin
  if v_user is null then
    raise exception 'Usuario no autenticado.';
  end if;
  if p_registro_id is null or p_registro_id <= 0 then
    raise exception 'registro_id invalido.';
  end if;
  if nullif(trim(coalesce(p_motivo_incidencia, '')), '') is null then
    raise exception 'Motivo de incidencia obligatorio.';
  end if;

  select rp.orden_id, rp.orden_juego_id, rp.juego_num, rp.cara_impresion
    into v_orden_id, v_orden_juego_id, v_juego_num, v_cara
  from public.registro_produccion rp
  where rp.id = p_registro_id
    and rp.user_id = v_user
    and rp.hora_fin is null
  limit 1;

  if v_orden_id is null then
    raise exception 'No existe registro activo para devolver (o no pertenece al usuario actual).';
  end if;

  v_es_tr := (v_orden_juego_id is not null) or (v_juego_num is not null);

  update public.registro_produccion
  set
    hora_fin = now(),
    estado_registro = 'DEVUELTO',
    motivo_incidencia = trim(p_motivo_incidencia),
    obs_incidencia = nullif(trim(coalesce(p_obs_incidencia, '')), '')
  where id = p_registro_id;

  -- Libera esa cara/juego para reiniciar desde PLACAS.
  if v_orden_juego_id is not null then
    update public.orden_juegos_tr
    set estado = 'PENDIENTE'
    where id = v_orden_juego_id
      and estado <> 'FINALIZADO';
  end if;

  -- Regla T+R: la devolucion afecta solo al juego/cara elegido, no a toda la orden.
  -- La orden se mantiene en IMPRESION para que los otros juegos sigan fluyendo.
  if v_es_tr then
    update public.ordenes
    set estado = 'IMPRESION'
    where id = v_orden_id;
    nuevo_estado := 'IMPRESION';
  else
    select exists (
      select 1
      from public.registro_produccion rp
      where rp.orden_id = v_orden_id
        and rp.hora_fin is null
    ) into v_tiene_otro_activo;

    if v_tiene_otro_activo then
      update public.ordenes
      set estado = 'IMPRESION'
      where id = v_orden_id;
      nuevo_estado := 'IMPRESION';
    else
      update public.ordenes
      set estado = 'PLACAS'
      where id = v_orden_id
        and upper(estado::text) <> 'ENTREGADO';
      nuevo_estado := 'PLACAS';
    end if;
  end if;

  registro_id := p_registro_id;
  orden_id := v_orden_id;
  estado_registro := 'DEVUELTO';
  mensaje := format('Trabajo devuelto a %s para juego %s %s.', nuevo_estado, coalesce(v_juego_num::text, '-'), coalesce(v_cara, '-'));
  return next;
end;
$$;

grant execute on function public.pausar_trabajo(bigint, text, text) to authenticated;
grant execute on function public.reanudar_trabajo(bigint) to authenticated;
grant execute on function public.devolver_trabajo_a_placas(bigint, text, text) to authenticated;

commit;
