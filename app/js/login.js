import { supabase } from "./supabaseClient.js";
import { getMyProfile, goByRole, logout, getProfileDisplayName } from "./auth.js";

const $ = (id) => document.getElementById(id);
const msg = (t) => ($("msg").textContent = t || "");

async function refreshUI() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    $("btnLogout").style.display = "none";
    $("btnGo").style.display = "none";
    return;
  }

  $("btnLogout").style.display = "block";
  $("btnGo").style.display = "block";

  try {
    const prof = await getMyProfile();
    msg(`Sesion activa: ${getProfileDisplayName(prof)}\nRol: ${prof.rol}\nPulsa "Ir al sistema".`);
  } catch (e) {
    msg("Sesion activa, pero no pude leer rol.\n" + (e.message || e));
  }
}

$("btnLogin").addEventListener("click", async () => {
  msg("");
  $("btnLogin").disabled = true;

  try {
    const email = $("email").value.trim();
    const password = $("pass").value;

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    await goByRole();
  } catch (e) {
    msg("Error login: " + (e.message || e));
  } finally {
    $("btnLogin").disabled = false;
  }
});

$("btnLogout").addEventListener("click", async () => {
  await logout();
  msg("Sesion cerrada.");
  await refreshUI();
});

$("btnGo").addEventListener("click", goByRole);

refreshUI();
