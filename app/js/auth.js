import { supabase } from "./supabaseClient.js";

export function getProfileDisplayName(prof){
  return String(prof?.nombre_completo || prof?.username || "").trim();
}

export async function getMyProfile(){
  const { data: { user } } = await supabase.auth.getUser();
  if(!user) return null;

  let { data, error } = await supabase
    .from("profiles")
    .select("rol, username, nombre_completo")
    .eq("id", user.id)
    .single();

  // Backward-compat: some DB snapshots may not have nombre_completo yet.
  if(error){
    const fb = await supabase
      .from("profiles")
      .select("rol, username")
      .eq("id", user.id)
      .single();
    if(fb.error) throw fb.error;
    data = { ...fb.data, nombre_completo: null };
  }
  return data;
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

  if(prof.rol === "ADMIN") window.location.href = "./admin.html";
  else window.location.href = "./operador.html";
}

export async function logout(){
  await supabase.auth.signOut();
}

// Solo para páginas protegidas (admin/operador)
export async function requireAdmin(){
  const { data: { user } } = await supabase.auth.getUser();
  if(!user){ window.location.href="./login.html"; return null; }

  let prof = null;
  try{
    prof = await getMyProfile();
  }catch{
    window.location.href="./login.html";
    return null;
  }
  if(!prof){ window.location.href="./login.html"; return null; }

  if(prof.rol !== "ADMIN"){ window.location.href="./operador.html"; return null; }
  return prof;
}

export async function requireOperador(){
  const { data: { user } } = await supabase.auth.getUser();
  if(!user){ window.location.href="./login.html"; return null; }

  let prof = null;
  try{
    prof = await getMyProfile();
  }catch{
    window.location.href="./login.html";
    return null;
  }
  if(!prof){ window.location.href="./login.html"; return null; }

  if(prof.rol === "ADMIN"){ window.location.href="./admin.html"; return null; }
  return { user, prof };
}
