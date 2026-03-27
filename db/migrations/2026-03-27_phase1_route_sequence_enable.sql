begin;

-- ============================================================================
-- Persistencia y aplicacion de secuencia real de procesos
-- - Guarda la ruta definida desde ADMIN
-- - Usa esa ruta para calcular secuencia efectiva
-- - Hace que ACABADOS solo pueda iniciar/retomar procesos habilitados
-- - Permite sembrar tambien pasos de CORTADOR sin activar su modulo visual
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Columna para persistir la ruta de procesos
-- ---------------------------------------------------------------------------
alter table if exists public.detalles_orden
  add column if not exists ruta_procesos jsonb;

alter table if exists public.detalles_orden
  drop constraint if exists detalles_orden_ruta_procesos_check;

alter table if exists public.detalles_orden
  add constraint detalles_orden_ruta_procesos_check
  check (
    ruta_procesos is null
    or jsonb_typeof(ruta_procesos) = 'array'
  );

comment on column public.detalles_orden.ruta_procesos is
'Ruta de procesos definida en ADMIN. Arreglo JSON con key, order, variant y module.';

-- ---------------------------------------------------------------------------
-- 2) Helpers de secuencia efectiva
-- ---------------------------------------------------------------------------
create or replace function public.route_key_from_proceso_codigo(
  p_proceso_codigo text
)
returns text
language sql
immutable
as $$
  select case upper(coalesce(trim(p_proceso_codigo), ''))
    when 'CORTE' then 'corte'
    when 'EMPAQUETADO' then 'empaquetado'
    when 'DOBLEZ' then 'doblez'
    when 'COMPAGINADO' then 'compaginado'
    when 'TROQUELADO' then 'troquelado'
    when 'SECTORIZADO' then 'sectorizado'
    when 'BARNIZ' then 'barniz'
    when 'PLASTIFICADO' then 'plastificado'
    when 'ENCOLADO' then 'encolado'
    when 'MARCADO' then 'marcado'
    when 'ANILLADO' then 'anillado'
    when 'PERFORADO' then 'perforado'
    when 'PEGADO_SOLAPA' then 'pegado_solapa'
    when 'SEMI_CORTE' then 'semi_corte'
    when 'ENUMERADO' then 'enumerado'
    else null
  end;
$$;

create or replace function public.get_orden_proceso_secuencia_efectiva(
  p_orden_id bigint,
  p_proceso_codigo text,
  p_fallback integer default 1
)
returns integer
language sql
stable
set search_path = public
as $$
  with route_match as (
    select
      coalesce(
        nullif(trim(item->>'order'), '')::integer,
        ordinality::integer
      ) as route_order
    from public.detalles_orden d
    cross join lateral jsonb_array_elements(coalesce(d.ruta_procesos, '[]'::jsonb)) with ordinality as r(item, ordinality)
    where d.orden_id = p_orden_id
      and lower(trim(coalesce(item->>'key', ''))) = public.route_key_from_proceso_codigo(p_proceso_codigo)
    order by route_order asc
    limit 1
  )
  select coalesce(
    (select route_order from route_match),
    nullif(p_fallback, 0),
    1
  );
$$;

create or replace function public.orden_proceso_esta_habilitado(
  p_proceso_id bigint
)
returns boolean
language sql
stable
set search_path = public
as $$
  with target as (
    select
      op.id,
      op.orden_id,
      public.get_orden_proceso_secuencia_efectiva(
        op.orden_id,
        op.proceso_codigo,
        coalesce(op.secuencia, 1)
      ) as secuencia_efectiva
    from public.orden_procesos op
    where op.id = p_proceso_id
  )
  select not exists (
    select 1
    from target t
    join public.orden_procesos prev
      on prev.orden_id = t.orden_id
     and prev.id <> t.id
    where public.get_orden_proceso_secuencia_efectiva(
            prev.orden_id,
            prev.proceso_codigo,
            coalesce(prev.secuencia, 1)
          ) < t.secuencia_efectiva
      and prev.estado not in ('FINALIZADO', 'CANCELADO')
  );
$$;

