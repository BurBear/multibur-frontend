export function bindOperadorEvents(deps) {
  const {
    el,
    debounce,
    unlockAudio,
    loadTrabajos,
    startRegistro,
    openPauseModal,
    openIncidentModal,
    saveIncident,
    pauseRegistro,
    stopRegistro,
    returnTrabajoAPlacas,
    syncActionState,
    onJuegoCaraChange,
    setTab,
    loadHoy,
    closeModal,
    closePauseModal,
    closeIncidentModal,
    logout
  } = deps;

  el("btnLogout")?.addEventListener("click", async () => {
    await logout();
    window.location.href = "./login.html";
  });

  ["click", "keydown", "pointerdown"].forEach((evt) => {
    document.addEventListener(evt, unlockAudio, { once: true, passive: true });
  });

  el("btnReload")?.addEventListener("click", loadTrabajos);
  el("q")?.addEventListener("input", debounce(loadTrabajos, 250));

  el("btnStart")?.addEventListener("click", startRegistro);
  el("btnPause")?.addEventListener("click", openPauseModal);
  el("btnSavePause")?.addEventListener("click", pauseRegistro);
  el("btnOpenIncident")?.addEventListener("click", openIncidentModal);
  el("btnSaveIncident")?.addEventListener("click", saveIncident);
  el("btnStop")?.addEventListener("click", stopRegistro);
  el("btnReturnPlacas")?.addEventListener("click", returnTrabajoAPlacas);
  el("juegoCara")?.addEventListener("change", onJuegoCaraChange);
  el("good")?.addEventListener("input", syncActionState);
  el("bad")?.addEventListener("input", syncActionState);

  el("tabPend")?.addEventListener("click", () => setTab("pend"));
  el("tabHoy")?.addEventListener("click", async () => {
    setTab("hoy");
    await loadHoy();
  });
  el("btnReloadHoy")?.addEventListener("click", loadHoy);

  el("btnModalClose")?.addEventListener("click", closeModal);
  el("btnPauseClose")?.addEventListener("click", closePauseModal);
  el("btnIncidentClose")?.addEventListener("click", closeIncidentModal);
}
