import { escapeHtml } from "../utils/helpers.js";

function parseRouteProcesos(raw) {
  let data = raw;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      data = null;
    }
  }
  return Array.isArray(data) ? data : [];
}

function formatRouteEntryLabel(row, entry) {
  const key = String(entry?.key || "").trim();
  switch (key) {
    case "corte": return "Corte";
    case "empaquetado": return "Empaquetado";
    case "doblez": return "Doblez";
    case "compaginado": return "Compaginado";
    case "troquelado": return "Troquelado";
    case "sectorizado": return "Sectorizado";
    case "barniz": return "Barniz";
    case "plastificado": {
      const mode = String(entry?.variant || row?.plastificado || "").trim().toUpperCase();
      return mode ? `Plastificado (${mode})` : "Plastificado";
    }
    case "encolado": return "Encolado";
    case "marcado": return "Marcado";
    case "anillado": return "Anillado";
    case "perforado": {
      const tipo = String(entry?.variant || row?.perforado_tipo || "").trim().toUpperCase();
      return tipo === "PICADO_PERFORADO" ? "Perforado (Picado/Perforado)" : "Perforado";
    }
    case "pegado_solapa": return "Pegado solapa";
    case "semi_corte": return "Semi corte";
    case "enumerado": return "Enumerado";
    default: return "";
  }
}

function getFallbackProcesosAcabados(row) {
  const list = [];
  if (row?.corte) list.push("Corte");
  if (row?.empaquetado) list.push("Empaquetado");
  if (row?.doblez) list.push("Doblez");
  if (row?.compaginado) list.push("Compaginado");
  if (row?.troquelado) list.push("Troquelado");
  if (row?.sectorizado) list.push("Sectorizado");
  if (row?.barniz) list.push("Barniz");
  if (row?.plastificado) list.push(`Plastificado (${row.plastificado})`);
  if (row?.encolado) list.push("Encolado");
  if (row?.marcado) list.push("Marcado");
  if (row?.anillado) list.push("Anillado");
  if (row?.perforado) {
    list.push(
      row?.perforado_tipo === "PICADO_PERFORADO"
        ? "Perforado (Picado/Perforado)"
        : "Perforado"
    );
  }
  if (row?.pegado_solapa) list.push("Pegado solapa");
  if (row?.semi_corte) list.push("Semi corte");
  if (row?.enumerado) list.push("Enumerado");
  return list;
}

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
  const route = parseRouteProcesos(row?.ruta_procesos)
    .sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0));
  const list = route.length
    ? route.map((entry) => formatRouteEntryLabel(row, entry)).filter(Boolean)
    : getFallbackProcesosAcabados(row);
  return list.length ? list.join(" | ") : "-";
}

export function renderRouteStatusPill(row) {
  const label = String(row?.route_badge_label || "").trim();
  if (!label) return `<span class="small muted">Seguimiento en detalle</span>`;

  const tone = String(row?.route_badge_tone || "ready").trim().toLowerCase();
  const toneClass = ({
    ready: "is-ready",
    printing: "is-printing",
    paused: "is-paused",
    cutting: "is-cutting",
    "cut-ready": "is-cut-ready",
    "route-ready": "is-route-ready",
    "route-active": "is-route-active",
    handoff: "is-handoff",
    done: "is-done"
  })[tone] || "is-ready";

  return `<span class="state-pill ${toneClass}">${escapeHtml(label)}</span>`;
}

export function renderProcesoActualCell(row) {
  const estado = String(row?.estado || "").trim().toUpperCase();
  const prodEstado = String(row?.produccion_estado || "").trim().toUpperCase();

  if (estado === "IMPRESION") {
    const primary = "Impresion";
    const secondary = prodEstado === "PAUSADO"
      ? "Pausado en operador"
      : "Trabajando en operador";
    return `
      <div><b>${escapeHtml(primary)}</b></div>
      <div class="small muted">${escapeHtml(secondary)}</div>
    `;
  }

  if (estado === "ACABADOS") {
    const primary = String(row?.route_stage_primary || "").trim() || "Ruta activa";
    const secondary = String(row?.route_stage_secondary || "").trim() || "Seguimiento de ruta";
    return `
      <div><b>${escapeHtml(primary)}</b></div>
      <div class="small muted">${escapeHtml(secondary)}</div>
    `;
  }

  if (estado === "DISENO") {
    return `
      <div><b>Diseno</b></div>
      <div class="small muted">Preparacion inicial</div>
    `;
  }

  if (estado === "PLACAS") {
    return `
      <div><b>Placas</b></div>
      <div class="small muted">Listo para operador</div>
    `;
  }

  if (estado === "TERMINADO") {
    return `
      <div><b>Terminado</b></div>
      <div class="small muted">Listo para entregar</div>
    `;
  }

  if (estado === "ENTREGADO") {
    return `
      <div><b>Entregado</b></div>
      <div class="small muted">Flujo cerrado</div>
    `;
  }

  return `<div class="small muted">-</div>`;
}
