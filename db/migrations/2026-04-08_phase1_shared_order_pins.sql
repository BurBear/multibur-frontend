begin;

-- ============================================================================
-- Anclado compartido de ordenes
-- - Permite que el anclado sea visible para cualquier admin/sesion
-- - Reutilizable por ADMIN, OPERADOR, ACABADOS y CORTADOR
-- - El orden de prioridad se conserva por fecha de anclado
-- ============================================================================

create table if not exists public.ordenes_ancladas (
  orden_id bigint primary key
    references public.ordenes(id)
    on delete cascade,
  pinned_at timestamptz not null default now(),
  pinned_by uuid null,
  created_at timestamptz not null default now()
);

comment on table public.ordenes_ancladas is
'Ordenes ancladas de forma compartida para priorizar su visibilidad en los tableros operativos.';

comment on column public.ordenes_ancladas.pinned_at is
'Momento en que la orden fue anclada. Determina el orden de prioridad global entre anclados.';

comment on column public.ordenes_ancladas.pinned_by is
'Usuario autenticado que anclo la orden por ultima vez que fue insertada.';

create or replace function public.get_ordenes_ancladas()
returns table (
  orden_id bigint,
  pinned_at timestamptz,
  pinned_by uuid
)
language sql
security definer
set search_path = public
as $$
  select
    oa.orden_id,
    oa.pinned_at,
    oa.pinned_by
  from public.ordenes_ancladas oa
  order by oa.pinned_at asc, oa.orden_id asc;
$$;

create or replace function public.set_orden_anclada(
  p_orden_id bigint,
  p_pin boolean default true
)
returns table (
  orden_id bigint,
  is_pinned boolean,
  pinned_at timestamptz,
  pinned_by uuid
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Usuario no autenticado.';
  end if;

  if p_orden_id is null or p_orden_id <= 0 then
    raise exception 'orden_id invalido.';
  end if;

  if not exists (
    select 1
    from public.ordenes o
    where o.id = p_orden_id
  ) then
    raise exception 'La orden % no existe.', p_orden_id;
  end if;

  if coalesce(p_pin, true) then
    insert into public.ordenes_ancladas (
      orden_id,
      pinned_at,
      pinned_by
    )
    values (
      p_orden_id,
      now(),
      v_user
    )
    on conflict on constraint ordenes_ancladas_pkey do nothing;

    return query
    select
      oa.orden_id,
      true as is_pinned,
      oa.pinned_at,
      oa.pinned_by
    from public.ordenes_ancladas oa
    where oa.orden_id = p_orden_id;

    return;
  end if;

  delete from public.ordenes_ancladas oa
  where oa.orden_id = p_orden_id;

  return query
  select
    p_orden_id,
    false as is_pinned,
    null::timestamptz as pinned_at,
    null::uuid as pinned_by;
end;
$$;

grant execute on function public.get_ordenes_ancladas() to authenticated;
grant execute on function public.set_orden_anclada(bigint, boolean) to authenticated;

commit;
