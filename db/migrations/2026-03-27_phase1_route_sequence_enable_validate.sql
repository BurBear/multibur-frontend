-- Validaciones para secuencia de ruta y habilitacion real de procesos
-- Ejecutar despues de aplicar:
--   db/migrations/2026-03-27_phase1_route_sequence_enable.sql

-- 1) Nueva columna esperada
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'detalles_orden'
  and column_name = 'ruta_procesos';

-- 2) Constraint esperada sobre ruta_procesos
select
  conname,
  pg_get_constraintdef(c.oid) as constraint_def
from pg_constraint c
where c.conrelid = 'public.detalles_orden'::regclass
  and c.conname = 'detalles_orden_ruta_procesos_check';

-- 3) Helpers esperados
select
  to_regprocedure('public.route_key_from_proceso_codigo(text)') as route_key_from_proceso_codigo,
  to_regprocedure('public.get_orden_proceso_secuencia_efectiva(bigint,text,integer)') as get_orden_proceso_secuencia_efectiva,
  to_regprocedure('public.orden_proceso_esta_habilitado(bigint)') as orden_proceso_esta_habilitado;

-- 4) Verifica que la vista seed ya no deje todo en secuencia 1
select
  orden_id,
  proceso_codigo,
  modulo_responsable,
  secuencia,
  configuracion
from public.v_orden_procesos_seed
order by orden_id desc, secuencia asc, proceso_codigo asc
limit 80;

-- 5) Muestra procesos con secuencia efectiva calculada
select
  op.id,
  op.orden_id,
  op.proceso_codigo,
  op.modulo_responsable,
  op.estado,
  op.secuencia as secuencia_guardada,
  public.get_orden_proceso_secuencia_efectiva(op.orden_id, op.proceso_codigo, op.secuencia) as secuencia_efectiva,
  public.orden_proceso_esta_habilitado(op.id) as habilitado
from public.orden_procesos op
where op.orden_id in (
  select o.id
  from public.ordenes o
  where upper(o.estado::text) = 'ACABADOS'
)
order by op.orden_id desc, secuencia_efectiva asc, op.id asc
limit 120;