grant execute on function public.route_key_from_proceso_codigo(text) to authenticated;
grant execute on function public.get_orden_proceso_secuencia_efectiva(bigint, text, integer) to authenticated;
grant execute on function public.orden_proceso_esta_habilitado(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) RPC de creacion compatible con ruta_procesos
-- ---------------------------------------------------------------------------
create or replace function public.create_orden_con_detalles_v2(
  p_orden jsonb,
  p_detalles jsonb
)
returns table (
  id bigint,
  numero_orden_fisica text,
  fecha_entrega text
)
language plpgsql
as $$
declare
  v_orden_id bigint;
  v_es_externo boolean;
  v_cliente_id bigint;
  v_descripcion public.ordenes.descripcion_trabajo%type;
  v_fecha_entrega public.ordenes.fecha_entrega%type;
  v_prioridad public.ordenes.prioridad%type;
  v_estado public.ordenes.estado%type;
  v_responsable_diseno public.ordenes.responsable_diseno%type;
  v_observaciones public.ordenes.observaciones_generales%type;
  v_tiene_oc public.ordenes.tiene_oc%type;
  v_oc_numero public.ordenes.oc_numero%type;
  v_oc_observacion public.ordenes.oc_observacion%type;

  v_papel_material public.detalles_orden.papel_material%type;
  v_gramaje public.detalles_orden.gramaje%type;
  v_medida_ancho public.detalles_orden.medida_ancho%type;
  v_medida_alto public.detalles_orden.medida_alto%type;
  v_material_id public.detalles_orden.material_id%type;
  v_formato_id public.detalles_orden.formato_id%type;
  v_cantidad public.detalles_orden.cantidad_solicitada%type;
  v_demasia public.detalles_orden.demasia%type;
  v_maquina_sugerida_id public.detalles_orden.maquina_sugerida_id%type;
  v_tipo_impresion public.detalles_orden.tipo_impresion%type;
  v_observacion_tecnica public.detalles_orden.observacion_tecnica%type;
  v_requiere_juegos_placa public.detalles_orden.requiere_juegos_placa%type;
  v_juegos_placa_total public.detalles_orden.juegos_placa_total%type;
  v_juegos_placa_detalle public.detalles_orden.juegos_placa_detalle%type;
  v_color_mode public.detalles_orden.color_mode%type;
  v_color_text public.detalles_orden.color_text%type;
  v_corte public.detalles_orden.corte%type;
  v_empaquetado public.detalles_orden.empaquetado%type;
  v_doblez public.detalles_orden.doblez%type;
  v_compaginado public.detalles_orden.compaginado%type;
  v_troquelado public.detalles_orden.troquelado%type;
  v_sectorizado public.detalles_orden.sectorizado%type;
  v_barniz public.detalles_orden.barniz%type;
  v_plastificado public.detalles_orden.plastificado%type;
  v_encolado public.detalles_orden.encolado%type;
  v_marcado public.detalles_orden.marcado%type;
  v_anillado public.detalles_orden.anillado%type;
  v_perforado public.detalles_orden.perforado%type;
  v_perforado_tipo public.detalles_orden.perforado_tipo%type;
  v_perforado_tipo_raw text;
  v_pegado_solapa public.detalles_orden.pegado_solapa%type;
  v_semi_corte public.detalles_orden.semi_corte%type;
  v_enumerado public.detalles_orden.enumerado%type;
  v_ruta_procesos public.detalles_orden.ruta_procesos%type;
