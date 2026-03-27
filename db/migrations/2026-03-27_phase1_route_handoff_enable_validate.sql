-- Validaciones para handoff explicito de ruta entre ACABADOS y CORTADOR
-- Ejecutar despues de aplicar:
--   db/migrations/2026-03-27_phase1_route_handoff_enable.sql

-- 1) Nueva columna esperada
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'detalles_orden'
  and column_name = 'modulo_ruta_actual';

-- 2) Constraint esperada
select
  conname,
  pg_get_constraintdef(c.oid) as constraint_def
from pg_constraint c
where c.conrelid = 'public.detalles_orden'::regclass
  and c.conname = 'detalles_orden_modulo_ruta_actual_check';

-- 3) Helpers esperados
select
  to_regprocedure('public.get_orden_proximo_proceso_ruta(bigint)') as get_orden_proximo_proceso_ruta,
  to_regprocedure('public.get_orden_modulo_ruta_actual(bigint)') as get_orden_modulo_ruta_actual,
  to_regprocedure('public.sync_orden_modulo_ruta_actual(bigint,boolean)') as sync_orden_modulo_ruta_actual,
  to_regprocedure('public.transferir_orden_ruta(bigint,text)') as transferir_orden_ruta;

-- 4) RPCs de CORTADOR esperadas
select
  to_regprocedure('public.iniciar_proceso_cortador(bigint)') as iniciar_proceso_cortador,
  to_regprocedure('public.pausar_proceso_cortador(bigint,text)') as pausar_proceso_cortador,
  to_regprocedure('public.retomar_proceso_cortador(bigint)') as retomar_proceso_cortador,
  to_regprocedure('public.finalizar_proceso_cortador(bigint,text)') as finalizar_proceso_cortador;

-- 5) Muestra modulo actual y siguiente paso de ruta
select
  o.id as orden_id,
  o.numero_orden_fisica,
  d.modulo_ruta_actual,
  nxt.proceso_codigo as siguiente_proceso,
  nxt.modulo_responsable as siguiente_modulo,
  nxt.estado as siguiente_estado,
  nxt.secuencia_efectiva
from public.ordenes o
join public.detalles_orden d on d.orden_id = o.id
left join lateral public.get_orden_proximo_proceso_ruta(o.id) nxt on true
where upper(o.estado::text) = 'ACABADOS'
order by o.id desc
limit 80;

-- 6) Procesos abiertos por modulo
select
  op.modulo_responsable,
  op.estado,
  count(*)::integer as total
from public.orden_procesos op
where op.estado not in ('FINALIZADO', 'CANCELADO')
group by op.modulo_responsable, op.estado
order by op.modulo_responsable, op.estado;
