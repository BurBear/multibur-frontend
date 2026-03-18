-- FASE 1 FIX
-- Hace create_orden_con_detalles_v2 tolerante a labels legacy / variantes de enum.
-- Caso principal cubierto: DISENO vs DISENO con acento en estados legacy.

begin;

create or replace function public.compat_enum_label(
  p_target_type regtype,
  p_value text,
  p_default text default null
)
returns text
language sql
stable
as $$
  with desired as (
    select coalesce(nullif(trim(p_value), ''), nullif(trim(p_default), '')) as source_value
  ),
  labels as (
    select e.enumlabel
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.oid = p_target_type
  ),
  exact_match as (
    select l.enumlabel
    from desired d
    join labels l
      on upper(trim(l.enumlabel)) = upper(trim(d.source_value))
    limit 1
  ),
  matched as (
    select l.enumlabel
    from desired d
    join labels l
      on upper(regexp_replace(translate(
           l.enumlabel,
           U&'\00C1\00C9\00CD\00D3\00DA\00DC\00D1\00E1\00E9\00ED\00F3\00FA\00FC\00F1',
           'AEIOUUNAEIOUUN'
         ), '[^A-Z0-9]+', '', 'g'))
       = upper(regexp_replace(translate(
           d.source_value,
           U&'\00C1\00C9\00CD\00D3\00DA\00DC\00D1\00E1\00E9\00ED\00F3\00FA\00FC\00F1',
           'AEIOUUNAEIOUUN'
         ), '[^A-Z0-9]+', '', 'g'))
    limit 1
  )
  select coalesce(
    (select enumlabel from exact_match),
    (select enumlabel from matched),
    (select source_value from desired)
  );
$$;

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
  v_orden_id public.ordenes.id%type;
  v_es_externo boolean;

  v_cliente_id public.ordenes.cliente_id%type;
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
    plastificado
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
    v_plastificado
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

grant execute on function public.compat_enum_label(regtype, text, text) to authenticated;
grant execute on function public.create_orden_con_detalles_v2(jsonb, jsonb) to authenticated;

commit;
