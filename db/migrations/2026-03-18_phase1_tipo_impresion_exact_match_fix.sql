-- FIX FASE 1
-- Evita que compat_enum_label confunda TIRA_RETIRA con TIRA+RETIRA.
-- Primero intenta match exacto/case-insensitive y solo luego usa la normalizacion legacy.

begin;

create or replace function public.compat_enum_label(
  p_target_type regtype,
  p_value text,
  p_default text default null
)
returns text
language sql
stable
as $$
  with desired as (
    select coalesce(nullif(trim(p_value), ''), nullif(trim(p_default), '')) as source_value
  ),
  labels as (
    select e.enumlabel
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.oid = p_target_type
  ),
  exact_match as (
    select l.enumlabel
    from desired d
    join labels l
      on upper(trim(l.enumlabel)) = upper(trim(d.source_value))
    limit 1
  ),
  normalized_match as (
    select l.enumlabel
    from desired d
    join labels l
      on upper(regexp_replace(translate(
           l.enumlabel,
           U&'\00C1\00C9\00CD\00D3\00DA\00DC\00D1\00E1\00E9\00ED\00F3\00FA\00FC\00F1',
           'AEIOUUNAEIOUUN'
         ), '[^A-Z0-9]+', '', 'g'))
       = upper(regexp_replace(translate(
           d.source_value,
           U&'\00C1\00C9\00CD\00D3\00DA\00DC\00D1\00E1\00E9\00ED\00F3\00FA\00FC\00F1',
           'AEIOUUNAEIOUUN'
         ), '[^A-Z0-9]+', '', 'g'))
    limit 1
  )
  select coalesce(
    (select enumlabel from exact_match),
    (select enumlabel from normalized_match),
    (select source_value from desired)
  );
$$;

grant execute on function public.compat_enum_label(regtype, text, text) to authenticated;

commit;
