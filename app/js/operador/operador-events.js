export function bindOperadorEvents(deps) {
  const {
    el,
    debounce,
    unlockAudio,
    loadTrabajos,
    getPendientesState,
    setPendientesState,
    renderPendientesPage,
    startRegistro,
    openIncidentModal,
    pauseRegistro,
    resumeRegistro,
    stopRegistro,
    returnTrabajoAPlacas,
    setTab,
    loadHoy,
    closeModal,
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
  el("pendLimit")?.addEventListener("change", () => {
    const state = getPendientesState();
    state.pendientesPageSize = Number(el("pendLimit")?.value || 20);
    state.pendientesPage = 1;
    setPendientesState(state);
    renderPendientesPage();
  });
  el("btnPendPrev")?.addEventListener("click", () => {
    const state = getPendientesState();
    if (state.pendientesPage <= 1) return;
    state.pendientesPage -= 1;
    setPendientesState(state);
    renderPendientesPage();
  });
  el("btnPendNext")?.addEventListener("click", () => {
    const state = getPendientesState();
    const totalPages = Math.max(1, Math.ceil(state.filteredPendientes.length / state.pendientesPageSize));
    if (state.pendientesPage >= totalPages) return;
    state.pendientesPage += 1;
    setPendientesState(state);
    renderPendientesPage();
  });

  el("btnStart")?.addEventListener("click", startRegistro);
  el("btnOpenIncident")?.addEventListener("click", openIncidentModal);
  el("btnPause")?.addEventListener("click", pauseRegistro);
  el("btnResume")?.addEventListener("click", resumeRegistro);
  el("btnStop")?.addEventListener("click", stopRegistro);
  el("btnReturnPlacas")?.addEventListener("click", returnTrabajoAPlacas);

  el("tabPend")?.addEventListener("click", () => setTab("pend"));
  el("tabHoy")?.addEventListener("click", async () => {
    setTab("hoy");
    await loadHoy();
  });
  el("btnReloadHoy")?.addEventListener("click", loadHoy);

  el("btnModalClose")?.addEventListener("click", closeModal);
  el("btnIncidentClose")?.addEventListener("click", closeIncidentModal);
  el("modalWrap")?.addEventListener("click", (ev) => {
    if (ev.target && ev.target.id === "modalWrap") closeModal();
  });
  el("incidentWrap")?.addEventListener("click", (ev) => {
    if (ev.target && ev.target.id === "incidentWrap") closeIncidentModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}
