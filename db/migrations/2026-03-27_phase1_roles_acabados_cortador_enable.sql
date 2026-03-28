-- Habilita roles ACABADOS y CORTADOR en el enum legacy de profiles
-- Ejecutar sin envolver en BEGIN/COMMIT.
-- Motivo:
--   profiles.rol sigue usando el enum rol_usuario legacy y por eso falla
--   al intentar insertar usuarios con rol = 'ACABADOS' o 'CORTADOR'.

alter type public.rol_usuario add value if not exists 'ACABADOS';
alter type public.rol_usuario add value if not exists 'CORTADOR';

update public.roles_app
set
  home_path = './acabados.html',
  ui_enabled = true,
  updated_at = now()
where code = 'ACABADOS';

update public.roles_app
set
  home_path = './cortador.html',
  ui_enabled = true,
  updated_at = now()
where code = 'CORTADOR';
