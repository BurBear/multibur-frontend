begin;

-- ============================================================================
-- Handoff explicito entre ACABADOS y CORTADOR
-- - Agrega propiedad actual del flujo por modulo
-- - Permite transferir la orden entre modulos cuando la secuencia lo exige
-- - Mantiene ACABADOS visible hasta que se confirme el envio a CORTADOR
-- - Prepara tambien el retorno desde CORTADOR hacia ACABADOS
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Propietario actual de la orden dentro de la ruta post-impresion
-- ---------------------------------------------------------------------------
alter table if exists public.detalles_orden
  add column if not exists modulo_ruta_actual text;

alter table if exists public.detalles_orden
  drop constraint if exists detalles_orden_modulo_ruta_actual_check;

alter table if exists public.detalles_orden
  add constraint detalles_orden_modulo_ruta_actual_check
  check (
    modulo_ruta_actual is null
    or upper(trim(modulo_ruta_actual)) in ('ACABADOS', 'CORTADOR')
  );

comment on column public.detalles_orden.modulo_ruta_actual is
'Modulo que actualmente tiene la orden visible para operar su siguiente paso de ruta. Se mueve con handoff explicito entre ACABADOS y CORTADOR.';

-- ---------------------------------------------------------------------------
-- 2) Helpers de siguiente proceso y modulo actual de ruta
-- ---------------------------------------------------------------------------
create or replace function public.get_orden_proximo_proceso_ruta(
  p_orden_id bigint
)
returns table (
  proceso_id bigint,
  orden_id bigint,
  proceso_codigo text,
  modulo_responsable text,
  estado text,
  secuencia_efectiva integer
)
language sql
stable
set search_path = public
as $$
  with abiertos as (
    select
      op.id as proceso_id,
      op.orden_id,
      op.proceso_codigo,
      op.modulo_responsable,
      op.estado,
      public.get_orden_proceso_secuencia_efectiva(
        op.orden_id,
        op.proceso_codigo,
        coalesce(op.secuencia, 1)
      ) as secuencia_efectiva,
      case upper(coalesce(op.estado, ''))
        when 'EN_PROCESO' then 0
        when 'PAUSADO' then 1
        else 2
      end as estado_rank
    from public.orden_procesos op
    where op.orden_id = p_orden_id
      and op.estado not in ('FINALIZADO', 'CANCELADO')
  )
  select
    a.proceso_id,
    a.orden_id,
    a.proceso_codigo,
    a.modulo_responsable,
    a.estado,
    a.secuencia_efectiva
  from abiertos a
  order by a.secuencia_efectiva asc, a.estado_rank asc, a.proceso_id asc
  limit 1;
$$;

create or replace function public.get_orden_modulo_ruta_actual(
  p_orden_id bigint
)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    (
      select upper(trim(d.modulo_ruta_actual))
      from public.detalles_orden d
      where d.orden_id = p_orden_id
        and upper(trim(coalesce(d.modulo_ruta_actual, ''))) in ('ACABADOS', 'CORTADOR')
      limit 1
    ),
    (
      select upper(coalesce(r.modulo_responsable, ''))
      from public.get_orden_proximo_proceso_ruta(p_orden_id) r
      limit 1
    )
  );
$$;

