import { getMyProfile, getProfileDisplayName, logout, requireRole } from "./auth.js";
import { initFullscreenToggle } from "./fullscreen.js";
import { fetchAcabadosBoardSnapshot, fetchCortadorBoardSnapshot } from "./services/api.js";

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || "";
}

function goTo(path) {
  window.location.href = path;
}

function setBadge(id, count = 0) {
  const el = document.getElementById(id);
  if (!el) return;
  const safeCount = Math.max(0, Number(count) || 0);
  el.hidden = safeCount <= 0;
  if (safeCount <= 0) {
    el.textContent = "0";
    return;
  }
  el.textContent = safeCount > 99 ? "99+" : String(safeCount);
}

function countVisibleOrders(rows = []) {
  return (rows || []).filter((order) =>
    ((Array.isArray(order?.procesos) && order.procesos.length > 0) || !!order?.requires_handoff)
  ).length;
}

async function syncModulePendingBadges(userId = null) {
  try {
    const [corteRows, acabadosRows] = await Promise.all([
      fetchCortadorBoardSnapshot({ userId }),
      fetchAcabadosBoardSnapshot({ userId })
    ]);

    setBadge("badgeCorte", countVisibleOrders(corteRows));
    setBadge("badgeAcabados", countVisibleOrders(acabadosRows));
  } catch (error) {
    console.warn("No pude cargar los contadores del selector CORTADOR.", error);
    setBadge("badgeCorte", 0);
    setBadge("badgeAcabados", 0);
  }
}

async function init() {
  const session = await requireRole("CORTADOR");
  if (!session) return;

  const profile = await getMyProfile().catch(() => session.prof);
  const display = getProfileDisplayName(profile) || profile?.rol || "CORTADOR";
  setText("userPill", display);
  initFullscreenToggle({ containerSelector: ".top-right", insertBeforeSelector: "#btnLogout" });
  await syncModulePendingBadges(session.user?.id || null);

  window.addEventListener("focus", () => {
    syncModulePendingBadges(session.user?.id || null);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      syncModulePendingBadges(session.user?.id || null);
    }
  });

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
