-- Validacion para habilitar roles ACABADOS y CORTADOR
-- Ejecutar despues de:
--   db/migrations/2026-03-27_phase1_roles_acabados_cortador_enable.sql

-- 1) El enum debe contener los nuevos roles
select
  e.enumlabel
from pg_type t
join pg_enum e on e.enumtypid = t.oid
where t.typnamespace = 'public'::regnamespace
  and t.typname = 'rol_usuario'
  and e.enumlabel in ('ACABADOS', 'CORTADOR')
order by e.enumsortorder;

-- 2) El catalogo de roles_app debe quedar habilitado
select
  code,
  nombre,
  home_path,
  ui_enabled
from public.roles_app
where code in ('ACABADOS', 'CORTADOR')
order by code;
