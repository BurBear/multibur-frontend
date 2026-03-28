import { getMyProfile, getProfileDisplayName, logout, requireRole } from "./auth.js";
import { initFullscreenToggle } from "./fullscreen.js";

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || "";
}

function goTo(path) {
  window.location.href = path;
}

async function init() {
  const session = await requireRole("CORTADOR");
  if (!session) return;

  const profile = await getMyProfile().catch(() => session.prof);
  const display = getProfileDisplayName(profile) || profile?.rol || "CORTADOR";
  setText("userPill", display);
  initFullscreenToggle({ containerSelector: ".top-right", insertBeforeSelector: "#btnLogout" });

  document.getElementById("cardCorte")?.addEventListener("click", () => {
    goTo("./cortador.html");
  });

  document.getElementById("cardAcabados")?.addEventListener("click", () => {
    goTo("./acabados.html");
  });

  document.getElementById("btnLogout")?.addEventListener("click", async () => {
    await logout();
    goTo("./login.html");
  });
}

init();
