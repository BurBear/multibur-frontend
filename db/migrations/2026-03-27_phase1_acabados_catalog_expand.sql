begin;

-- ============================================================================
-- Ampliacion de catalogo de acabados para ordenes / seed de procesos
-- No modifica la logica operativa de ACABADOS ni CORTADOR.
-- Solo agrega nuevos flags de detalle, extiende proceso_codigo y actualiza
-- la semilla base + RPC de creacion compatible.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Nuevos campos de acabados en detalles_orden
-- ---------------------------------------------------------------------------
alter table if exists public.detalles_orden
  add column if not exists encolado boolean not null default false,
  add column if not exists marcado boolean not null default false,
  add column if not exists anillado boolean not null default false,
  add column if not exists perforado boolean not null default false,
  add column if not exists perforado_tipo text,
  add column if not exists pegado_solapa boolean not null default false,
  add column if not exists semi_corte boolean not null default false,
  add column if not exists enumerado boolean not null default false;

alter table if exists public.detalles_orden
  drop constraint if exists detalles_orden_perforado_tipo_check;

alter table if exists public.detalles_orden
  add constraint detalles_orden_perforado_tipo_check
  check (
    perforado_tipo is null
    or perforado_tipo in ('PERFORADO', 'PICADO_PERFORADO')
  );

comment on column public.detalles_orden.perforado_tipo is
'Variante del proceso PERFORADO. Valores permitidos: PERFORADO, PICADO_PERFORADO.';

-- ---------------------------------------------------------------------------
-- 2) Extender catalogo permitido en orden_procesos
-- ---------------------------------------------------------------------------
alter table if exists public.orden_procesos
  drop constraint if exists orden_procesos_proceso_codigo_check;

alter table if exists public.orden_procesos
  add constraint orden_procesos_proceso_codigo_check
  check (proceso_codigo in (
    'CORTE',
    'EMPAQUETADO',
    'DOBLEZ',
    'COMPAGINADO',
    'TROQUELADO',
    'SECTORIZADO',
    'BARNIZ',
    'PLASTIFICADO',
    'ENCOLADO',
    'MARCADO',
    'ANILLADO',
    'PERFORADO',
    'PEGADO_SOLAPA',
    'SEMI_CORTE',
    'ENUMERADO'
  ));

-- ---------------------------------------------------------------------------
-- 3) RPC de creacion compatible con nuevos acabados
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
    enumerado
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
    v_enumerado
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
-- 4) Seed extendido para nuevos acabados
-- ---------------------------------------------------------------------------
create or replace view public.v_orden_procesos_seed as
select
  d.orden_id,
  seed.proceso_codigo,
  seed.modulo_responsable,
  1 as secuencia,
  'PENDIENTE'::text as estado_inicial,
  seed.configuracion
from public.detalles_orden d
cross join lateral (
  values
    ('CORTE', 'CORTADOR', case when coalesce(d.corte, false) then jsonb_build_object('source_flag', 'corte') else null end),
    ('EMPAQUETADO', 'ACABADOS', case when coalesce(d.empaquetado, false) then jsonb_build_object('source_flag', 'empaquetado') else null end),
    ('DOBLEZ', 'ACABADOS', case when coalesce(d.doblez, false) then jsonb_build_object('source_flag', 'doblez') else null end),
    ('COMPAGINADO', 'ACABADOS', case when coalesce(d.compaginado, false) then jsonb_build_object('source_flag', 'compaginado') else null end),
    ('TROQUELADO', 'ACABADOS', case when coalesce(d.troquelado, false) then jsonb_build_object('source_flag', 'troquelado') else null end),
    ('SECTORIZADO', 'ACABADOS', case when coalesce(d.sectorizado, false) then jsonb_build_object('source_flag', 'sectorizado') else null end),
    ('BARNIZ', 'ACABADOS', case when coalesce(d.barniz, false) then jsonb_build_object('source_flag', 'barniz') else null end),
    ('PLASTIFICADO', 'ACABADOS', case when nullif(trim(coalesce(d.plastificado, '')), '') is not null then jsonb_build_object('source_flag', 'plastificado', 'modo', trim(d.plastificado)) else null end),
    ('ENCOLADO', 'ACABADOS', case when coalesce(d.encolado, false) then jsonb_build_object('source_flag', 'encolado') else null end),
    ('MARCADO', 'ACABADOS', case when coalesce(d.marcado, false) then jsonb_build_object('source_flag', 'marcado') else null end),
    ('ANILLADO', 'ACABADOS', case when coalesce(d.anillado, false) then jsonb_build_object('source_flag', 'anillado') else null end),
    ('PERFORADO', 'ACABADOS', case when coalesce(d.perforado, false) then jsonb_build_object('source_flag', 'perforado', 'tipo', coalesce(nullif(trim(coalesce(d.perforado_tipo, '')), ''), 'PERFORADO')) else null end),
    ('PEGADO_SOLAPA', 'ACABADOS', case when coalesce(d.pegado_solapa, false) then jsonb_build_object('source_flag', 'pegado_solapa') else null end),
    ('SEMI_CORTE', 'ACABADOS', case when coalesce(d.semi_corte, false) then jsonb_build_object('source_flag', 'semi_corte') else null end),
    ('ENUMERADO', 'ACABADOS', case when coalesce(d.enumerado, false) then jsonb_build_object('source_flag', 'enumerado') else null end)
) as seed(proceso_codigo, modulo_responsable, configuracion)
where seed.configuracion is not null;

comment on view public.v_orden_procesos_seed is
'Semilla compatible para poblar orden_procesos a partir de flags actuales de detalles_orden, incluyendo acabados extendidos.';

commit;
