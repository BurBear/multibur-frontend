import { supabase } from "../supabaseClient.js";

export const ROLE_HOME = Object.freeze({
  ADMIN: "./admin.html",
  OPERADOR: "./operador.html",
  ACABADOS: "./acabados.html",
  CORTADOR: "./cortador.html"
});

export const ROLE_CAPABILITIES = Object.freeze({
  ADMIN: Object.freeze([
    "app.access",
    "board.admin",
    "orders.create",
    "orders.edit",
    "orders.advance",
    "orders.deliver",
    "reports.view",
    "catalogs.manage"
  ]),
  OPERADOR: Object.freeze([
    "app.access",
    "board.operador",
    "production.start",
    "production.pause",
    "production.resume",
    "production.stop",
    "production.return"
  ]),
  ACABADOS: Object.freeze([
    "app.access",
    "board.acabados",
    "finishing.start",
    "finishing.pause",
    "finishing.resume",
    "finishing.stop"
  ]),
  CORTADOR: Object.freeze([
    "app.access",
    "board.cortador",
    "cutting.start",
    "cutting.pause",
    "cutting.resume",
    "cutting.stop"
  ])
});

export function normalizeRole(role) {
  return String(role || "").trim().toUpperCase();
}

export function getRoleHome(role) {
  const normalized = normalizeRole(role);
  return Object.prototype.hasOwnProperty.call(ROLE_HOME, normalized)
    ? ROLE_HOME[normalized]
    : null;
}

export function can(roleOrProfile, capability) {
  const role = typeof roleOrProfile === "string"
    ? normalizeRole(roleOrProfile)
    : normalizeRole(roleOrProfile?.rol);
  if (!role || !capability) return false;
  return (ROLE_CAPABILITIES[role] || []).includes(capability);
}

function normalizeProfile(data) {
  if (!data) return null;
  return {
    ...data,
    rol: normalizeRole(data.rol)
  };
}

function buildRolePendingLocation(role, loginPath) {
  const params = new URLSearchParams();
  params.set("reason", "role-not-enabled");
  if (role) params.set("role", normalizeRole(role));
  return `${loginPath}?${params.toString()}`;
}

export async function getCurrentProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  let { data, error } = await supabase
    .from("profiles")
    .select("rol, username, nombre_completo")
    .eq("id", user.id)
    .single();

  // Backward-compat: some DB snapshots may not have nombre_completo yet.
  if (error) {
    const fb = await supabase
      .from("profiles")
      .select("rol, username")
      .eq("id", user.id)
      .single();
    if (fb.error) throw fb.error;
    data = { ...fb.data, nombre_completo: null };
  }

  return normalizeProfile(data);
}

export async function requireRole(allowedRoles, { loginPath = "./login.html" } = {}) {
  const normalizedAllowed = (Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles])
    .map(normalizeRole)
    .filter(Boolean);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    window.location.href = loginPath;
    return null;
  }

  let prof = null;
  try {
    prof = await getCurrentProfile();
  } catch {
    window.location.href = loginPath;
    return null;
  }

  if (!prof) {
    window.location.href = loginPath;
    return null;
  }

  if (!normalizedAllowed.length || normalizedAllowed.includes(prof.rol)) {
    return { user, prof };
  }

  const roleHome = getRoleHome(prof.rol);
  window.location.href = roleHome || buildRolePendingLocation(prof.rol, loginPath);
  return null;
}
