-- ACABADOS V1 - Validaciones para RPCs operativas
-- Ejecutar despues de aplicar:
--   db/migrations/2026-03-26_acabados_v1_operativo.sql

-- 1) Funciones esperadas
select
  to_regprocedure('public.recalcular_estado_orden_acabados(bigint)') as recalcular_estado_orden_acabados,
  to_regprocedure('public.iniciar_proceso_acabado(bigint)') as iniciar_proceso_acabado,
  to_regprocedure('public.pausar_proceso_acabado(bigint,text)') as pausar_proceso_acabado,
  to_regprocedure('public.retomar_proceso_acabado(bigint)') as retomar_proceso_acabado,
  to_regprocedure('public.finalizar_proceso_acabado(bigint,text)') as finalizar_proceso_acabado;

-- 2) Resumen de procesos ACABADOS por estado
select
  estado,
  count(*)::integer as total
from public.orden_procesos
where modulo_responsable = 'ACABADOS'
group by estado
order by estado;

-- 3) Usuarios con procesos ACABADOS activos
select
  assigned_user_id,
  count(*)::integer as total_activos
from public.orden_procesos
where modulo_responsable = 'ACABADOS'
  and estado = 'EN_PROCESO'
  and assigned_user_id is not null
group by assigned_user_id
order by total_activos desc, assigned_user_id;

-- 4) Ordenes ACABADOS con procesos sembrados y progreso
select
  o.id as orden_id,
  o.numero_orden_fisica,
  o.estado::text as estado_orden,
  count(op.id)::integer as total_procesos,
  count(*) filter (where op.estado = 'PENDIENTE')::integer as pendientes,
  count(*) filter (where op.estado = 'EN_PROCESO')::integer as en_proceso,
  count(*) filter (where op.estado = 'PAUSADO')::integer as pausados,
  count(*) filter (where op.estado = 'FINALIZADO')::integer as finalizados,
  count(*) filter (where op.estado = 'CANCELADO')::integer as cancelados
from public.ordenes o
left join public.orden_procesos op
  on op.orden_id = o.id
 and op.modulo_responsable = 'ACABADOS'
where upper(o.estado::text) = 'ACABADOS'
group by o.id, o.numero_orden_fisica, o.estado
order by o.id desc;
