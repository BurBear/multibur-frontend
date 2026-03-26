import { supabase } from "./supabaseClient.js";
import { exitFullscreenIfActive } from "./fullscreen.js";
import {
  getCurrentProfile,
  getRoleHome,
  normalizeRole,
  requireRole as requireRoleGuard
} from "./security/roles.js";

export { ROLE_HOME, ROLE_CAPABILITIES, can, requireRole } from "./security/roles.js";

export function getProfileDisplayName(prof){
  return String(prof?.nombre_completo || prof?.username || "").trim();
}

export async function getMyProfile(){
  return getCurrentProfile();
}

function buildRolePendingLocation(role){
  const params = new URLSearchParams();
  params.set("reason", "role-not-enabled");
  if(role) params.set("role", normalizeRole(role));
  return `./login.html?${params.toString()}`;
}

export async function goByRole(){
  let prof = null;
  try{
    prof = await getMyProfile();
  }catch{
    window.location.href = "./login.html";
    return;
  }
  if(!prof) return;

  const home = getRoleHome(prof.rol);
  window.location.href = home || buildRolePendingLocation(prof.rol);
}

export async function logout(){
  await exitFullscreenIfActive();
  await supabase.auth.signOut();
}

// Solo para paginas protegidas (admin/operador por ahora).
export async function requireAdmin(){
  const session = await requireRoleGuard("ADMIN");
  if(!session) return null;
  return session.prof;
}

export async function requireOperador(){
  return requireRoleGuard("OPERADOR");
}
