-- FASE 1 - Preparacion segura del sistema
-- Objetivo: habilitar migracion compatible para nuevos roles, ordenes externas,
-- RPC transaccional de creacion y estructura futura de ACABADOS.
-- Criterios:
--   1) SQL compatible primero
--   2) Sin cambiar estados visibles actuales
--   3) Sin eliminar fallbacks legacy

begin;

-- ---------------------------------------------------------------------------
-- 1) Catalogo de roles preparado para frontend y futuras pantallas
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists public.roles_app (
  code text primary key,
  nombre text not null,
  home_path text,
  ui_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_roles_app_updated_at on public.roles_app;
create trigger trg_roles_app_updated_at
before update on public.roles_app
for each row execute function public.set_updated_at();

insert into public.roles_app (code, nombre, home_path, ui_enabled)
values
  ('ADMIN', 'Administrador', './admin.html', true),
  ('OPERADOR', 'Operador', './operador.html', true),
  ('ACABADOS', 'Acabados', null, false),
  ('CORTADOR', 'Cortador', null, false)
on conflict (code) do update
set
  nombre = excluded.nombre,
  home_path = excluded.home_path,
  ui_enabled = excluded.ui_enabled,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 2) Compatibilidad ordenes externas: dual-read / dual-write
-- ---------------------------------------------------------------------------
alter table if exists public.ordenes
  add column if not exists es_externo boolean;

alter table if exists public.ordenes
  alter column es_externo set default false;

create or replace function public.strip_external_tag(p_value text)
returns text
language sql
immutable
as $$
  select nullif(trim(regexp_replace(coalesce(p_value, ''), '(?i)\[EXTERNO\]\s*', '', 'g')), '')
$$;

create or replace function public.sync_orden_externo_compat()
returns trigger
language plpgsql
as $$
declare
  v_has_tag boolean;
  v_obs_clean text;
begin
  v_has_tag := upper(coalesce(new.observaciones_generales, '')) like '%[EXTERNO]%';
  v_obs_clean := public.strip_external_tag(new.observaciones_generales);

  if new.es_externo is null then
    new.es_externo := v_has_tag;
  end if;

  if coalesce(new.es_externo, false) then
    new.observaciones_generales :=
      case
        when v_obs_clean is null then '[EXTERNO]'
        else '[EXTERNO] ' || v_obs_clean
      end;
  else
    new.observaciones_generales := v_obs_clean;
  end if;

  if new.es_externo is null then
    new.es_externo := false;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ordenes_sync_externo_compat on public.ordenes;
create trigger trg_ordenes_sync_externo_compat
before insert or update of es_externo, observaciones_generales
on public.ordenes
for each row
execute function public.sync_orden_externo_compat();

update public.ordenes
set es_externo = true
where upper(coalesce(observaciones_generales, '')) like '%[EXTERNO]%'
  and coalesce(es_externo, false) = false;

update public.ordenes
set es_externo = false
where es_externo is null;

-- ---------------------------------------------------------------------------
-- 3) Asegurar columnas que la RPC v2 necesita en detalles_orden
-- ---------------------------------------------------------------------------
alter table if exists public.detalles_orden
  add column if not exists observacion_tecnica text,
  add column if not exists requiere_juegos_placa boolean not null default false,
  add column if not exists juegos_placa_total integer,
  add column if not exists juegos_placa_detalle jsonb;

-- ---------------------------------------------------------------------------
-- 4) RPC versionada para creacion transaccional compatible
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
  v_descripcion text;
  v_cantidad integer;
