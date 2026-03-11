-- Fix: bloquear trabajo simultaneo en el mismo juego (par T+R)
-- Regla: en un juego (ej. 3A/3B) solo puede haber un lado ACTIVO a la vez.
-- El otro lado se puede iniciar recien cuando el primero termina.

begin;

-- 1) Enforce at DB level: un solo registro abierto por orden+juego
drop index if exists public.uq_registro_activo_por_juego_cara;

create unique index if not exists uq_registro_activo_por_juego
  on public.registro_produccion (orden_id, juego_num)
  where hora_fin is null and juego_num is not null;

-- 2) Endurecer RPC para dar mensaje claro y bloquear inicio invalido
create or replace function public.iniciar_trabajo_juego(
  p_orden_id bigint,
  p_juego_num integer,
  p_cara text,
  p_maquina_id bigint default null
)
returns table (
  registro_id bigint,
  orden_id bigint,
  juego_num integer,
  cara text,
  estado_registro text,
  nuevo_estado text,
  mensaje text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_cara text := upper(trim(coalesce(p_cara, '')));
  v_otra_cara text;
  v_orden_juego_id bigint;
  v_estado_orden text;
  v_estado_lado_actual text;
begin
  if v_user is null then
    raise exception 'Usuario no autenticado.';
  end if;

  if p_orden_id is null or p_orden_id <= 0 then
    raise exception 'orden_id invalido.';
  end if;

  if p_juego_num is null or p_juego_num <= 0 then
    raise exception 'juego_num invalido.';
  end if;

  if v_cara not in ('TIRA', 'RETIRA') then
    raise exception 'cara invalida. Usa TIRA o RETIRA.';
  end if;

  select o.estado::text into v_estado_orden
  from public.ordenes o
  where o.id = p_orden_id
  limit 1;

  if v_estado_orden is null then
    raise exception 'La orden % no existe.', p_orden_id;
  end if;

  if upper(v_estado_orden) in ('ENTREGADO', 'TERMINADO') then
    raise exception 'La orden % ya no admite inicio de impresion.', p_orden_id;
  end if;

  select j.id, j.estado
    into v_orden_juego_id, v_estado_lado_actual
  from public.orden_juegos_tr j
  where j.orden_id = p_orden_id
    and j.juego_num = p_juego_num
    and j.cara = v_cara
  limit 1;

  if v_orden_juego_id is null then
    raise exception 'No existe juego/cara para orden %, juego %, cara %.', p_orden_id, p_juego_num, v_cara;
  end if;

  if coalesce(v_estado_lado_actual, '') = 'FINALIZADO' then
    raise exception 'Ese lado del juego ya esta FINALIZADO.';
  end if;

  if exists (
    select 1
    from public.registro_produccion rp
    where rp.user_id = v_user
      and rp.hora_fin is null
  ) then
    raise exception 'Ya tienes un registro activo. Finalizalo o pausalo antes de iniciar otro.';
  end if;

  -- Bloqueo fuerte por juego: si cualquier lado del mismo juego esta abierto, no inicia otro.
  if exists (
    select 1
    from public.registro_produccion rp
    where rp.orden_id = p_orden_id
      and rp.juego_num = p_juego_num
      and rp.hora_fin is null
  ) then
    raise exception 'Ese juego ya tiene un lado en proceso. Finaliza ese lado antes de iniciar el otro.';
  end if;

  -- Validacion secuencial del par: solo una cara activa por vez y sin reabrir lado cerrado.
  v_otra_cara := case when v_cara = 'TIRA' then 'RETIRA' else 'TIRA' end;
  if exists (
    select 1
    from public.orden_juegos_tr j
    where j.orden_id = p_orden_id
      and j.juego_num = p_juego_num
      and j.cara = v_otra_cara
      and j.estado = 'EN_PROCESO'
  ) then
    raise exception 'La cara opuesta de este juego esta EN_PROCESO.';
  end if;

  insert into public.registro_produccion (
    orden_id,
    user_id,
    maquina_id,
    hora_inicio,
    estado_registro,
    orden_juego_id,
    juego_num,
    cara_impresion
  )
  values (
    p_orden_id,
    v_user,
    p_maquina_id,
    now(),
    'ACTIVO',
    v_orden_juego_id,
    p_juego_num,
    v_cara
  )
  returning id into registro_id;

  update public.orden_juegos_tr
  set estado = 'EN_PROCESO'
  where id = v_orden_juego_id
    and estado <> 'FINALIZADO';

  update public.ordenes
  set estado = 'IMPRESION'
  where id = p_orden_id
    and upper(estado::text) in ('DISENO', 'PLACAS', 'IMPRESION');

  orden_id := p_orden_id;
  juego_num := p_juego_num;
  cara := v_cara;
  estado_registro := 'ACTIVO';
  nuevo_estado := 'IMPRESION';
  mensaje := format('Registro iniciado para juego %s %s.', p_juego_num, v_cara);
  return next;
end;
$$;

grant execute on function public.iniciar_trabajo_juego(bigint, integer, text, bigint) to authenticated;

commit;
