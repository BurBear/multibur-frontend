import { supabase } from "./supabaseClient.js";
import { getMyProfile, goByRole, logout } from "./auth.js";

const $ = (id) => document.getElementById(id);
const msg = (t) => ($("msg").textContent = t || "");
const REMEMBER_EMAIL_KEY = "multibur_login_email";

function setLoginFieldsDisabled(disabled) {
  if ($("email")) $("email").disabled = !!disabled;
  if ($("pass")) $("pass").disabled = !!disabled;
  if ($("btnLogin")) $("btnLogin").disabled = !!disabled;
  if ($("showPass")) $("showPass").disabled = !!disabled;
  if ($("rememberEmail")) $("rememberEmail").disabled = !!disabled;
}

function renderPasswordIcon(visible) {
  const icon = $("showPassIcon");
  if (!icon) return;
  if (visible) {
    icon.innerHTML = `
      <path d="M3 3l18 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M10.6 10.7a3.2 3.2 0 0 0 4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M9.2 5.6A11 11 0 0 1 12 5.2c6.5 0 10 6 10 6a18 18 0 0 1-3.6 4.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M6.2 6.2C3.8 7.8 2 10.8 2 10.8s3.5 6 10 6c1.3 0 2.5-.2 3.5-.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    `;
  } else {
    icon.innerHTML = `
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" stroke="currentColor" stroke-width="1.8"/>
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.8"/>
    `;
  }
}

function syncPasswordVisibility() {
  if (!$("pass") || !$("showPass")) return;
  const visible = $("showPass").dataset.visible === "true";
  $("pass").type = visible ? "text" : "password";
  $("showPass").setAttribute("aria-pressed", visible ? "true" : "false");
  renderPasswordIcon(visible);
}

function togglePasswordVisibility() {
  if (!$("showPass")) return;
  const nextVisible = $("showPass").dataset.visible !== "true";
  $("showPass").dataset.visible = nextVisible ? "true" : "false";
  syncPasswordVisibility();
}

function loadRememberedEmail() {
  const saved = window.localStorage.getItem(REMEMBER_EMAIL_KEY) || "";
  if ($("email")) $("email").value = saved;
  if ($("rememberEmail")) $("rememberEmail").checked = !!saved;
}

function persistRememberedEmail() {
  if (!$("rememberEmail") || !$("email")) return;
  if ($("rememberEmail").checked) {
    window.localStorage.setItem(REMEMBER_EMAIL_KEY, $("email").value.trim());
  } else {
    window.localStorage.removeItem(REMEMBER_EMAIL_KEY);
  }
}

async function refreshUI() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    $("btnLogout").style.display = "none";
    $("btnGo").style.display = "none";
    setLoginFieldsDisabled(false);
    return;
  }

  $("btnLogout").style.display = "block";
  $("btnGo").style.display = "block";
  setLoginFieldsDisabled(true);

  try {
    await getMyProfile();
    msg('Ya hay una sesion iniciada en este navegador.\nPulsa "Ir al sistema" para continuar o "Cerrar sesion" para cambiar de usuario.');
  } catch (e) {
    msg('Ya hay una sesion iniciada en este navegador.\nSi quieres cambiar de usuario, primero pulsa "Cerrar sesion".');
  }
}

$("btnLogin").addEventListener("click", async () => {
  msg("");
  setLoginFieldsDisabled(true);

  try {
    const email = $("email").value.trim();
    const password = $("pass").value;
    persistRememberedEmail();

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    await goByRole();
  } catch (e) {
    msg("Error login: " + (e.message || e));
  } finally {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) setLoginFieldsDisabled(false);
  }
});

$("btnLogout").addEventListener("click", async () => {
  await logout();
  if ($("email")) $("email").value = "";
  if ($("pass")) $("pass").value = "";
  msg("Sesion cerrada.");
  await refreshUI();
});

$("btnGo").addEventListener("click", goByRole);
$("showPass")?.addEventListener("click", togglePasswordVisibility);
$("rememberEmail")?.addEventListener("change", persistRememberedEmail);
$("email")?.addEventListener("input", () => {
  if ($("rememberEmail")?.checked) persistRememberedEmail();
});

loadRememberedEmail();
$("showPass") && ($("showPass").dataset.visible = "false");
syncPasswordVisibility();
refreshUI();
