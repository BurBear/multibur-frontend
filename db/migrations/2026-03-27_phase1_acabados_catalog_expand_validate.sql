-- Validaciones para ampliacion de catalogo de acabados
-- Ejecutar despues de aplicar:
--   db/migrations/2026-03-27_phase1_acabados_catalog_expand.sql

-- 1) Nuevas columnas esperadas en detalles_orden
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'detalles_orden'
  and column_name in (
    'encolado',
    'marcado',
    'anillado',
    'perforado',
    'perforado_tipo',
    'pegado_solapa',
    'semi_corte',
    'enumerado'
  )
order by column_name;

-- 2) Constraint esperada para perforado_tipo
select
  conname,
  pg_get_constraintdef(c.oid) as constraint_def
from pg_constraint c
where c.conrelid = 'public.detalles_orden'::regclass
  and c.conname = 'detalles_orden_perforado_tipo_check';

-- 3) Constraint esperada para proceso_codigo ampliado
select
  conname,
  pg_get_constraintdef(c.oid) as constraint_def
from pg_constraint c
where c.conrelid = 'public.orden_procesos'::regclass
  and c.conname = 'orden_procesos_proceso_codigo_check';

-- 4) RPC de creacion esperada
select
  to_regprocedure('public.create_orden_con_detalles_v2(jsonb,jsonb)') as create_orden_rpc;

-- 5) La vista seed debe contener los nuevos procesos
select
  position('ENCOLADO' in pg_get_viewdef('public.v_orden_procesos_seed'::regclass, true)) > 0 as has_encolado,
  position('MARCADO' in pg_get_viewdef('public.v_orden_procesos_seed'::regclass, true)) > 0 as has_marcado,
  position('ANILLADO' in pg_get_viewdef('public.v_orden_procesos_seed'::regclass, true)) > 0 as has_anillado,
  position('PERFORADO' in pg_get_viewdef('public.v_orden_procesos_seed'::regclass, true)) > 0 as has_perforado,
  position('PEGADO_SOLAPA' in pg_get_viewdef('public.v_orden_procesos_seed'::regclass, true)) > 0 as has_pegado_solapa,
  position('SEMI_CORTE' in pg_get_viewdef('public.v_orden_procesos_seed'::regclass, true)) > 0 as has_semi_corte,
  position('ENUMERADO' in pg_get_viewdef('public.v_orden_procesos_seed'::regclass, true)) > 0 as has_enumerado;

-- 6) Muestra ejemplos de procesos sembrables con el catalogo extendido
select
  orden_id,
  proceso_codigo,
  modulo_responsable,
  secuencia,
  estado_inicial,
  configuracion
from public.v_orden_procesos_seed
where proceso_codigo in (
  'ENCOLADO',
  'MARCADO',
  'ANILLADO',
  'PERFORADO',
  'PEGADO_SOLAPA',
  'SEMI_CORTE',
  'ENUMERADO'
)
order by orden_id desc, proceso_codigo asc
limit 50;
