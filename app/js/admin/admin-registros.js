export function syncRegsPresetChips(currentPreset) {
  const current = currentPreset || "today";
  document.querySelectorAll("#rgQuickPresets .regs-chip").forEach((chip) => {
    const active = chip.getAttribute("data-rg-preset") === current;
    chip.classList.toggle("is-active", active);
  });
}

export function createLiveDurationHelpers() {
  let liveDurationInterval = null;

  function formatDurationMinutes(start, end = null) {
    const startDate = start ? new Date(start) : null;
    if (!startDate || Number.isNaN(startDate.getTime())) return "-";
    const endDate = end ? new Date(end) : new Date();
    if (Number.isNaN(endDate.getTime())) return "-";
    const diffMs = Math.max(0, endDate.getTime() - startDate.getTime());
    const totalMin = Math.floor(diffMs / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h <= 0) return `${m} min`;
    return `${h}h ${String(m).padStart(2, "0")}m`;
  }

  function refreshLiveDurationLabels() {
    document.querySelectorAll("[data-live-start]").forEach((node) => {
      const start = node.getAttribute("data-live-start");
      if (!start) return;
      node.textContent = formatDurationMinutes(start);
    });
  }

  function ensureLiveDurationTicker() {
    if (liveDurationInterval) return;
    liveDurationInterval = setInterval(refreshLiveDurationLabels, 30000);
  }

  return { formatDurationMinutes, refreshLiveDurationLabels, ensureLiveDurationTicker };
}