begin
  v_cliente_id := nullif(trim(coalesce(p_orden->>'cliente_id', '')), '')::bigint;
  v_descripcion := nullif(trim(coalesce(p_orden->>'descripcion_trabajo', '')), '');
  v_fecha_entrega := nullif(trim(coalesce(p_orden->>'fecha_entrega', '')), '')::timestamp;
  v_prioridad := public.compat_enum_label(pg_typeof(v_prioridad)::regtype, p_orden->>'prioridad', 'NORMAL');
  v_estado := public.compat_enum_label(pg_typeof(v_estado)::regtype, p_orden->>'estado', 'DISENO');
  v_responsable_diseno := coalesce(nullif(trim(coalesce(p_orden->>'responsable_diseno', '')), ''), 'Administrador');
  v_observaciones := nullif(trim(coalesce(p_orden->>'observaciones_generales', '')), '');
  v_tiene_oc := coalesce(nullif(trim(coalesce(p_orden->>'tiene_oc', '')), '')::boolean, false);
  v_oc_numero := nullif(trim(coalesce(p_orden->>'oc_numero', '')), '');
  v_oc_observacion := nullif(trim(coalesce(p_orden->>'oc_observacion', '')), '');

  v_papel_material := nullif(trim(coalesce(p_detalles->>'papel_material', '')), '');
  v_gramaje := nullif(trim(coalesce(p_detalles->>'gramaje', '')), '')::numeric;
  v_medida_ancho := nullif(trim(coalesce(p_detalles->>'medida_ancho', '')), '')::numeric;
  v_medida_alto := nullif(trim(coalesce(p_detalles->>'medida_alto', '')), '')::numeric;
  v_material_id := nullif(trim(coalesce(p_detalles->>'material_id', '')), '')::bigint;
  v_formato_id := nullif(trim(coalesce(p_detalles->>'formato_id', '')), '')::bigint;
  v_cantidad := nullif(trim(coalesce(p_detalles->>'cantidad_solicitada', '')), '')::integer;
  v_demasia := nullif(trim(coalesce(p_detalles->>'demasia', '')), '')::integer;
  v_maquina_sugerida_id := nullif(trim(coalesce(p_detalles->>'maquina_sugerida_id', '')), '')::bigint;
  v_tipo_impresion := public.compat_enum_label(pg_typeof(v_tipo_impresion)::regtype, p_detalles->>'tipo_impresion', null);
  v_observacion_tecnica := nullif(trim(coalesce(p_detalles->>'observacion_tecnica', '')), '');
  v_requiere_juegos_placa := coalesce(nullif(trim(coalesce(p_detalles->>'requiere_juegos_placa', '')), '')::boolean, false);
  v_juegos_placa_total := nullif(trim(coalesce(p_detalles->>'juegos_placa_total', '')), '')::integer;
  v_juegos_placa_detalle := case
    when jsonb_typeof(p_detalles->'juegos_placa_detalle') = 'array' then p_detalles->'juegos_placa_detalle'
    else null
  end;
  v_color_mode := public.compat_enum_label(pg_typeof(v_color_mode)::regtype, p_detalles->>'color_mode', null);
  v_color_text := nullif(trim(coalesce(p_detalles->>'color_text', '')), '');
  v_corte := coalesce(nullif(trim(coalesce(p_detalles->>'corte', '')), '')::boolean, false);
  v_empaquetado := coalesce(nullif(trim(coalesce(p_detalles->>'empaquetado', '')), '')::boolean, false);
  v_doblez := coalesce(nullif(trim(coalesce(p_detalles->>'doblez', '')), '')::boolean, false);
  v_compaginado := coalesce(nullif(trim(coalesce(p_detalles->>'compaginado', '')), '')::boolean, false);
  v_troquelado := coalesce(nullif(trim(coalesce(p_detalles->>'troquelado', '')), '')::boolean, false);
  v_sectorizado := coalesce(nullif(trim(coalesce(p_detalles->>'sectorizado', '')), '')::boolean, false);
  v_barniz := coalesce(nullif(trim(coalesce(p_detalles->>'barniz', '')), '')::boolean, false);
  v_plastificado := public.compat_enum_label(pg_typeof(v_plastificado)::regtype, p_detalles->>'plastificado', null);
  v_encolado := coalesce(nullif(trim(coalesce(p_detalles->>'encolado', '')), '')::boolean, false);
  v_marcado := coalesce(nullif(trim(coalesce(p_detalles->>'marcado', '')), '')::boolean, false);
  v_anillado := coalesce(nullif(trim(coalesce(p_detalles->>'anillado', '')), '')::boolean, false);
  v_perforado := coalesce(nullif(trim(coalesce(p_detalles->>'perforado', '')), '')::boolean, false);
  v_pegado_solapa := coalesce(nullif(trim(coalesce(p_detalles->>'pegado_solapa', '')), '')::boolean, false);
  v_semi_corte := coalesce(nullif(trim(coalesce(p_detalles->>'semi_corte', '')), '')::boolean, false);
  v_enumerado := coalesce(nullif(trim(coalesce(p_detalles->>'enumerado', '')), '')::boolean, false);
  v_ruta_procesos := case
    when jsonb_typeof(p_detalles->'ruta_procesos') = 'array' then p_detalles->'ruta_procesos'
    else null
  end;

  v_perforado_tipo_raw := upper(regexp_replace(trim(coalesce(p_detalles->>'perforado_tipo', '')), '[^A-Z0-9]+', '_', 'g'));
  v_perforado_tipo := case
    when v_perforado_tipo_raw = '' then null
    when v_perforado_tipo_raw = 'PERFORADO' then 'PERFORADO'
    when v_perforado_tipo_raw = 'PICADO_PERFORADO' then 'PICADO_PERFORADO'
    else null
  end;

  if v_perforado_tipo_raw not in ('', 'PERFORADO', 'PICADO_PERFORADO') then
    raise exception 'perforado_tipo invalido. Use PERFORADO o PICADO_PERFORADO.';
  end if;

  if v_perforado and v_perforado_tipo is null then
    v_perforado_tipo := 'PERFORADO';
  end if;

  if not v_perforado and v_perforado_tipo is not null then
    v_perforado := true;
  end if;

  v_es_externo := coalesce(
    nullif(trim(coalesce(p_orden->>'es_externo', '')), '')::boolean,
    upper(coalesce(p_orden->>'observaciones_generales', '')) like '%[EXTERNO]%',
    false
  );

  if v_cliente_id is null then
    raise exception 'cliente_id es requerido';
  end if;

  if v_descripcion is null then
    raise exception 'descripcion_trabajo es requerida';
  end if;

  if v_cantidad is null or v_cantidad <= 0 then
    raise exception 'cantidad_solicitada debe ser mayor a 0';
  end if;

  insert into public.ordenes (
    cliente_id,
    descripcion_trabajo,
    fecha_entrega,
    prioridad,
    estado,
    responsable_diseno,
    observaciones_generales,
    es_externo,
    tiene_oc,
    oc_numero,
    oc_observacion
  )
  values (
    v_cliente_id,
    v_descripcion,
    v_fecha_entrega,
    v_prioridad,
    v_estado,
    v_responsable_diseno,
    v_observaciones,
    v_es_externo,
    v_tiene_oc,
    v_oc_numero,
    v_oc_observacion
  )
  returning ordenes.id into v_orden_id;

  insert into public.detalles_orden (
    orden_id,
    papel_material,
    gramaje,
    medida_ancho,
    medida_alto,
    material_id,
    formato_id,
    cantidad_solicitada,
    demasia,
    maquina_sugerida_id,
    tipo_impresion,
    observacion_tecnica,
    requiere_juegos_placa,
    juegos_placa_total,
    juegos_placa_detalle,
    color_mode,
    color_text,
    corte,
    empaquetado,
    doblez,
    compaginado,
    troquelado,
    sectorizado,
    barniz,
    plastificado,
    encolado,
    marcado,
    anillado,
    perforado,
    perforado_tipo,
    pegado_solapa,
    semi_corte,
    enumerado,
    ruta_procesos
  )
  values (
    v_orden_id,
    v_papel_material,
    v_gramaje,
    v_medida_ancho,
    v_medida_alto,
    v_material_id,
    v_formato_id,
    v_cantidad,
    v_demasia,
    v_maquina_sugerida_id,
    v_tipo_impresion,
    v_observacion_tecnica,
    v_requiere_juegos_placa,
    v_juegos_placa_total,
    v_juegos_placa_detalle,
    v_color_mode,
    v_color_text,
    v_corte,
    v_empaquetado,
    v_doblez,
    v_compaginado,
    v_troquelado,
    v_sectorizado,
    v_barniz,
    v_plastificado,
    v_encolado,
    v_marcado,
    v_anillado,
    v_perforado,
    case when v_perforado then coalesce(v_perforado_tipo, 'PERFORADO') else null end,
    v_pegado_solapa,
    v_semi_corte,
    v_enumerado,
    v_ruta_procesos
  );

  return query
  select
    o.id,
    o.numero_orden_fisica::text,
    o.fecha_entrega::text
  from public.ordenes o
  where o.id = v_orden_id;
