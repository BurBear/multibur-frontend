import { escapeHtml } from "../utils/helpers.js";

export function renderPrioridadBadge(prio) {
  const p = String(prio || "NORMAL").toUpperCase();
  if (p === "URGENTE") return `<span class="prio-badge is-urgent">URGENTE</span>`;
  return `<span class="prio-badge">${escapeHtml(p)}</span>`;
}

export function renderPizarraBadges(prio, overdue) {
  const overdueHtml = overdue ? `<span class="prio-badge is-overdue">RETRASO</span>` : "";
  return `${renderPrioridadBadge(prio)} ${overdueHtml}`.trim();
}

export function renderOverdueBadge(overdue) {
  return overdue ? `<span class="prio-badge is-overdue">RETRASO</span>` : "";
}

export function renderIncidenciaBadge(incidencia) {
  if (!incidencia || !incidencia.estado_registro) return "";
  if (incidencia.estado_registro === "PAUSADO" || incidencia.estado_registro === "DEVUELTO") {
    const title = `Motivo: ${incidencia.motivo_incidencia || "-"}\nObs: ${incidencia.obs_incidencia || "-"}`;
    return `<span class="prio-badge is-urgent" title="${escapeHtml(title)}" style="cursor:help">INCIDENCIA</span>`;
  }
  return "";
}

export function getProcesosAcabadosText(row) {
  const list = [];
  if (row?.corte) list.push("Corte");
  if (row?.empaquetado) list.push("Empaquetado");
  if (row?.doblez) list.push("Doblez");
  if (row?.compaginado) list.push("Compaginado");
  if (row?.troquelado) list.push("Troquelado");
  if (row?.sectorizado) list.push("Sectorizado");
  if (row?.barniz) list.push("Barniz");
  if (row?.plastificado) list.push(`Plastificado: ${row.plastificado}`);
  return list.length ? list.join(" | ") : "-";
}

// Reserved for future UI enhancements.
