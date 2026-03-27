-- ACABADOS V1 - RPCs operativas sobre orden_procesos
-- Objetivo:
--   1) Operar ACABADOS por proceso, no por sesion unica de orden
--   2) Mantener compatibilidad con el flujo actual de produccion
--   3) Permitir multiples procesos activos por usuario en ACABADOS
--   4) No tocar todavia ADMIN legacy, OPERADOR, T+R, inventario ni reportes

begin;

-- ---------------------------------------------------------------------------
-- 1) Recalcular estado macro de la orden en ACABADOS
-- ---------------------------------------------------------------------------
create or replace function public.recalcular_estado_orden_acabados(
  p_orden_id bigint
)
returns table (
  orden_id bigint,
  total_procesos integer,
  pendientes integer,
  en_proceso integer,
  pausados integer,
  finalizados integer,
  cancelados integer,
  nuevo_estado text,
  mensaje text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
  v_estado_actual text;
  v_total integer := 0;
  v_pend integer := 0;
  v_act integer := 0;
  v_pau integer := 0;
  v_fin integer := 0;
  v_can integer := 0;
begin
  if v_user is null then
    raise exception 'Usuario no autenticado.';
  end if;

  if p_orden_id is null or p_orden_id <= 0 then
    raise exception 'orden_id invalido.';
  end if;

  perform pg_advisory_xact_lock(hashtext('acabados_orden:' || p_orden_id::text));

  select o.estado::text
    into v_estado_actual
  from public.ordenes o
  where o.id = p_orden_id
  for update;

  if v_estado_actual is null then
    raise exception 'La orden % no existe.', p_orden_id;
  end if;

  select
    count(*)::integer,
    count(*) filter (where op.estado = 'PENDIENTE')::integer,
    count(*) filter (where op.estado = 'EN_PROCESO')::integer,
    count(*) filter (where op.estado = 'PAUSADO')::integer,
    count(*) filter (where op.estado = 'FINALIZADO')::integer,
    count(*) filter (where op.estado = 'CANCELADO')::integer
  into
    v_total,
    v_pend,
    v_act,
    v_pau,
    v_fin,
    v_can
  from public.orden_procesos op
  where op.orden_id = p_orden_id
    and op.modulo_responsable = 'ACABADOS';

  orden_id := p_orden_id;
  total_procesos := coalesce(v_total, 0);
  pendientes := coalesce(v_pend, 0);
  en_proceso := coalesce(v_act, 0);
  pausados := coalesce(v_pau, 0);
  finalizados := coalesce(v_fin, 0);
  cancelados := coalesce(v_can, 0);

  if total_procesos = 0 then
    nuevo_estado := upper(coalesce(v_estado_actual, ''));
    mensaje := 'La orden no tiene procesos ACABADOS sembrados. No se modifica su estado.';
    return next;
  end if;

  if (pendientes + en_proceso + pausados) = 0 then
    if upper(coalesce(v_estado_actual, '')) <> 'ENTREGADO' then
      update public.ordenes
      set estado = 'TERMINADO'
      where id = p_orden_id
        and upper(estado::text) <> 'ENTREGADO';

      nuevo_estado := 'TERMINADO';
      mensaje := 'Todos los procesos de ACABADOS estan completos. Orden marcada como TERMINADO.';
    else
      nuevo_estado := 'ENTREGADO';
      mensaje := 'Todos los procesos de ACABADOS estan completos, pero la orden ya estaba ENTREGADO.';
    end if;
  else
    if upper(coalesce(v_estado_actual, '')) in ('DISENO', 'PLACAS', 'IMPRESION', 'ACABADOS') then
      update public.ordenes
      set estado = 'ACABADOS'
      where id = p_orden_id
        and upper(estado::text) in ('DISENO', 'PLACAS', 'IMPRESION', 'ACABADOS');

      nuevo_estado := 'ACABADOS';
      mensaje := 'La orden aun tiene procesos ACABADOS pendientes.';
    else
      nuevo_estado := upper(coalesce(v_estado_actual, ''));
      mensaje := 'La orden aun tiene procesos ACABADOS pendientes. No se modifica el estado actual por compatibilidad.';
    end if;
  end if;

  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Iniciar proceso
-- ---------------------------------------------------------------------------
create or replace function public.iniciar_proceso_acabado(
  p_proceso_id bigint
)
returns table (
  proceso_id bigint,
  orden_id bigint,
  proceso_codigo text,
  estado_proceso text,
  nuevo_estado_orden text,
  mensaje text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
  v_orden_id bigint;
  v_proceso_codigo text;
  v_modulo text;
  v_estado text;
  v_estado_orden text;
begin
  if v_user is null then
    raise exception 'Usuario no autenticado.';
  end if;

  if p_proceso_id is null or p_proceso_id <= 0 then
    raise exception 'proceso_id invalido.';
  end if;

  perform pg_advisory_xact_lock(hashtext('acabados_user:' || v_user::text));

  select
    op.orden_id,
    op.proceso_codigo,
    op.modulo_responsable,
    op.estado,
    o.estado::text
  into
    v_orden_id,
    v_proceso_codigo,
    v_modulo,
    v_estado,
    v_estado_orden
  from public.orden_procesos op
  join public.ordenes o on o.id = op.orden_id
  where op.id = p_proceso_id
  for update;

  if v_orden_id is null then
    raise exception 'El proceso % no existe.', p_proceso_id;
  end if;

  if v_modulo <> 'ACABADOS' then
    raise exception 'El proceso % no pertenece al modulo ACABADOS.', p_proceso_id;
  end if;

  if upper(coalesce(v_estado_orden, '')) in ('TERMINADO', 'ENTREGADO') then
    raise exception 'La orden % ya no admite iniciar procesos de ACABADOS.', v_orden_id;
  end if;

  if upper(coalesce(v_estado_orden, '')) <> 'ACABADOS' then
    raise exception 'La orden % no esta en ACABADOS. Estado actual: %.', v_orden_id, v_estado_orden;
  end if;

  if v_estado <> 'PENDIENTE' then
    raise exception 'Solo se puede iniciar un proceso PENDIENTE. Estado actual: %.', v_estado;
  end if;

  update public.orden_procesos
  set
    estado = 'EN_PROCESO',
    assigned_user_id = v_user,
    started_at = coalesce(started_at, now()),
    finished_at = null
  where id = p_proceso_id
    and estado = 'PENDIENTE'
  returning id into proceso_id;

  if proceso_id is null then
    raise exception 'El proceso ya no esta disponible para iniciar.';
  end if;

  orden_id := v_orden_id;
  proceso_codigo := v_proceso_codigo;
  estado_proceso := 'EN_PROCESO';
  nuevo_estado_orden := 'ACABADOS';
  mensaje := format('Proceso %s iniciado correctamente.', v_proceso_codigo);
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Pausar proceso
-- ---------------------------------------------------------------------------
create or replace function public.pausar_proceso_acabado(
  p_proceso_id bigint,
  p_observaciones text default null
)
returns table (
  proceso_id bigint,
  orden_id bigint,
  proceso_codigo text,
  estado_proceso text,
  nuevo_estado_orden text,
  mensaje text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
  v_orden_id bigint;
  v_proceso_codigo text;
  v_modulo text;
  v_estado text;
  v_assigned_user uuid;
  v_obs text := nullif(trim(coalesce(p_observaciones, '')), '');
begin
  if v_user is null then
    raise exception 'Usuario no autenticado.';
  end if;

  if p_proceso_id is null or p_proceso_id <= 0 then
    raise exception 'proceso_id invalido.';
  end if;

  perform pg_advisory_xact_lock(hashtext('acabados_user:' || v_user::text));

  select
    op.orden_id,
    op.proceso_codigo,
    op.modulo_responsable,
    op.estado,
    op.assigned_user_id
  into
    v_orden_id,
    v_proceso_codigo,
    v_modulo,
    v_estado,
    v_assigned_user
  from public.orden_procesos op
  where op.id = p_proceso_id
  for update;

  if v_orden_id is null then
    raise exception 'El proceso % no existe.', p_proceso_id;
  end if;

  if v_modulo <> 'ACABADOS' then
    raise exception 'El proceso % no pertenece al modulo ACABADOS.', p_proceso_id;
  end if;

  if v_estado <> 'EN_PROCESO' then
    raise exception 'Solo se puede pausar un proceso EN_PROCESO. Estado actual: %.', v_estado;
  end if;

  if v_assigned_user is distinct from v_user then
    raise exception 'Solo el usuario que tiene el proceso activo puede pausarlo.';
  end if;

  update public.orden_procesos
  set
    estado = 'PAUSADO',
    observaciones = case
      when v_obs is null then observaciones
      when nullif(trim(coalesce(observaciones, '')), '') is null then '[PAUSA] ' || v_obs
      else observaciones || E'\n[PAUSA] ' || v_obs
    end
  where id = p_proceso_id
    and estado = 'EN_PROCESO'
    and assigned_user_id = v_user
  returning id into proceso_id;

  if proceso_id is null then
    raise exception 'El proceso ya no estaba disponible para pausa.';
  end if;

  orden_id := v_orden_id;
  proceso_codigo := v_proceso_codigo;
  estado_proceso := 'PAUSADO';
  nuevo_estado_orden := 'ACABADOS';
  mensaje := format('Proceso %s pausado correctamente.', v_proceso_codigo);
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Retomar proceso
-- ---------------------------------------------------------------------------
create or replace function public.retomar_proceso_acabado(
  p_proceso_id bigint
)
returns table (
  proceso_id bigint,
  orden_id bigint,
  proceso_codigo text,
  estado_proceso text,
  nuevo_estado_orden text,
  mensaje text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
  v_orden_id bigint;
  v_proceso_codigo text;
  v_modulo text;
  v_estado text;
  v_estado_orden text;
begin
  if v_user is null then
    raise exception 'Usuario no autenticado.';
  end if;

  if p_proceso_id is null or p_proceso_id <= 0 then
    raise exception 'proceso_id invalido.';
  end if;

  perform pg_advisory_xact_lock(hashtext('acabados_user:' || v_user::text));

  select
    op.orden_id,
    op.proceso_codigo,
    op.modulo_responsable,
    op.estado,
    o.estado::text
  into
    v_orden_id,
    v_proceso_codigo,
    v_modulo,
    v_estado,
    v_estado_orden
  from public.orden_procesos op
  join public.ordenes o on o.id = op.orden_id
  where op.id = p_proceso_id
  for update;

  if v_orden_id is null then
    raise exception 'El proceso % no existe.', p_proceso_id;
  end if;

  if v_modulo <> 'ACABADOS' then
    raise exception 'El proceso % no pertenece al modulo ACABADOS.', p_proceso_id;
  end if;

  if upper(coalesce(v_estado_orden, '')) in ('TERMINADO', 'ENTREGADO') then
    raise exception 'La orden % ya no admite retomar procesos de ACABADOS.', v_orden_id;
  end if;

  if upper(coalesce(v_estado_orden, '')) <> 'ACABADOS' then
    raise exception 'La orden % no esta en ACABADOS. Estado actual: %.', v_orden_id, v_estado_orden;
  end if;

  if v_estado <> 'PAUSADO' then
    raise exception 'Solo se puede retomar un proceso PAUSADO. Estado actual: %.', v_estado;
  end if;

  update public.orden_procesos
  set
    estado = 'EN_PROCESO',
    assigned_user_id = v_user,
    started_at = coalesce(started_at, now()),
    finished_at = null
  where id = p_proceso_id
    and estado = 'PAUSADO'
  returning id into proceso_id;

  if proceso_id is null then
    raise exception 'El proceso ya no estaba disponible para retoma.';
  end if;

  orden_id := v_orden_id;
  proceso_codigo := v_proceso_codigo;
  estado_proceso := 'EN_PROCESO';
  nuevo_estado_orden := 'ACABADOS';
  mensaje := format('Proceso %s retomado correctamente.', v_proceso_codigo);
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Finalizar proceso
-- ---------------------------------------------------------------------------
create or replace function public.finalizar_proceso_acabado(
  p_proceso_id bigint,
  p_observaciones text default null
)
returns table (
  proceso_id bigint,
  orden_id bigint,
  proceso_codigo text,
  estado_proceso text,
  nuevo_estado_orden text,
  mensaje text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
  v_orden_id bigint;
  v_proceso_codigo text;
  v_modulo text;
  v_estado text;
  v_assigned_user uuid;
  v_obs text := nullif(trim(coalesce(p_observaciones, '')), '');
  v_nuevo_estado_orden text;
  v_msg_recalc text;
begin
  if v_user is null then
    raise exception 'Usuario no autenticado.';
  end if;

  if p_proceso_id is null or p_proceso_id <= 0 then
    raise exception 'proceso_id invalido.';
  end if;

  perform pg_advisory_xact_lock(hashtext('acabados_user:' || v_user::text));

  select
    op.orden_id,
    op.proceso_codigo,
    op.modulo_responsable,
    op.estado,
    op.assigned_user_id
  into
    v_orden_id,
    v_proceso_codigo,
    v_modulo,
    v_estado,
    v_assigned_user
  from public.orden_procesos op
  where op.id = p_proceso_id
  for update;

  if v_orden_id is null then
    raise exception 'El proceso % no existe.', p_proceso_id;
  end if;

  if v_modulo <> 'ACABADOS' then
    raise exception 'El proceso % no pertenece al modulo ACABADOS.', p_proceso_id;
  end if;

  if v_estado <> 'EN_PROCESO' then
    raise exception 'Solo se puede finalizar un proceso EN_PROCESO. Estado actual: %.', v_estado;
  end if;

  if v_assigned_user is distinct from v_user then
    raise exception 'Solo el usuario que tiene el proceso activo puede finalizarlo.';
  end if;

  update public.orden_procesos
  set
    estado = 'FINALIZADO',
    finished_at = now(),
    observaciones = case
      when v_obs is null then observaciones
      when nullif(trim(coalesce(observaciones, '')), '') is null then '[CIERRE] ' || v_obs
      else observaciones || E'\n[CIERRE] ' || v_obs
    end
  where id = p_proceso_id
    and estado = 'EN_PROCESO'
    and assigned_user_id = v_user
  returning id into proceso_id;

  if proceso_id is null then
    raise exception 'El proceso ya no estaba disponible para cierre.';
  end if;

  select
    r.nuevo_estado,
    r.mensaje
  into
    v_nuevo_estado_orden,
    v_msg_recalc
  from public.recalcular_estado_orden_acabados(v_orden_id) r;

  orden_id := v_orden_id;
  proceso_codigo := v_proceso_codigo;
  estado_proceso := 'FINALIZADO';
  nuevo_estado_orden := v_nuevo_estado_orden;
  mensaje := format('Proceso %s finalizado. %s', v_proceso_codigo, v_msg_recalc);
  return next;
end;
$$;

grant execute on function public.recalcular_estado_orden_acabados(bigint) to authenticated;
grant execute on function public.iniciar_proceso_acabado(bigint) to authenticated;
grant execute on function public.pausar_proceso_acabado(bigint, text) to authenticated;
grant execute on function public.retomar_proceso_acabado(bigint) to authenticated;
grant execute on function public.finalizar_proceso_acabado(bigint, text) to authenticated;

commit;
