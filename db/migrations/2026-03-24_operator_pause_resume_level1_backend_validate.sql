-- Validaciones post-migracion para Nivel 1 backend de pausa/retoma
-- Ejecutar despues de aplicar:
--   db/migrations/2026-03-24_operator_pause_resume_level1_backend.sql

-- 1) Columnas nuevas en registro_produccion
select
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'registro_produccion'
  and column_name in (
    'flujo_trabajo_id',
    'retoma_de_registro_id',
    'motivo_pausa',
    'obs_pausa',
    'pausado_en'
  )
order by column_name;

-- 2) Tabla de incidencias
select to_regclass('public.registro_produccion_incidencias') as tabla_incidencias;

-- 3) Funciones esperadas
select
  to_regprocedure('public.pausar_trabajo(bigint,text,text)') as pausar_trabajo,
  to_regprocedure('public.reanudar_trabajo(bigint)') as reanudar_trabajo,
  to_regprocedure('public.retomar_trabajo(bigint,bigint)') as retomar_trabajo,
  to_regprocedure('public.registrar_incidencia_produccion(bigint,text,text)') as registrar_incidencia;

-- 4) Indices esperados
select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'uq_registro_retoma_origen',
    'uq_registro_activo_normal_por_orden',
    'uq_registro_activo_por_juego'
  )
order by indexname;

-- 5) No deben quedar PAUSADO abiertos
select count(*) as pausados_abiertos
from public.registro_produccion
where estado_registro = 'PAUSADO'
  and hora_fin is null;

-- 6) Verifica si hay juegos T+R pausados
select
  count(*) as juegos_tr_pausados
from public.orden_juegos_tr
where estado = 'PAUSADO';

-- 7) Muestra una muestra de los ultimos pausados ya cerrados
select
  id,
  orden_id,
  user_id,
  flujo_trabajo_id,
  retoma_de_registro_id,
  estado_registro,
  hora_inicio,
  pausado_en,
  hora_fin,
  motivo_pausa
from public.registro_produccion
where estado_registro = 'PAUSADO'
order by id desc
limit 20;
