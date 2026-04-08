begin;

-- Corrige ambiguedad en set_orden_anclada causada por RETURNS TABLE
-- donde orden_id pasa a existir tambien como variable de salida PL/pgSQL.

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

grant execute on function public.set_orden_anclada(bigint, boolean) to authenticated;

commit;
