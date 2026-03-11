-- Rollback for migration: 2026-03-11_tyr_juegos_base.sql
-- Run only if you need to revert T+R game schema changes.

begin;

drop view if exists public.v_orden_juegos_tr_consolidado;

drop trigger if exists trg_detalles_sync_orden_juegos_tr on public.detalles_orden;
drop function if exists public.trg_sync_orden_juegos_tr_from_detalle();
drop function if exists public.sync_orden_juegos_tr_from_detalle(bigint);

drop trigger if exists trg_orden_juegos_tr_updated_at on public.orden_juegos_tr;
drop function if exists public.set_updated_at();

drop index if exists public.uq_registro_activo_por_juego_cara;

alter table if exists public.registro_produccion
  drop constraint if exists registro_produccion_juego_cara_pair_chk,
  drop constraint if exists registro_produccion_cara_impresion_chk,
  drop constraint if exists registro_produccion_buena_reportada_chk,
  drop constraint if exists registro_produccion_mala_reportada_chk;

alter table if exists public.registro_produccion
  drop column if exists orden_juego_id,
  drop column if exists juego_num,
  drop column if exists cara_impresion,
  drop column if exists buena_reportada,
  drop column if exists mala_reportada;

drop table if exists public.orden_juegos_tr;

alter table if exists public.detalles_orden
  drop constraint if exists detalles_orden_juegos_placa_total_chk;

alter table if exists public.detalles_orden
  drop column if exists requiere_juegos_placa,
  drop column if exists juegos_placa_total,
  drop column if exists juegos_placa_detalle;

-- Restore original lock: only one active registro per orden
create unique index if not exists uq_registro_abierto_por_orden
  on public.registro_produccion (orden_id)
  where hora_fin is null;

commit;
