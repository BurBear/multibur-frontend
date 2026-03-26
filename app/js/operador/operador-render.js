export function syncStatusBanner({ el, activeRegistro, isPausedRegistro, esc, selectedPausedRegistro = null }) {
  const banner = el("statusBanner");
  const incBanner = el("incidentBanner");
  if (!banner) return;

  const jobLabel = String(el("selJob")?.textContent || "").trim();
  const estadoLabel = String(el("selEstado")?.textContent || "").trim();
  const hasSelection = !!jobLabel && jobLabel !== "Ninguno";
  const chips = [];
  if (hasSelection) chips.push(`<span class="status-pill">${esc(jobLabel)}</span>`);
  if (estadoLabel && estadoLabel !== "-") chips.push(`<span class="status-pill">${esc(estadoLabel)}</span>`);
  const chipsHtml = chips.length ? `<div class="status-summary">${chips.join("")}</div>` : "";

  banner.classList.add("status-banner-compact");
  banner.classList.remove("is-ready", "is-live", "is-idle");
  banner.classList.toggle("is-paused", !!activeRegistro && isPausedRegistro(activeRegistro));
  if (incBanner) incBanner.classList.toggle("is-paused", !!activeRegistro && isPausedRegistro(activeRegistro));

  if (!activeRegistro && selectedPausedRegistro) {
    banner.innerHTML = `<strong>TRABAJO PAUSADO</strong>${chipsHtml}`;
    if (incBanner) {
      incBanner.innerHTML = "<strong>Pausa operativa e incidencia</strong>Si solo cambiaras de trabajo, puedes pausar sin llenar campos. Si hubo un problema real, registralo por separado antes o durante la pausa.";
    }
    return;
  }

  if (!activeRegistro) {
    banner.classList.toggle("is-ready", hasSelection);
    banner.classList.toggle("is-idle", !hasSelection);
    banner.innerHTML = `<strong>${hasSelection ? "TRABAJO LISTO" : "SIN TRABAJO"}</strong>${chipsHtml}`;
    if (incBanner) incBanner.innerHTML = "<strong>Pausa operativa e incidencia</strong>Usa PAUSAR para dejar el trabajo retomable. Usa REGISTRAR INCIDENCIA solo si hubo un problema real del proceso.";
    return;
  }

  if (isPausedRegistro(activeRegistro)) {
    const motivo = activeRegistro.motivo_pausa || activeRegistro.motivo_incidencia || "-";
    banner.innerHTML = `<strong>TRABAJO PAUSADO</strong>${chipsHtml}`;
    if (incBanner) incBanner.innerHTML = `<strong>Trabajo pausado</strong>Motivo: ${esc(motivo)}. Reanuda si ya resolviste el problema o devuelve a PLACAS si no se puede continuar.`;
    return;
  }

  banner.classList.add("is-live");
  banner.innerHTML = `<strong>TRABAJO INICIADO</strong>${chipsHtml}`;
  if (incBanner) incBanner.innerHTML = "<strong>Trabajo en curso</strong>Si aparece una incidencia, registrala. Si solo necesitas dejar el trabajo retomable, usa PAUSAR.";
}
