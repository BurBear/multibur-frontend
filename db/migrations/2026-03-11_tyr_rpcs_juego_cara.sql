-- Migration: RPCs for T+R by juego + cara
-- Requires: 2026-03-11_tyr_juegos_base.sql already applied

begin;

-- Start trabajo by specific game side (TIRA/RETIRA)
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
  v_orden_juego_id bigint;
  v_estado_orden text;
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

  select j.id
    into v_orden_juego_id
  from public.orden_juegos_tr j
  where j.orden_id = p_orden_id
    and j.juego_num = p_juego_num
    and j.cara = v_cara
  limit 1;

  if v_orden_juego_id is null then
    raise exception 'No existe juego/cara para orden %, juego %, cara %.', p_orden_id, p_juego_num, v_cara;
  end if;

  if exists (
    select 1
    from public.registro_produccion rp
    where rp.user_id = v_user
      and rp.hora_fin is null
  ) then
    raise exception 'Ya tienes un registro activo. Finalizalo o pausalo antes de iniciar otro.';
  end if;

  if exists (
    select 1
    from public.registro_produccion rp
    where rp.orden_id = p_orden_id
      and rp.juego_num = p_juego_num
      and rp.cara_impresion = v_cara
      and rp.hora_fin is null
  ) then
    raise exception 'Ese juego/cara ya esta siendo trabajado por otro operador.';
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

-- Finish trabajo by game side and optionally move order to ACABADOS if all sides are done
create or replace function public.finalizar_trabajo_juego(
  p_registro_id bigint,
  p_buena integer,
  p_mala integer default 0,
  p_observaciones text default null
)
returns table (
  registro_id bigint,
  orden_id bigint,
  juego_num integer,
  cara text,
  buena integer,
  mala integer,
  nuevo_estado text,
  mensaje text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_orden_id bigint;
  v_juego_num integer;
  v_cara text;
  v_orden_juego_id bigint;
  v_all_done boolean;
begin
  if v_user is null then
    raise exception 'Usuario no autenticado.';
  end if;

  if p_registro_id is null or p_registro_id <= 0 then
    raise exception 'registro_id invalido.';
  end if;

  if p_buena is not null and p_buena < 0 then
    raise exception 'Cantidad buena invalida.';
  end if;

  if p_mala is not null and p_mala < 0 then
    raise exception 'Cantidad mala invalida.';
  end if;

  select
    rp.orden_id,
    rp.juego_num,
    rp.cara_impresion,
    rp.orden_juego_id
  into
    v_orden_id,
    v_juego_num,
    v_cara,
    v_orden_juego_id
  from public.registro_produccion rp
  where rp.id = p_registro_id
    and rp.user_id = v_user
    and rp.hora_fin is null
  limit 1;

  if v_orden_id is null then
    raise exception 'No existe registro activo para finalizar (o no pertenece al usuario actual).';
  end if;

  update public.registro_produccion
  set
    hora_fin = now(),
    cantidad_buena = p_buena,
    cantidad_mala = coalesce(p_mala, 0),
    buena_reportada = p_buena,
    mala_reportada = coalesce(p_mala, 0),
    observaciones = coalesce(p_observaciones, observaciones),
    estado_registro = 'FINALIZADO'
  where id = p_registro_id;

  if v_orden_juego_id is not null then
    update public.orden_juegos_tr
    set estado = 'FINALIZADO'
    where id = v_orden_juego_id;
  end if;

  select not exists (
    select 1
    from public.orden_juegos_tr j
    where j.orden_id = v_orden_id
      and j.estado <> 'FINALIZADO'
  ) into v_all_done;

  if v_all_done then
    update public.ordenes
    set estado = 'ACABADOS'
    where id = v_orden_id
      and upper(estado::text) <> 'ENTREGADO';
    nuevo_estado := 'ACABADOS';
  else
    update public.ordenes
    set estado = 'IMPRESION'
    where id = v_orden_id
      and upper(estado::text) in ('DISENO', 'PLACAS', 'IMPRESION');
    nuevo_estado := 'IMPRESION';
  end if;

  registro_id := p_registro_id;
  orden_id := v_orden_id;
  juego_num := v_juego_num;
  cara := v_cara;
  buena := p_buena;
  mala := coalesce(p_mala, 0);
  mensaje := format('Registro finalizado para juego %s %s.', v_juego_num, v_cara);
  return next;
end;
$$;

grant execute on function public.iniciar_trabajo_juego(bigint, integer, text, bigint) to authenticated;
grant execute on function public.finalizar_trabajo_juego(bigint, integer, integer, text) to authenticated;

commit;
