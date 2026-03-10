export function syncStatusBanner({ el, activeRegistro, isPausedRegistro, esc }) {
  const banner = el("statusBanner");
  const incBanner = el("incidentBanner");
  if (!banner) return;

  banner.classList.toggle("is-paused", !!activeRegistro && isPausedRegistro(activeRegistro));
  if (incBanner) incBanner.classList.toggle("is-paused", !!activeRegistro && isPausedRegistro(activeRegistro));

  if (!activeRegistro) {
    banner.innerHTML = "<strong>Trabajo listo para iniciar</strong>Completa la maquina y luego inicia. Si surge una incidencia, registrala antes de pausar o devolver.";
    if (incBanner) incBanner.innerHTML = "<strong>Registrar incidencia</strong>Primero registra el motivo. Luego decide si el trabajo debe pausarse, reanudarse o volver a PLACAS.";
    return;
  }

  if (isPausedRegistro(activeRegistro)) {
    const motivo = activeRegistro.motivo_incidencia || "-";
    banner.innerHTML = `<strong>Trabajo pausado</strong>Motivo: ${esc(motivo)}. Resuelve la incidencia y presiona REANUDAR para continuar. Si no se puede seguir, devuelve a PLACAS.`;
    if (incBanner) incBanner.innerHTML = `<strong>Trabajo pausado</strong>Motivo: ${esc(motivo)}. Reanuda si ya resolviste el problema o devuelve a PLACAS si no se puede continuar.`;
    return;
  }

  banner.innerHTML = "<strong>Trabajo en curso</strong>La impresion esta activa. Si surge un problema, registra la incidencia y pausa. Cuando termine, finaliza con cantidades.";
  if (incBanner) incBanner.innerHTML = "<strong>Trabajo en curso</strong>Si aparece una incidencia, registrala y pausa. Si ya estaba pausado y se resolvio, reanuda antes de finalizar.";
}
