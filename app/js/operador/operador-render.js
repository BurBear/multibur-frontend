export function syncStatusBanner({ el, activeRegistro, isPausedRegistro, esc, selectedPausedRegistro = null }) {
  const banner = el("statusBanner");
  const incBanner = el("incidentBanner");
  if (!banner) return;

  banner.classList.toggle("is-paused", !!activeRegistro && isPausedRegistro(activeRegistro));
  if (incBanner) incBanner.classList.toggle("is-paused", !!activeRegistro && isPausedRegistro(activeRegistro));

  if (!activeRegistro && selectedPausedRegistro) {
    const motivo = selectedPausedRegistro?.motivo_pausa || "-";
    banner.innerHTML = `<strong>Trabajo pausado disponible</strong>Este trabajo ya fue pausado y puede retomarse. Motivo de pausa: ${esc(motivo)}. Selecciona maquina y usa <b>RETOMAR</b>.`;
    if (incBanner) {
      incBanner.innerHTML = "<strong>Pausa operativa e incidencia</strong>Si solo cambiaras de trabajo, puedes pausar sin llenar campos. Si hubo un problema real, registralo por separado antes o durante la pausa.";
    }
    return;
  }

  if (!activeRegistro) {
    banner.innerHTML = "<strong>Trabajo listo para iniciar</strong>Completa la maquina y luego inicia. Si surge una incidencia real, registrala por separado antes de pausar o devolver.";
    if (incBanner) incBanner.innerHTML = "<strong>Pausa operativa e incidencia</strong>Usa PAUSAR para dejar el trabajo retomable. Usa REGISTRAR INCIDENCIA solo si hubo un problema real del proceso.";
    return;
  }

  if (isPausedRegistro(activeRegistro)) {
    const motivo = activeRegistro.motivo_pausa || activeRegistro.motivo_incidencia || "-";
    banner.innerHTML = `<strong>Trabajo pausado</strong>Motivo: ${esc(motivo)}. Resuelve la incidencia y presiona REANUDAR para continuar. Si no se puede seguir, devuelve a PLACAS.`;
    if (incBanner) incBanner.innerHTML = `<strong>Trabajo pausado</strong>Motivo: ${esc(motivo)}. Reanuda si ya resolviste el problema o devuelve a PLACAS si no se puede continuar.`;
    return;
  }

  banner.innerHTML = "<strong>Trabajo en curso</strong>La impresion esta activa. Si necesitas cambiar de trabajo, usa PAUSAR. Si surge un problema real, registra la incidencia por separado. Cuando termine, finaliza con cantidades.";
  if (incBanner) incBanner.innerHTML = "<strong>Trabajo en curso</strong>Si aparece una incidencia, registrala. Si solo necesitas dejar el trabajo retomable, usa PAUSAR.";
}
