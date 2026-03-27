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
  const hasLegacyIncidencia = String(incidencia.motivo_incidencia || "").trim() || String(incidencia.obs_incidencia || "").trim();
  if ((incidencia.estado_registro === "PAUSADO" || incidencia.estado_registro === "DEVUELTO") && hasLegacyIncidencia) {
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
  if (row?.encolado) list.push("Encolado");
  if (row?.marcado) list.push("Marcado");
  if (row?.anillado) list.push("Anillado");
  if (row?.perforado) {
    list.push(
      row?.perforado_tipo === "PICADO_PERFORADO"
        ? "Perforado: Picado/Perforado"
        : "Perforado"
    );
  }
  if (row?.pegado_solapa) list.push("Pegado solapa");
  if (row?.semi_corte) list.push("Semi corte");
  if (row?.enumerado) list.push("Enumerado");
  return list.length ? list.join(" | ") : "-";
}

// Reserved for future UI enhancements.
