-- Rollback basico y funcional para Nivel 1 backend de pausa/retoma
--
-- Uso recomendado:
--   Solo si la migracion 2026-03-24_operator_pause_resume_level1_backend.sql
--   acaba de aplicarse y aun no se adopta el nuevo flujo en produccion.
--
-- Alcance:
--   1) Restaura el comportamiento legacy de pausar/reanudar
--   2) Elimina las RPC nuevas de retoma/incidencia
--   3) Reabre registros PAUSADO que fueron cerrados por la migracion
--
-- Este rollback NO elimina columnas, indices ni la tabla nueva, para no perder datos.

begin;

drop function if exists public.registrar_incidencia_produccion(bigint, text, text);
drop function if exists public.retomar_trabajo(bigint, bigint);

-- Reabrir sesiones PAUSADO cerradas por la migracion para volver al flujo legacy.
update public.registro_produccion rp
set
  hora_fin = null,
  hora_pausa = coalesce(hora_pausa, pausado_en),
  motivo_incidencia = coalesce(motivo_incidencia, motivo_pausa),
  obs_incidencia = coalesce(obs_incidencia, obs_pausa)
where estado_registro = 'PAUSADO'
  and hora_fin is not null
  and pausado_en is not null
  and hora_fin = pausado_en
  and not exists (
    select 1
    from public.registro_produccion child
    where child.retoma_de_registro_id = rp.id
  );

update public.orden_juegos_tr j
set estado = 'EN_PROCESO'
where j.estado = 'PAUSADO'
  and exists (
    select 1
    from public.registro_produccion rp
    where rp.orden_juego_id = j.id
      and rp.estado_registro = 'PAUSADO'
      and rp.hora_fin is null
  );

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

grant execute on function public.pausar_trabajo(bigint, text, text) to authenticated;
grant execute on function public.reanudar_trabajo(bigint) to authenticated;

commit;