create or replace function public.sync_orden_modulo_ruta_actual(
  p_orden_id bigint,
  p_force boolean default false
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actual text;
  v_next text;
begin
  select upper(trim(coalesce(d.modulo_ruta_actual, '')))
    into v_actual
  from public.detalles_orden d
  where d.orden_id = p_orden_id
  limit 1;

  if not p_force and v_actual in ('ACABADOS', 'CORTADOR') then
    return v_actual;
  end if;

  select upper(coalesce(r.modulo_responsable, ''))
    into v_next
  from public.get_orden_proximo_proceso_ruta(p_orden_id) r
  limit 1;

  if v_next not in ('ACABADOS', 'CORTADOR') then
    v_next := null;
  end if;

  update public.detalles_orden
  set modulo_ruta_actual = v_next
  where orden_id = p_orden_id;

  return v_next;
end;
$$;

grant execute on function public.get_orden_proximo_proceso_ruta(bigint) to authenticated;
grant execute on function public.get_orden_modulo_ruta_actual(bigint) to authenticated;
grant execute on function public.sync_orden_modulo_ruta_actual(bigint, boolean) to authenticated;

do $$
declare
  r record;
begin
  for r in
    select d.orden_id
    from public.detalles_orden d
  loop
    perform public.sync_orden_modulo_ruta_actual(r.orden_id, true);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Recalculo macro considerando toda la ruta, no solo ACABADOS
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
  where op.orden_id = p_orden_id;

  orden_id := p_orden_id;
  total_procesos := coalesce(v_total, 0);
  pendientes := coalesce(v_pend, 0);
  en_proceso := coalesce(v_act, 0);
  pausados := coalesce(v_pau, 0);
  finalizados := coalesce(v_fin, 0);
  cancelados := coalesce(v_can, 0);

  if total_procesos = 0 then
    nuevo_estado := upper(coalesce(v_estado_actual, ''));
    mensaje := 'La orden no tiene procesos sembrados en su ruta. No se modifica su estado.';
    return next;
  end if;

  if (pendientes + en_proceso + pausados) = 0 then
    perform public.sync_orden_modulo_ruta_actual(p_orden_id, true);

    if upper(coalesce(v_estado_actual, '')) <> 'ENTREGADO' then
      update public.ordenes
      set estado = 'TERMINADO'
      where id = p_orden_id
        and upper(estado::text) <> 'ENTREGADO';

      nuevo_estado := 'TERMINADO';
      mensaje := 'Todos los procesos de la ruta estan completos. Orden marcada como TERMINADO.';
    else
      nuevo_estado := 'ENTREGADO';
      mensaje := 'Todos los procesos de la ruta estan completos, pero la orden ya estaba ENTREGADO.';
    end if;
  else
    if upper(coalesce(v_estado_actual, '')) in ('DISENO', 'PLACAS', 'IMPRESION', 'ACABADOS') then
      update public.ordenes
      set estado = 'ACABADOS'
      where id = p_orden_id
        and upper(estado::text) in ('DISENO', 'PLACAS', 'IMPRESION', 'ACABADOS');

      nuevo_estado := 'ACABADOS';
      mensaje := 'La orden aun tiene procesos pendientes dentro de la ruta post-impresion.';
    else
      nuevo_estado := upper(coalesce(v_estado_actual, ''));
      mensaje := 'La orden aun tiene procesos pendientes en su ruta. No se modifica el estado actual por compatibilidad.';
    end if;
  end if;

  return next;
end;
$$;

grant execute on function public.recalcular_estado_orden_acabados(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Transferencia explicita entre modulos de la ruta
-- ---------------------------------------------------------------------------
create or replace function public.transferir_orden_ruta(
  p_orden_id bigint,
  p_modulo_destino text
)
returns table (
  orden_id bigint,
  modulo_actual text,
  modulo_destino text,
  proceso_id_siguiente bigint,
  proceso_codigo_siguiente text,
  mensaje text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
  v_destino text := upper(trim(coalesce(p_modulo_destino, '')));
  v_actual text;
  v_next record;
begin
  if v_user is null then
    raise exception 'Usuario no autenticado.';
  end if;

  if p_orden_id is null or p_orden_id <= 0 then
    raise exception 'orden_id invalido.';
  end if;

  if v_destino not in ('ACABADOS', 'CORTADOR') then
    raise exception 'modulo_destino invalido. Use ACABADOS o CORTADOR.';
  end if;

  perform pg_advisory_xact_lock(hashtext('route_handoff:' || p_orden_id::text));

  perform 1
  from public.ordenes o
  where o.id = p_orden_id
  for update;

  if not found then
    raise exception 'La orden % no existe.', p_orden_id;
  end if;

  select *
    into v_next
  from public.get_orden_proximo_proceso_ruta(p_orden_id)
  limit 1;

  if v_next.proceso_id is null then
    raise exception 'La orden % no tiene procesos pendientes para transferir.', p_orden_id;
  end if;

  v_actual := public.get_orden_modulo_ruta_actual(p_orden_id);

  if upper(coalesce(v_next.modulo_responsable, '')) <> v_destino then
    raise exception 'La orden % aun no esta lista para %. El siguiente proceso pendiente es % (%).',
      p_orden_id,
      v_destino,
      coalesce(v_next.proceso_codigo, '-'),
      coalesce(v_next.modulo_responsable, '-');
  end if;

  update public.detalles_orden
  set modulo_ruta_actual = v_destino
  where orden_id = p_orden_id;

  orden_id := p_orden_id;
  modulo_actual := coalesce(v_actual, '-');
  modulo_destino := v_destino;
  proceso_id_siguiente := v_next.proceso_id;
  proceso_codigo_siguiente := v_next.proceso_codigo;
  mensaje := case
    when v_destino = 'CORTADOR' then format('Orden %s enviada a CORTE. El siguiente paso es %s.', p_orden_id, coalesce(v_next.proceso_codigo, 'CORTE'))
    else format('Orden %s enviada a ACABADOS. El siguiente paso es %s.', p_orden_id, coalesce(v_next.proceso_codigo, '-'))
  end;
  return next;
end;
$$;

grant execute on function public.transferir_orden_ruta(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Seed: ademas de sembrar, asegura modulo_ruta_actual inicial
-- ---------------------------------------------------------------------------
create or replace function public.ensure_orden_procesos_acabados(
  p_orden_id bigint
)
returns table (
  orden_id bigint,
  sembrados integer,
  total_acabados integer,
  mensaje text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_estado_orden text;
  v_inserted integer := 0;
  v_total integer := 0;
  v_modulo_actual text;
begin
  if p_orden_id is null or p_orden_id <= 0 then
    raise exception 'orden_id invalido.';
  end if;

  select o.estado::text
    into v_estado_orden
  from public.ordenes o
  where o.id = p_orden_id
  limit 1;

  if v_estado_orden is null then
    raise exception 'La orden % no existe.', p_orden_id;
  end if;

  insert into public.orden_procesos (
    orden_id,
    proceso_codigo,
    modulo_responsable,
    secuencia,
    estado,
    configuracion
  )
  select
    seed.orden_id,
    seed.proceso_codigo,
    seed.modulo_responsable,
    coalesce(seed.secuencia, 1),
    coalesce(seed.estado_inicial, 'PENDIENTE'),
    coalesce(seed.configuracion, '{}'::jsonb)
  from public.v_orden_procesos_seed seed
  where seed.orden_id = p_orden_id
    and not exists (
      select 1
      from public.orden_procesos existing
      where existing.orden_id = seed.orden_id
        and existing.proceso_codigo = seed.proceso_codigo
    )
  on conflict (orden_id, proceso_codigo, secuencia) do nothing;

  get diagnostics v_inserted = row_count;

  select count(*)::integer
    into v_total
  from public.orden_procesos op
  where op.orden_id = p_orden_id
    and op.modulo_responsable = 'ACABADOS';

  v_modulo_actual := public.sync_orden_modulo_ruta_actual(p_orden_id, false);

  orden_id := p_orden_id;
  sembrados := v_inserted;
  total_acabados := v_total;

  if v_total = 0 then
    mensaje := format(
      'La orden %s no tiene procesos ACABADOS configurados. Modulo actual de ruta: %s.',
      p_orden_id,
      coalesce(v_modulo_actual, '-')
    );
  elsif v_inserted > 0 then
    mensaje := format(
      'Se sembraron %s proceso(s) de la ruta para la orden %s. Modulo actual: %s. Total ACABADOS actual: %s.',
      v_inserted,
      p_orden_id,
      coalesce(v_modulo_actual, '-'),
      v_total
    );
  else
    mensaje := format(
      'La orden %s ya tenia sembrada su ruta. Modulo actual: %s. Total ACABADOS actual: %s.',
      p_orden_id,
      coalesce(v_modulo_actual, '-'),
      v_total
    );
  end if;

  return next;
end;
$$;

grant execute on function public.ensure_orden_procesos_acabados(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) RPCs de ACABADOS respetando modulo_ruta_actual
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
  v_modulo_actual text;
begin
  if v_user is null then
    raise exception 'Usuario no autenticado.';
  end if;

  if p_proceso_id is null or p_proceso_id <= 0 then
    raise exception 'proceso_id invalido.';
  end if;

  perform pg_advisory_xact_lock(hashtext('acabados_user:' || v_user::text));

  select op.orden_id, op.proceso_codigo, op.modulo_responsable, op.estado, o.estado::text
    into v_orden_id, v_proceso_codigo, v_modulo, v_estado, v_estado_orden
  from public.orden_procesos op
  join public.ordenes o on o.id = op.orden_id
  where op.id = p_proceso_id
  for update;

  if v_orden_id is null then raise exception 'El proceso % no existe.', p_proceso_id; end if;
  if v_modulo <> 'ACABADOS' then raise exception 'El proceso % no pertenece al modulo ACABADOS.', p_proceso_id; end if;
  if upper(coalesce(v_estado_orden, '')) in ('TERMINADO', 'ENTREGADO') then raise exception 'La orden % ya no admite iniciar procesos de ACABADOS.', v_orden_id; end if;
  if upper(coalesce(v_estado_orden, '')) <> 'ACABADOS' then raise exception 'La orden % no esta en ACABADOS. Estado actual: %.', v_orden_id, v_estado_orden; end if;
  if v_estado <> 'PENDIENTE' then raise exception 'Solo se puede iniciar un proceso PENDIENTE. Estado actual: %.', v_estado; end if;

  v_modulo_actual := public.get_orden_modulo_ruta_actual(v_orden_id);
  if upper(coalesce(v_modulo_actual, '')) <> 'ACABADOS' then
    raise exception 'La orden % aun no fue enviada a ACABADOS. Modulo actual: %.', v_orden_id, coalesce(v_modulo_actual, '-');
  end if;

  if not public.orden_proceso_esta_habilitado(p_proceso_id) then
    raise exception 'Este proceso aun no esta habilitado por secuencia. Finaliza primero los pasos anteriores de la orden.';
  end if;

  update public.orden_procesos
  set estado = 'EN_PROCESO', assigned_user_id = v_user, started_at = coalesce(started_at, now()), finished_at = null
  where id = p_proceso_id and estado = 'PENDIENTE'
  returning id into proceso_id;

  if proceso_id is null then raise exception 'El proceso ya no esta disponible para iniciar.'; end if;

  orden_id := v_orden_id;
  proceso_codigo := v_proceso_codigo;
  estado_proceso := 'EN_PROCESO';
  nuevo_estado_orden := 'ACABADOS';
  mensaje := format('Proceso %s iniciado correctamente.', v_proceso_codigo);
  return next;
end;
$$;

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
  v_modulo_actual text;
begin
  if v_user is null then raise exception 'Usuario no autenticado.'; end if;
  if p_proceso_id is null or p_proceso_id <= 0 then raise exception 'proceso_id invalido.'; end if;

  perform pg_advisory_xact_lock(hashtext('acabados_user:' || v_user::text));

  select op.orden_id, op.proceso_codigo, op.modulo_responsable, op.estado, o.estado::text
    into v_orden_id, v_proceso_codigo, v_modulo, v_estado, v_estado_orden
  from public.orden_procesos op
  join public.ordenes o on o.id = op.orden_id
  where op.id = p_proceso_id
  for update;

  if v_orden_id is null then raise exception 'El proceso % no existe.', p_proceso_id; end if;
  if v_modulo <> 'ACABADOS' then raise exception 'El proceso % no pertenece al modulo ACABADOS.', p_proceso_id; end if;
  if upper(coalesce(v_estado_orden, '')) in ('TERMINADO', 'ENTREGADO') then raise exception 'La orden % ya no admite retomar procesos de ACABADOS.', v_orden_id; end if;
  if upper(coalesce(v_estado_orden, '')) <> 'ACABADOS' then raise exception 'La orden % no esta en ACABADOS. Estado actual: %.', v_orden_id, v_estado_orden; end if;
  if v_estado <> 'PAUSADO' then raise exception 'Solo se puede retomar un proceso PAUSADO. Estado actual: %.', v_estado; end if;

  v_modulo_actual := public.get_orden_modulo_ruta_actual(v_orden_id);
  if upper(coalesce(v_modulo_actual, '')) <> 'ACABADOS' then
    raise exception 'La orden % aun no fue enviada a ACABADOS. Modulo actual: %.', v_orden_id, coalesce(v_modulo_actual, '-');
  end if;

  if not public.orden_proceso_esta_habilitado(p_proceso_id) then
    raise exception 'Este proceso aun no esta habilitado por secuencia. Finaliza primero los pasos anteriores de la orden.';
  end if;

  update public.orden_procesos
  set estado = 'EN_PROCESO', assigned_user_id = v_user, started_at = coalesce(started_at, now()), finished_at = null
  where id = p_proceso_id and estado = 'PAUSADO'
  returning id into proceso_id;

  if proceso_id is null then raise exception 'El proceso ya no estaba disponible para retoma.'; end if;

  orden_id := v_orden_id;
  proceso_codigo := v_proceso_codigo;
  estado_proceso := 'EN_PROCESO';
  nuevo_estado_orden := 'ACABADOS';
  mensaje := format('Proceso %s retomado correctamente.', v_proceso_codigo);
  return next;
end;
$$;

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
  v_next record;
begin
  if v_user is null then raise exception 'Usuario no autenticado.'; end if;
  if p_proceso_id is null or p_proceso_id <= 0 then raise exception 'proceso_id invalido.'; end if;

  perform pg_advisory_xact_lock(hashtext('acabados_user:' || v_user::text));

  select op.orden_id, op.proceso_codigo, op.modulo_responsable, op.estado, op.assigned_user_id
    into v_orden_id, v_proceso_codigo, v_modulo, v_estado, v_assigned_user
  from public.orden_procesos op
  where op.id = p_proceso_id
  for update;

  if v_orden_id is null then raise exception 'El proceso % no existe.', p_proceso_id; end if;
  if v_modulo <> 'ACABADOS' then raise exception 'El proceso % no pertenece al modulo ACABADOS.', p_proceso_id; end if;
  if v_estado <> 'EN_PROCESO' then raise exception 'Solo se puede finalizar un proceso EN_PROCESO. Estado actual: %.', v_estado; end if;
  if v_assigned_user is distinct from v_user then raise exception 'Solo el usuario que tiene el proceso activo puede finalizarlo.'; end if;

  update public.orden_procesos
  set estado = 'FINALIZADO', finished_at = now(),
      observaciones = case
        when v_obs is null then observaciones
        when nullif(trim(coalesce(observaciones, '')), '') is null then '[CIERRE] ' || v_obs
        else observaciones || E'\n[CIERRE] ' || v_obs
      end
  where id = p_proceso_id and estado = 'EN_PROCESO' and assigned_user_id = v_user
  returning id into proceso_id;

  if proceso_id is null then raise exception 'El proceso ya no estaba disponible para cierre.'; end if;

  select * into v_next from public.get_orden_proximo_proceso_ruta(v_orden_id) limit 1;

  if v_next.proceso_id is null then
    perform public.sync_orden_modulo_ruta_actual(v_orden_id, true);
  else
    update public.detalles_orden set modulo_ruta_actual = 'ACABADOS' where orden_id = v_orden_id;
  end if;

  select r.nuevo_estado, r.mensaje into v_nuevo_estado_orden, v_msg_recalc
  from public.recalcular_estado_orden_acabados(v_orden_id) r;

  orden_id := v_orden_id;
  proceso_codigo := v_proceso_codigo;
  estado_proceso := 'FINALIZADO';
  nuevo_estado_orden := v_nuevo_estado_orden;

  if v_next.proceso_id is not null and upper(coalesce(v_next.modulo_responsable, '')) = 'CORTADOR' then
    mensaje := format('Proceso %s finalizado. La orden esta lista para mandar a corte.', v_proceso_codigo);
  else
    mensaje := format('Proceso %s finalizado. %s', v_proceso_codigo, v_msg_recalc);
  end if;

  return next;
end;
$$;

grant execute on function public.iniciar_proceso_acabado(bigint) to authenticated;
grant execute on function public.retomar_proceso_acabado(bigint) to authenticated;
grant execute on function public.finalizar_proceso_acabado(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) RPCs espejo para CORTADOR
-- ---------------------------------------------------------------------------
create or replace function public.iniciar_proceso_cortador(
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
  v_modulo_actual text;
begin
  if v_user is null then raise exception 'Usuario no autenticado.'; end if;
  if p_proceso_id is null or p_proceso_id <= 0 then raise exception 'proceso_id invalido.'; end if;

  perform pg_advisory_xact_lock(hashtext('cortador_user:' || v_user::text));

  select op.orden_id, op.proceso_codigo, op.modulo_responsable, op.estado, o.estado::text
    into v_orden_id, v_proceso_codigo, v_modulo, v_estado, v_estado_orden
  from public.orden_procesos op
  join public.ordenes o on o.id = op.orden_id
  where op.id = p_proceso_id
  for update;

  if v_orden_id is null then raise exception 'El proceso % no existe.', p_proceso_id; end if;
  if v_modulo <> 'CORTADOR' then raise exception 'El proceso % no pertenece al modulo CORTADOR.', p_proceso_id; end if;
  if upper(coalesce(v_estado_orden, '')) in ('TERMINADO', 'ENTREGADO') then raise exception 'La orden % ya no admite iniciar procesos de CORTE.', v_orden_id; end if;
  if upper(coalesce(v_estado_orden, '')) <> 'ACABADOS' then raise exception 'La orden % aun no esta en la etapa macro ACABADOS. Estado actual: %.', v_orden_id, v_estado_orden; end if;
  if v_estado <> 'PENDIENTE' then raise exception 'Solo se puede iniciar un proceso PENDIENTE. Estado actual: %.', v_estado; end if;

  v_modulo_actual := public.get_orden_modulo_ruta_actual(v_orden_id);
  if upper(coalesce(v_modulo_actual, '')) <> 'CORTADOR' then
    raise exception 'La orden % aun no fue enviada a CORTADOR. Modulo actual: %.', v_orden_id, coalesce(v_modulo_actual, '-');
  end if;

  if not public.orden_proceso_esta_habilitado(p_proceso_id) then
    raise exception 'Este proceso aun no esta habilitado por secuencia. Finaliza primero los pasos anteriores de la orden.';
  end if;

  update public.orden_procesos
  set estado = 'EN_PROCESO', assigned_user_id = v_user, started_at = coalesce(started_at, now()), finished_at = null
  where id = p_proceso_id and estado = 'PENDIENTE'
  returning id into proceso_id;

  if proceso_id is null then raise exception 'El proceso ya no esta disponible para iniciar.'; end if;

  orden_id := v_orden_id;
  proceso_codigo := v_proceso_codigo;
  estado_proceso := 'EN_PROCESO';
  nuevo_estado_orden := 'ACABADOS';
  mensaje := format('Proceso %s iniciado correctamente en CORTADOR.', v_proceso_codigo);
  return next;
end;
$$;

create or replace function public.pausar_proceso_cortador(
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
  if v_user is null then raise exception 'Usuario no autenticado.'; end if;
  if p_proceso_id is null or p_proceso_id <= 0 then raise exception 'proceso_id invalido.'; end if;

  perform pg_advisory_xact_lock(hashtext('cortador_user:' || v_user::text));

  select op.orden_id, op.proceso_codigo, op.modulo_responsable, op.estado, op.assigned_user_id
    into v_orden_id, v_proceso_codigo, v_modulo, v_estado, v_assigned_user
  from public.orden_procesos op
  where op.id = p_proceso_id
  for update;

  if v_orden_id is null then raise exception 'El proceso % no existe.', p_proceso_id; end if;
  if v_modulo <> 'CORTADOR' then raise exception 'El proceso % no pertenece al modulo CORTADOR.', p_proceso_id; end if;
  if v_estado <> 'EN_PROCESO' then raise exception 'Solo se puede pausar un proceso EN_PROCESO. Estado actual: %.', v_estado; end if;
  if v_assigned_user is distinct from v_user then raise exception 'Solo el usuario que tiene el proceso activo puede pausarlo.'; end if;

  update public.orden_procesos
  set estado = 'PAUSADO',
      observaciones = case
        when v_obs is null then observaciones
        when nullif(trim(coalesce(observaciones, '')), '') is null then '[PAUSA] ' || v_obs
        else observaciones || E'\n[PAUSA] ' || v_obs
      end
  where id = p_proceso_id and estado = 'EN_PROCESO' and assigned_user_id = v_user
  returning id into proceso_id;

  if proceso_id is null then raise exception 'El proceso ya no estaba disponible para pausa.'; end if;

  orden_id := v_orden_id;
  proceso_codigo := v_proceso_codigo;
  estado_proceso := 'PAUSADO';
  nuevo_estado_orden := 'ACABADOS';
  mensaje := format('Proceso %s pausado correctamente en CORTADOR.', v_proceso_codigo);
  return next;
end;
$$;

create or replace function public.retomar_proceso_cortador(
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
  v_modulo_actual text;
begin
  if v_user is null then raise exception 'Usuario no autenticado.'; end if;
  if p_proceso_id is null or p_proceso_id <= 0 then raise exception 'proceso_id invalido.'; end if;

  perform pg_advisory_xact_lock(hashtext('cortador_user:' || v_user::text));

  select op.orden_id, op.proceso_codigo, op.modulo_responsable, op.estado, o.estado::text
    into v_orden_id, v_proceso_codigo, v_modulo, v_estado, v_estado_orden
  from public.orden_procesos op
  join public.ordenes o on o.id = op.orden_id
  where op.id = p_proceso_id
  for update;

  if v_orden_id is null then raise exception 'El proceso % no existe.', p_proceso_id; end if;
  if v_modulo <> 'CORTADOR' then raise exception 'El proceso % no pertenece al modulo CORTADOR.', p_proceso_id; end if;
  if upper(coalesce(v_estado_orden, '')) in ('TERMINADO', 'ENTREGADO') then raise exception 'La orden % ya no admite retomar procesos de CORTE.', v_orden_id; end if;
  if upper(coalesce(v_estado_orden, '')) <> 'ACABADOS' then raise exception 'La orden % aun no esta en la etapa macro ACABADOS. Estado actual: %.', v_orden_id, v_estado_orden; end if;
  if v_estado <> 'PAUSADO' then raise exception 'Solo se puede retomar un proceso PAUSADO. Estado actual: %.', v_estado; end if;

  v_modulo_actual := public.get_orden_modulo_ruta_actual(v_orden_id);
  if upper(coalesce(v_modulo_actual, '')) <> 'CORTADOR' then
    raise exception 'La orden % aun no fue enviada a CORTADOR. Modulo actual: %.', v_orden_id, coalesce(v_modulo_actual, '-');
  end if;

  if not public.orden_proceso_esta_habilitado(p_proceso_id) then
    raise exception 'Este proceso aun no esta habilitado por secuencia. Finaliza primero los pasos anteriores de la orden.';
  end if;

  update public.orden_procesos
  set estado = 'EN_PROCESO', assigned_user_id = v_user, started_at = coalesce(started_at, now()), finished_at = null
  where id = p_proceso_id and estado = 'PAUSADO'
  returning id into proceso_id;

  if proceso_id is null then raise exception 'El proceso ya no estaba disponible para retoma.'; end if;

  orden_id := v_orden_id;
  proceso_codigo := v_proceso_codigo;
  estado_proceso := 'EN_PROCESO';
  nuevo_estado_orden := 'ACABADOS';
  mensaje := format('Proceso %s retomado correctamente en CORTADOR.', v_proceso_codigo);
  return next;
end;
$$;

create or replace function public.finalizar_proceso_cortador(
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
  v_next record;
begin
  if v_user is null then raise exception 'Usuario no autenticado.'; end if;
  if p_proceso_id is null or p_proceso_id <= 0 then raise exception 'proceso_id invalido.'; end if;

  perform pg_advisory_xact_lock(hashtext('cortador_user:' || v_user::text));

  select op.orden_id, op.proceso_codigo, op.modulo_responsable, op.estado, op.assigned_user_id
    into v_orden_id, v_proceso_codigo, v_modulo, v_estado, v_assigned_user
  from public.orden_procesos op
  where op.id = p_proceso_id
  for update;

  if v_orden_id is null then raise exception 'El proceso % no existe.', p_proceso_id; end if;
  if v_modulo <> 'CORTADOR' then raise exception 'El proceso % no pertenece al modulo CORTADOR.', p_proceso_id; end if;
  if v_estado <> 'EN_PROCESO' then raise exception 'Solo se puede finalizar un proceso EN_PROCESO. Estado actual: %.', v_estado; end if;
  if v_assigned_user is distinct from v_user then raise exception 'Solo el usuario que tiene el proceso activo puede finalizarlo.'; end if;

  update public.orden_procesos
  set estado = 'FINALIZADO', finished_at = now(),
      observaciones = case
        when v_obs is null then observaciones
        when nullif(trim(coalesce(observaciones, '')), '') is null then '[CIERRE] ' || v_obs
        else observaciones || E'\n[CIERRE] ' || v_obs
      end
  where id = p_proceso_id and estado = 'EN_PROCESO' and assigned_user_id = v_user
  returning id into proceso_id;

  if proceso_id is null then raise exception 'El proceso ya no estaba disponible para cierre.'; end if;

  select * into v_next from public.get_orden_proximo_proceso_ruta(v_orden_id) limit 1;

  if v_next.proceso_id is null then
    perform public.sync_orden_modulo_ruta_actual(v_orden_id, true);
  else
    update public.detalles_orden set modulo_ruta_actual = 'CORTADOR' where orden_id = v_orden_id;
  end if;

  select r.nuevo_estado, r.mensaje into v_nuevo_estado_orden, v_msg_recalc
  from public.recalcular_estado_orden_acabados(v_orden_id) r;

  orden_id := v_orden_id;
  proceso_codigo := v_proceso_codigo;
  estado_proceso := 'FINALIZADO';
  nuevo_estado_orden := v_nuevo_estado_orden;

  if v_next.proceso_id is not null and upper(coalesce(v_next.modulo_responsable, '')) = 'ACABADOS' then
    mensaje := format('Proceso %s finalizado. La orden esta lista para mandar a acabados.', v_proceso_codigo);
  else
    mensaje := format('Proceso %s finalizado. %s', v_proceso_codigo, v_msg_recalc);
  end if;

  return next;
end;
$$;

grant execute on function public.iniciar_proceso_cortador(bigint) to authenticated;
grant execute on function public.pausar_proceso_cortador(bigint, text) to authenticated;
grant execute on function public.retomar_proceso_cortador(bigint) to authenticated;
grant execute on function public.finalizar_proceso_cortador(bigint, text) to authenticated;

commit;