end;
$$;

grant execute on function public.create_orden_con_detalles_v2(jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Seed usando secuencia definida en ruta_procesos
-- ---------------------------------------------------------------------------
create or replace view public.v_orden_procesos_seed as
select
  d.orden_id,
  seed.proceso_codigo,
  seed.modulo_responsable,
  coalesce(route.route_order, seed.default_secuencia) as secuencia,
  'PENDIENTE'::text as estado_inicial,
  seed.configuracion
from public.detalles_orden d
cross join lateral (
  values
    ('CORTE', 'CORTADOR', 'corte', 10, case when coalesce(d.corte, false) then jsonb_build_object('source_flag', 'corte') else null end),
    ('EMPAQUETADO', 'ACABADOS', 'empaquetado', 20, case when coalesce(d.empaquetado, false) then jsonb_build_object('source_flag', 'empaquetado') else null end),
    ('DOBLEZ', 'ACABADOS', 'doblez', 30, case when coalesce(d.doblez, false) then jsonb_build_object('source_flag', 'doblez') else null end),
    ('COMPAGINADO', 'ACABADOS', 'compaginado', 40, case when coalesce(d.compaginado, false) then jsonb_build_object('source_flag', 'compaginado') else null end),
    ('TROQUELADO', 'ACABADOS', 'troquelado', 50, case when coalesce(d.troquelado, false) then jsonb_build_object('source_flag', 'troquelado') else null end),
    ('SECTORIZADO', 'ACABADOS', 'sectorizado', 60, case when coalesce(d.sectorizado, false) then jsonb_build_object('source_flag', 'sectorizado') else null end),
    ('BARNIZ', 'ACABADOS', 'barniz', 70, case when coalesce(d.barniz, false) then jsonb_build_object('source_flag', 'barniz') else null end),
    ('PLASTIFICADO', 'ACABADOS', 'plastificado', 80, case when nullif(trim(coalesce(d.plastificado, '')), '') is not null then jsonb_build_object('source_flag', 'plastificado', 'modo', trim(d.plastificado)) else null end),
    ('ENCOLADO', 'ACABADOS', 'encolado', 90, case when coalesce(d.encolado, false) then jsonb_build_object('source_flag', 'encolado') else null end),
    ('MARCADO', 'ACABADOS', 'marcado', 100, case when coalesce(d.marcado, false) then jsonb_build_object('source_flag', 'marcado') else null end),
    ('ANILLADO', 'ACABADOS', 'anillado', 110, case when coalesce(d.anillado, false) then jsonb_build_object('source_flag', 'anillado') else null end),
    ('PERFORADO', 'ACABADOS', 'perforado', 120, case when coalesce(d.perforado, false) then jsonb_build_object('source_flag', 'perforado', 'tipo', coalesce(nullif(trim(coalesce(d.perforado_tipo, '')), ''), 'PERFORADO')) else null end),
    ('PEGADO_SOLAPA', 'ACABADOS', 'pegado_solapa', 130, case when coalesce(d.pegado_solapa, false) then jsonb_build_object('source_flag', 'pegado_solapa') else null end),
    ('SEMI_CORTE', 'ACABADOS', 'semi_corte', 140, case when coalesce(d.semi_corte, false) then jsonb_build_object('source_flag', 'semi_corte') else null end),
    ('ENUMERADO', 'ACABADOS', 'enumerado', 150, case when coalesce(d.enumerado, false) then jsonb_build_object('source_flag', 'enumerado') else null end)
) as seed(proceso_codigo, modulo_responsable, source_key, default_secuencia, configuracion)
left join lateral (
  select
    coalesce(
      nullif(trim(item->>'order'), '')::integer,
      ordinality::integer
    ) as route_order
  from jsonb_array_elements(coalesce(d.ruta_procesos, '[]'::jsonb)) with ordinality as r(item, ordinality)
  where lower(trim(coalesce(item->>'key', ''))) = seed.source_key
  order by route_order asc
  limit 1
) route on true
where seed.configuracion is not null;

comment on view public.v_orden_procesos_seed is
'Semilla compatible para poblar orden_procesos usando flags de detalles_orden y secuencia definida en ruta_procesos.';

-- ---------------------------------------------------------------------------
-- 5) Seed idempotente que siembra toda la ruta, no solo ACABADOS
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

  orden_id := p_orden_id;
  sembrados := v_inserted;
  total_acabados := v_total;

  if v_total = 0 then
    mensaje := format(
      'La orden %s no tiene procesos ACABADOS configurados en detalles_orden. Estado actual: %s.',
      p_orden_id,
      coalesce(v_estado_orden, '-')
    );
  elsif v_inserted > 0 then
    mensaje := format(
      'Se sembraron %s proceso(s) de la ruta para la orden %s. Total ACABADOS actual: %s.',
      v_inserted,
      p_orden_id,
      v_total
    );
  else
    mensaje := format(
      'La orden %s ya tenia sembrada su ruta. Total ACABADOS actual: %s.',
      p_orden_id,
      v_total
    );
  end if;

  return next;
end;
$$;

grant execute on function public.ensure_orden_procesos_acabados(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) RPCs de ACABADOS con validacion por secuencia real
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

  if not public.orden_proceso_esta_habilitado(p_proceso_id) then
    raise exception 'Este proceso aun no esta habilitado por secuencia. Finaliza primero los pasos anteriores de la orden.';
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

  if not public.orden_proceso_esta_habilitado(p_proceso_id) then
    raise exception 'Este proceso aun no esta habilitado por secuencia. Finaliza primero los pasos anteriores de la orden.';
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

grant execute on function public.iniciar_proceso_acabado(bigint) to authenticated;
grant execute on function public.retomar_proceso_acabado(bigint) to authenticated;

commit;