begin
  v_cliente_id := nullif(trim(coalesce(p_orden->>'cliente_id', '')), '')::bigint;
  v_descripcion := nullif(trim(coalesce(p_orden->>'descripcion_trabajo', '')), '');
  v_cantidad := coalesce(nullif(trim(coalesce(p_detalles->>'cantidad_solicitada', '')), '')::integer, 0);
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

  if v_cantidad <= 0 then
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
    nullif(trim(coalesce(p_orden->>'fecha_entrega', '')), '')::timestamp,
    coalesce(nullif(trim(coalesce(p_orden->>'prioridad', '')), ''), 'NORMAL'),
    coalesce(nullif(trim(coalesce(p_orden->>'estado', '')), ''), 'DISENO'),
    coalesce(nullif(trim(coalesce(p_orden->>'responsable_diseno', '')), ''), 'Administrador'),
    nullif(trim(coalesce(p_orden->>'observaciones_generales', '')), ''),
    v_es_externo,
    coalesce(nullif(trim(coalesce(p_orden->>'tiene_oc', '')), '')::boolean, false),
    nullif(trim(coalesce(p_orden->>'oc_numero', '')), ''),
    nullif(trim(coalesce(p_orden->>'oc_observacion', '')), '')
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
    nullif(trim(coalesce(p_detalles->>'papel_material', '')), ''),
    nullif(trim(coalesce(p_detalles->>'gramaje', '')), '')::numeric,
    nullif(trim(coalesce(p_detalles->>'medida_ancho', '')), '')::numeric,
    nullif(trim(coalesce(p_detalles->>'medida_alto', '')), '')::numeric,
    nullif(trim(coalesce(p_detalles->>'material_id', '')), '')::bigint,
    nullif(trim(coalesce(p_detalles->>'formato_id', '')), '')::bigint,
    v_cantidad,
    nullif(trim(coalesce(p_detalles->>'demasia', '')), '')::integer,
    nullif(trim(coalesce(p_detalles->>'maquina_sugerida_id', '')), '')::bigint,
    nullif(trim(coalesce(p_detalles->>'tipo_impresion', '')), ''),
    nullif(trim(coalesce(p_detalles->>'observacion_tecnica', '')), ''),
    coalesce(nullif(trim(coalesce(p_detalles->>'requiere_juegos_placa', '')), '')::boolean, false),
    nullif(trim(coalesce(p_detalles->>'juegos_placa_total', '')), '')::integer,
    case
      when jsonb_typeof(p_detalles->'juegos_placa_detalle') = 'array' then p_detalles->'juegos_placa_detalle'
      else null
    end,
    nullif(trim(coalesce(p_detalles->>'color_mode', '')), ''),
    nullif(trim(coalesce(p_detalles->>'color_text', '')), ''),
    coalesce(nullif(trim(coalesce(p_detalles->>'corte', '')), '')::boolean, false),
    coalesce(nullif(trim(coalesce(p_detalles->>'empaquetado', '')), '')::boolean, false),
    coalesce(nullif(trim(coalesce(p_detalles->>'doblez', '')), '')::boolean, false),
    coalesce(nullif(trim(coalesce(p_detalles->>'compaginado', '')), '')::boolean, false),
    coalesce(nullif(trim(coalesce(p_detalles->>'troquelado', '')), '')::boolean, false),
    coalesce(nullif(trim(coalesce(p_detalles->>'sectorizado', '')), '')::boolean, false),
    coalesce(nullif(trim(coalesce(p_detalles->>'barniz', '')), '')::boolean, false),
    nullif(trim(coalesce(p_detalles->>'plastificado', '')), '')
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
-- 5) Estructura base para futuro modulo ACABADOS / CORTADOR
-- ---------------------------------------------------------------------------
create table if not exists public.orden_procesos (
  id bigint generated by default as identity primary key,
  orden_id bigint not null references public.ordenes(id) on delete cascade,
  proceso_codigo text not null
    check (proceso_codigo in (
      'CORTE',
      'EMPAQUETADO',
      'DOBLEZ',
      'COMPAGINADO',
      'TROQUELADO',
      'SECTORIZADO',
      'BARNIZ',
      'PLASTIFICADO'
    )),
  modulo_responsable text not null
    check (modulo_responsable in ('ACABADOS', 'CORTADOR')),
  estado text not null default 'PENDIENTE'
    check (estado in ('PENDIENTE', 'EN_PROCESO', 'PAUSADO', 'FINALIZADO', 'CANCELADO')),
  secuencia integer not null default 1 check (secuencia >= 1),
  configuracion jsonb not null default '{}'::jsonb,
  observaciones text,
  assigned_user_id uuid,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (orden_id, proceso_codigo, secuencia)
);

create index if not exists idx_orden_procesos_orden
  on public.orden_procesos(orden_id);

create index if not exists idx_orden_procesos_modulo_estado
  on public.orden_procesos(modulo_responsable, estado, secuencia, orden_id);

drop trigger if exists trg_orden_procesos_updated_at on public.orden_procesos;
create trigger trg_orden_procesos_updated_at
before update on public.orden_procesos
for each row execute function public.set_updated_at();

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
    ('PLASTIFICADO', 'ACABADOS', case when nullif(trim(coalesce(d.plastificado, '')), '') is not null then jsonb_build_object('source_flag', 'plastificado', 'modo', trim(d.plastificado)) else null end)
) as seed(proceso_codigo, modulo_responsable, configuracion)
where seed.configuracion is not null;

comment on view public.v_orden_procesos_seed is
'Semilla compatible para poblar orden_procesos en Fase 2 a partir de flags actuales de detalles_orden.';

commit;
