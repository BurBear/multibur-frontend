-- ACABADOS V1 - Seed idempotente de procesos desde v_orden_procesos_seed
-- Objetivo:
--   1) Poblar procesos faltantes de ACABADOS sin duplicar
--   2) Servir tanto para ordenes nuevas como para backfill de ordenes ya en ACABADOS
--   3) No activar todavia CORTADOR

begin;

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
    and seed.modulo_responsable = 'ACABADOS'
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
      'Se sembraron %s proceso(s) de ACABADOS para la orden %s. Total actual: %s.',
      v_inserted,
      p_orden_id,
      v_total
    );
  else
    mensaje := format(
      'La orden %s ya tenia sembrados sus procesos de ACABADOS. Total actual: %s.',
      p_orden_id,
      v_total
    );
  end if;

  return next;
end;
$$;

grant execute on function public.ensure_orden_procesos_acabados(bigint) to authenticated;

commit;
