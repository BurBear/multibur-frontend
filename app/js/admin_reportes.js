import { requireAdmin, logout, getProfileDisplayName } from "./auth.js";
import { fetchClientes, fetchReporteEntregados, fetchRegistros, fetchProfilesByIds, fetchMaquinasByIds, fetchOrdenesProduccionByIds, fetchOrdenJuegosByIds, fetchOrdenById } from "./api.js";
import { initFullscreenToggle } from "./fullscreen.js";
import { $, setText, debounce } from "./ui.js";
import { escapeHtml } from "./utils/helpers.js";
import { fmtEntrega, fmtDateTimePE } from "./utils/formatters.js";
import { fmtTipoImpresion } from "./admin/admin-orders.js";
import { renderPrioridadBadge } from "./admin/admin-render.js";

const msg = (t) => setText("msgReport", t || "");
let clientesCache = [];
let previewReqId = 0;
let activeTab = "entregados";
let reportOrdenLookup = new Map();

const esc = escapeHtml;
const fmtDTPE = fmtDateTimePE;

function buildPlacaFallback(juegoNum, cara) {
  const n = Number(juegoNum || 0);
  const c = String(cara || "").toUpperCase();
  if (!n || !c) return "";
  const suf = c === "TIRA" ? "A" : (c === "RETIRA" ? "B" : "");
  return `${c} ${n}${suf}`;
}

function normalizeTipoCliente(v) {
  const t = String(v || "").trim().toUpperCase();
  if (!t) return "";
  if (t.includes("SERVICIO")) return "SERVICIO";
  if (t.includes("DIRECTO")) return "DIRECTO";
  return t || "";
}

function syncRegsPresetChips() {
  const current = $("rgPreset")?.value || "today";
  document.querySelectorAll("#rgQuickPresets .regs-chip").forEach((chip) => {
    const active = chip.getAttribute("data-rg-preset") === current;
    chip.classList.toggle("is-active", active);
  });
}

function setActiveTab(tab) {
  activeTab = tab === "produccion" ? "produccion" : "entregados";
  const isEnt = activeTab === "entregados";
  $("tabBtnEntregados")?.classList.toggle("is-active", isEnt);
  $("tabBtnProduccion")?.classList.toggle("is-active", !isEnt);
  $("tabBtnEntregados")?.setAttribute("aria-selected", isEnt ? "true" : "false");
  $("tabBtnProduccion")?.setAttribute("aria-selected", !isEnt ? "true" : "false");
  $("tabEntregados")?.classList.toggle("is-active", isEnt);
  $("tabProduccion")?.classList.toggle("is-active", !isEnt);
}

function closeReportOrdenDetail() {
  $("reportOrdenDetailWrap")?.classList.add("hide");
}

function splitEntregaParts(value) {
  const raw = fmtEntrega(value);
  if (!raw || raw === "-") return { fecha: "-", hora: "" };
  const parts = String(raw).split(",");
  return {
    fecha: parts[0]?.trim() || raw,
    hora: parts.slice(1).join(",").trim()
  };
}

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

function formatRouteEntryLabel(det = {}, entry = {}) {
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
      const mode = String(entry?.variant || det?.plastificado || "").trim().toUpperCase();
      return mode ? `Plastificado (${mode})` : "Plastificado";
    }
    case "encolado": return "Encolado";
    case "marcado": return "Marcado";
    case "anillado": return "Anillado";
    case "perforado": {
      const tipo = String(entry?.variant || det?.perforado_tipo || "").trim().toUpperCase();
      return tipo === "PICADO_PERFORADO" ? "Perforado (Picado/Perforado)" : "Perforado";
    }
    case "pegado_solapa": return "Pegado solapa";
    case "semi_corte": return "Semi corte";
    case "enumerado": return "Enumerado";
    default: return "";
  }
}

function getReportAcabadosItems(det = {}) {
  const routeItems = parseRouteProcesos(det?.ruta_procesos)
    .sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0));
  if (routeItems.length) {
    return routeItems.map((entry) => formatRouteEntryLabel(det, entry)).filter(Boolean);
  }

  const items = [];
  if (det?.corte) items.push("Corte");
  if (det?.empaquetado) items.push("Empaquetado");
  if (det?.doblez) items.push("Doblez");
  if (det?.compaginado) items.push("Compaginado");
  if (det?.troquelado) items.push("Troquelado");
  if (det?.sectorizado) items.push("Sectorizado");
  if (det?.barniz) items.push("Barniz");
  const plastificado = String(det?.plastificado || "").trim();
  if (plastificado && plastificado.toUpperCase() !== "NINGUNO") {
    items.push(`Plastificado (${plastificado})`);
  }
  if (det?.encolado) items.push("Encolado");
  if (det?.marcado) items.push("Marcado");
  if (det?.anillado) items.push("Anillado");
  if (det?.perforado) {
    items.push(
      String(det?.perforado_tipo || "").trim().toUpperCase() === "PICADO_PERFORADO"
        ? "Perforado (Picado/Perforado)"
        : "Perforado"
    );
  }
  if (det?.pegado_solapa) items.push("Pegado solapa");
  if (det?.semi_corte) items.push("Semi corte");
  if (det?.enumerado) items.push("Enumerado");
  return items;
}

function renderReportEstadoBadge(estado) {
  const label = String(estado || "-").trim().toUpperCase() || "-";
  let cls = "";
  if (label.includes("IMPRES")) cls = " is-print";
  else if (label.includes("ACAB")) cls = " is-finish";
  else if (label.includes("PLAC")) cls = " is-plates";
  else if (label.includes("DIS")) cls = " is-design";
  else if (label.includes("ENTREG")) cls = " is-done";
  return `<span class="report-status${cls}">${esc(label)}</span>`;
}

function renderReportFlag(active, onLabel, offLabel) {
  return `<span class="report-flag ${active ? "is-on" : "is-off"}">${esc(active ? onLabel : offLabel)}</span>`;
}

function renderReportOrdenDetail(extra, fallback = null) {
  const det = Array.isArray(extra?.detalles_orden) ? extra.detalles_orden[0] : (extra?.detalles_orden || {});
  const maquinaRaw = Array.isArray(det?.maquina) ? det.maquina[0] : det?.maquina;
  const ordenLabel = fallback?.numero_orden_fisica || `#${fallback?.orden_id || extra?.id || "-"}`;
  const clienteNombre = extra?.cliente?.nombre || fallback?.cliente_nombre || "-";
  const clienteTipo = normalizeTipoCliente(extra?.cliente?.tipo_cliente || fallback?.cliente_tipo || "");
  const showCommercial = clienteTipo !== "SERVICIO";
  const entrega = splitEntregaParts(extra?.fecha_entrega);
  const formato = (det?.medida_ancho && det?.medida_alto)
    ? `${det.medida_ancho} x ${det.medida_alto}`
    : "-";
  const material = det?.papel_material
    ? `${det.papel_material}${det?.gramaje ? ` (${det.gramaje}g)` : ""}`
    : "-";
  const tipoImpresion = fmtTipoImpresion(det?.tipo_impresion || "-");
  const maquina = maquinaRaw?.nombre || "-";
  const color = det?.color_text || det?.color_mode || "-";
  const clienteDoc = [extra?.cliente?.doc_fiscal_tipo, extra?.cliente?.doc_fiscal_numero]
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .join(" ") || "-";
  const acabados = getReportAcabadosItems(det);
  const totalPlan = det?.cantidad_solicitada != null
    ? `${det.cantidad_solicitada}${det?.demasia != null ? ` + ${det.demasia} demasia` : ""}`
    : "-";
  const obsTecnica = String(det?.observacion_tecnica || "").trim() || "Sin observacion tecnica registrada.";
  const obsGeneral = String(extra?.observaciones_generales || "").trim() || "Sin observaciones generales registradas.";
  const obsOc = String(extra?.oc_observacion || "").trim() || "Sin observacion de OC.";
  const obsGuia = String(extra?.guia_observacion || "").trim() || "Sin observacion de guia.";
  return `
    <div class="report-order-shell">
      <section class="report-order-hero">
        <div class="report-order-hero-main">
          <div class="report-order-kicker">Orden de produccion</div>
          <div class="report-order-code">${esc(ordenLabel)}</div>
          <div class="report-order-work">${esc(extra?.descripcion_trabajo || fallback?.descripcion_trabajo || "-")}</div>
        </div>
        <div class="report-order-hero-side">
          ${renderReportEstadoBadge(extra?.estado)}
          ${renderPrioridadBadge(extra?.prioridad)}
          <span class="report-soft-chip">Maquina: ${esc(maquina)}</span>
        </div>
      </section>

      <section class="report-quick-grid">
        <article class="report-quick-card">
          <span class="report-quick-k">Cliente</span>
          <strong class="report-quick-v">${esc(clienteNombre)}</strong>
          <span class="report-quick-sub">${esc(extra?.cliente?.tipo_cliente || "-")} | ${esc(clienteDoc)}</span>
        </article>
        <article class="report-quick-card">
          <span class="report-quick-k">Entrega</span>
          <strong class="report-quick-v">${esc(entrega.fecha)}</strong>
          <span class="report-quick-sub">${esc(entrega.hora || "Sin hora registrada")}</span>
        </article>
        <article class="report-quick-card">
          <span class="report-quick-k">Produccion</span>
          <strong class="report-quick-v">${esc(tipoImpresion)}</strong>
          <span class="report-quick-sub">${esc(color)} | ${esc(maquina)}</span>
        </article>
        <article class="report-quick-card">
          <span class="report-quick-k">Plan total</span>
          <strong class="report-quick-v">${esc(totalPlan)}</strong>
          <span class="report-quick-sub">Cantidad ${esc(det?.cantidad_solicitada ?? "-")} | Demasia ${esc(det?.demasia ?? "-")}</span>
        </article>
      </section>

      <section class="report-acabados-spotlight">
        <div class="report-acabados-head">
          <div>
            <div class="report-panel-title">Acabados</div>
            <div class="report-panel-sub">Procesos y notas clave de esta orden</div>
          </div>
          <div class="report-acabados-count">${acabados.length ? `${acabados.length} proceso(s)` : "Sin procesos marcados"}</div>
        </div>
        <div class="report-acabados-layout">
          <div class="report-acabados-main">
            <div class="report-acabados-label">Procesos</div>
            <div class="report-acabados-grid">
              ${acabados.length
                ? acabados.map((item, idx) => `
                  <article class="report-acabado-card">
                    <span class="report-acabado-index">${String(idx + 1).padStart(2, "0")}</span>
                    <div class="report-acabado-copy">
                      <div class="report-acabado-title">${esc(item)}</div>
                      <div class="report-acabado-sub">Activo</div>
                    </div>
                  </article>
                `).join("")
                : `<div class="report-acabados-empty">No hay acabados especificos registrados para esta orden.</div>`}
            </div>
          </div>
          <div class="report-acabados-side">
            <article class="report-acabados-summary-card">
              <span class="report-note-k">Resumen</span>
              <div class="report-acabados-summary-value">${acabados.length}</div>
              <div class="report-acabados-summary-copy">
                ${acabados.length ? "Proceso(s) activos en acabados." : "Sin procesos de acabados."}
              </div>
            </article>
            <article class="report-note-card is-tech">
            <span class="report-note-k">Observacion tecnica</span>
            <div class="report-note-v">${esc(obsTecnica)}</div>
          </article>
          <article class="report-note-card is-general">
            <span class="report-note-k">Observaciones generales</span>
            <div class="report-note-v">${esc(obsGeneral)}</div>
          </article>
          </div>
        </div>
      </section>

      <div class="report-detail-layout${showCommercial ? "" : " is-single-panel"}">
        <section class="report-panel">
          <div class="report-panel-head">
            <div>
              <div class="report-panel-title">Ficha del trabajo</div>
              <div class="report-panel-sub">Datos principales para revisar la orden rapido</div>
            </div>
          </div>
          <div class="report-info-grid">
            <div class="report-info-item">
              <span class="report-info-k">Formato</span>
              <span class="report-info-v">${esc(formato)}</span>
            </div>
            <div class="report-info-item">
              <span class="report-info-k">Material</span>
              <span class="report-info-v">${esc(material)}</span>
            </div>
            <div class="report-info-item">
              <span class="report-info-k">Tipo impresion</span>
              <span class="report-info-v">${esc(tipoImpresion)}</span>
            </div>
            <div class="report-info-item">
              <span class="report-info-k">Color</span>
              <span class="report-info-v">${esc(color)}</span>
            </div>
            <div class="report-info-item">
              <span class="report-info-k">Cantidad</span>
              <span class="report-info-v">${esc(det?.cantidad_solicitada ?? "-")}</span>
            </div>
            <div class="report-info-item">
              <span class="report-info-k">Demasia</span>
              <span class="report-info-v">${esc(det?.demasia ?? "-")}</span>
            </div>
          </div>
        </section>

        ${showCommercial ? `
        <section class="report-panel">
          <div class="report-panel-head">
            <div>
              <div class="report-panel-title">Comercial y despacho</div>
              <div class="report-panel-sub">Validaciones utiles antes de cierre y entrega</div>
            </div>
          </div>
          <div class="report-info-grid">
            <div class="report-info-item">
              <span class="report-info-k">Orden de compra</span>
              <span class="report-info-v">${renderReportFlag(!!extra?.tiene_oc, extra?.oc_numero || "Registrada", "No requerida")}</span>
            </div>
            <div class="report-info-item">
              <span class="report-info-k">Guia</span>
              <span class="report-info-v">${renderReportFlag(!!extra?.tiene_guia, extra?.guia_numero || "Registrada", "Sin guia")}</span>
            </div>
            <div class="report-info-item report-info-item-wide">
              <span class="report-info-k">Observacion OC</span>
              <span class="report-info-v">${esc(obsOc)}</span>
            </div>
            <div class="report-info-item report-info-item-wide">
              <span class="report-info-k">Observacion guia</span>
              <span class="report-info-v">${esc(obsGuia)}</span>
            </div>
          </div>
        </section>` : ""}
      </div>
    </div>`;
}

async function openReportOrdenDetail(ordenId) {
  const fallback = reportOrdenLookup.get(Number(ordenId)) || { orden_id: ordenId, numero_orden_fisica: `#${ordenId}` };
  setText("reportOrdenDetailTitle", `Detalle de orden ${fallback?.numero_orden_fisica || `#${ordenId}`}`);
  if ($("reportOrdenDetailBody")) {
    $("reportOrdenDetailBody").innerHTML = `<div class="preview-empty">Cargando orden...</div>`;
  }
  $("reportOrdenDetailWrap")?.classList.remove("hide");
  try {
    const extra = await fetchOrdenById(ordenId);
    if ($("reportOrdenDetailBody")) {
      $("reportOrdenDetailBody").innerHTML = renderReportOrdenDetail(extra, fallback);
    }
  } catch (e) {
    if ($("reportOrdenDetailBody")) {
      $("reportOrdenDetailBody").innerHTML = `<div class="preview-empty">No se pudo cargar la orden: ${esc(e?.message || e)}</div>`;
    }
  }
}

function loadClientesFilter() {
  const sel = $("repCliente");
  if (!sel) return;
  const current = sel.value || "";
  sel.innerHTML = `<option value="">Todos</option>` +
    (clientesCache || []).map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
  sel.value = current;
}

function getSelectedClienteNombre(clienteId) {
  return clienteId
    ? ((clientesCache || []).find((c) => String(c.id) === String(clienteId))?.nombre || `ID ${clienteId}`)
    : "Todos";
}

function renderPreviewRows(rows = []) {
  const tb = $("repPreviewRows");
  if (!tb) return;
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="6" class="preview-empty">No hay registros para mostrar.</td></tr>`;
    return;
  }
  tb.innerHTML = rows.map((r) => `
    <tr>
      <td>${esc(r.numero_orden_fisica)}</td>
      <td>${esc(r.cliente)}</td>
      <td>${esc(r.trabajo)}</td>
      <td>${esc(r.formato)}</td>
      <td>${esc(String(r.cantidad ?? "-"))}</td>
      <td>${esc(fmtEntrega(r.fecha_entregado))}</td>
    </tr>
  `).join("");
}

function setPreviewState({ sub = "Ajusta los filtros para ver lo que se generará.", rows = null } = {}) {
  setText("repPreviewSub", sub);
  if (rows) renderPreviewRows(rows);
}

async function refreshPreviewReporte() {
  const clienteId = $("repCliente")?.value || "";
  const dateFrom = $("repDesde")?.value || "";
  const dateTo = $("repHasta")?.value || "";
  const cliente = getSelectedClienteNombre(clienteId);
  const rango = `${dateFrom || "-"} a ${dateTo || "-"}`;

  if (dateFrom && dateTo && dateFrom > dateTo) {
    setPreviewState({
      sub: `Rango inválido para ${cliente} (${rango}). Desde no puede ser mayor a Hasta.`,
      rows: []
    });
    return;
  }

  const reqId = ++previewReqId;
  setPreviewState({
    sub: `Calculando vista previa para ${cliente} (${rango})...`,
    rows: []
  });

  try {
    const rows = await fetchReporteEntregados({
      clienteId: clienteId || null,
      dateFrom,
      dateTo,
      limit: 2000
    });
    if (reqId !== previewReqId) return;
    const total = rows.length;
    const cantidad = rows.reduce((acc, r) => acc + (Number(r.cantidad || 0) || 0), 0);
    const isServicioOnly = total > 0 && rows.every((r) => normalizeTipoCliente(r.cliente_tipo) === "SERVICIO");
    setPreviewState({
      sub: total
        ? `Cliente: ${cliente} | Rango: ${rango} | Registros: ${total} | Cantidad total: ${cantidad} | Formato: ${isServicioOnly ? "Servicio" : "Completo"}`
        : `Cliente: ${cliente} | Rango: ${rango} | No hay trabajos entregados con esos filtros.`,
      rows: rows.slice(0, 12)
    });
  } catch (e) {
    if (reqId !== previewReqId) return;
    setPreviewState({
      sub: `No se pudo calcular la vista previa para ${cliente} (${rango}): ${e?.message || e}`,
      rows: []
    });
  }
}

async function exportReporteEntregados() {
  const clienteId = $("repCliente")?.value || "";
  const dateFrom = $("repDesde")?.value || "";
  const dateTo = $("repHasta")?.value || "";
  if (dateFrom && dateTo && dateFrom > dateTo) {
    msg("ERROR: El rango de fechas no es valido (Desde no puede ser mayor a Hasta).");
    return;
  }
  msg("Generando reporte de entregados...");
  const rows = await fetchReporteEntregados({
    clienteId: clienteId || null,
    dateFrom,
    dateTo,
    limit: 2000
  });
  if (!rows.length) {
    msg("No hay trabajos en estado ENTREGADO para exportar.");
    return;
  }

  const total = rows.length;
  const totalCant = rows.reduce((acc, r) => acc + (Number(r.cantidad || 0) || 0), 0);
  const totalOc = rows.reduce((acc, r) => acc + (r.tiene_oc ? 1 : 0), 0);
  const totalGuia = rows.reduce((acc, r) => acc + (r.tiene_guia ? 1 : 0), 0);
  const isServicioOnly = rows.every((r) => normalizeTipoCliente(r.cliente_tipo) === "SERVICIO");
  const selectedCliente = getSelectedClienteNombre(clienteId);
  const filtroFecha = `${dateFrom || "-"} a ${dateTo || "-"}`;

  const htmlRows = rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(r.numero_orden_fisica)}</td>
      <td>${esc(r.cliente)}</td>
      <td>${esc(r.cliente_tipo || "-")}</td>
      <td>${esc(`${r.cliente_doc_tipo || "-"} ${r.cliente_doc_numero || "-"}`)}</td>
      <td>${esc(r.trabajo)}</td>
      <td>${esc(r.formato)}</td>
      <td>${esc(r.papel_material)} ${esc(r.gramaje ? `(${r.gramaje}g)` : "")}</td>
      <td>${esc(fmtTipoImpresion(r.tipo_impresion))}</td>
      <td>${esc(r.color)}</td>
      ${isServicioOnly ? "" : `<td>${esc((r.oc_numero || "").trim() || "NO")}</td>`}
      ${isServicioOnly ? "" : `<td>${esc((r.guia_numero || "").trim() || "NO")}</td><td>${esc(r.guia_observacion || "-")}</td>`}
      <td>${esc(String(r.cantidad ?? "-"))}</td>
      <td>${esc(fmtEntrega(r.fecha_entregado))}</td>
    </tr>
  `).join("");

  const stamp = new Date().toLocaleString("es-PE", { timeZone: "America/Lima" });
  const logoUrl = `${window.location.origin}/app/assets/logo.svg`;
  const printHtml = `
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Reporte de Entregados</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    body{font-family:Arial, sans-serif; margin:24px; color:#111827}
    .head{display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid #111827; padding-bottom:10px; margin-bottom:16px}
    .brand{display:flex; align-items:center; gap:10px}
    .brand-logo{width:34px; height:34px; object-fit:contain}
    h1{margin:0; font-size:22px}
    .sub{color:#4b5563; font-size:12px}
    .kpis{display:flex; gap:14px; margin:10px 0 16px}
    .kpi{border:1px solid #d1d5db; border-radius:8px; padding:8px 10px; min-width:140px}
    .kpi b{display:block; font-size:20px}
    table{width:100%; border-collapse:collapse; font-size:11px}
    th,td{border:1px solid #d1d5db; padding:7px 6px; text-align:left; vertical-align:top}
    th{background:#f3f4f6; font-size:11px; text-transform:uppercase}
    .tools{margin:0 0 12px; display:flex; gap:8px}
    .btn{border:1px solid #d1d5db; background:#fff; padding:7px 10px; border-radius:6px; cursor:pointer}
    @media print {.tools{display:none} body{margin:10mm}}
  </style>
</head>
<body>
  <div class="tools">
    <button class="btn" onclick="window.print()">Imprimir / Guardar PDF</button>
  </div>
  <div class="head">
    <div class="brand">
      <img class="brand-logo" src="${esc(logoUrl)}" alt="Logo MultiBur" />
      <div>
        <h1>Reporte de Trabajos Entregados</h1>
        <div class="sub">MultiBur - generado: ${esc(stamp)}</div>
        <div class="sub">Filtro cliente: ${esc(selectedCliente)} | Rango fecha entregado: ${esc(filtroFecha)}</div>
        <div class="sub">${isServicioOnly ? "Formato: Servicio (sin OC ni guia)." : "Formato: Completo."}</div>
      </div>
    </div>
  </div>
  <div class="kpis">
    <div class="kpi"><span>Total entregados</span><b>${total}</b></div>
    <div class="kpi"><span>Total cantidad</span><b>${totalCant}</b></div>
    ${isServicioOnly ? "" : `<div class="kpi"><span>Con OC</span><b>${totalOc}</b></div>`}
    ${isServicioOnly ? "" : `<div class="kpi"><span>Con guia</span><b>${totalGuia}</b></div>`}
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Orden</th>
        <th>Cliente</th>
        <th>Tipo cliente</th>
        <th>Doc fiscal</th>
        <th>Trabajo</th>
        <th>Formato</th>
        <th>Material</th>
        <th>Impresion</th>
        <th>Color</th>
        ${isServicioOnly ? "" : "<th>Nro OC</th>"}
        ${isServicioOnly ? "" : "<th>Nro guia</th><th>Obs guia</th>"}
        <th>Cantidad</th>
        <th>Fecha entregado</th>
      </tr>
    </thead>
    <tbody>${htmlRows}</tbody>
  </table>
</body>
</html>`;

  const w = window.open("", "_blank", "width=1200,height=800");
  if (!w) {
    msg("ERROR: El navegador bloqueo la ventana del reporte.");
    return;
  }
  w.document.open();
  w.document.write(printHtml);
  w.document.close();
  msg(`OK Reporte generado: ${rows.length} registro(s).`);
}

async function loadRegistros() {
  const preset = $("rgPreset")?.value || "today";
  const fromDate = $("rgFrom")?.value || "";
  const toDate = $("rgTo")?.value || "";
  const ordenSearch = ($("rgOrden")?.value || "").trim();
  const ordenId = /^\d+$/.test(ordenSearch) ? Number(ordenSearch) : null;
  const userId = $("rgOperador")?.value || "";
  let regs = await fetchRegistros({ preset, fromDate, toDate, ordenId, userId, limit: 300 });
  const orderIds = [...new Set((regs || []).map((r) => r.orden_id).filter(Boolean))];
  const userIds = [...new Set((regs || []).map((r) => r.user_id).filter(Boolean))];
  const maqIds = [...new Set((regs || []).map((r) => r.maquina_id).filter(Boolean))];
  const juegoIds = [...new Set((regs || []).map((r) => r.orden_juego_id).filter(Boolean))];
  const [ordenes, users, maqs, juegos] = await Promise.all([
    fetchOrdenesProduccionByIds(orderIds),
    fetchProfilesByIds(userIds),
    fetchMaquinasByIds(maqIds),
    fetchOrdenJuegosByIds(juegoIds)
  ]);
  const ordenMap = new Map((ordenes || []).map((o) => [o.orden_id, o.numero_orden_fisica]));
  const clienteMap = new Map((ordenes || []).map((o) => [o.orden_id, o.cliente_nombre]));
  const trabajoMap = new Map((ordenes || []).map((o) => [o.orden_id, o.descripcion_trabajo]));
  const tipoImpMap = new Map((ordenes || []).map((o) => [o.orden_id, o.tipo_impresion]));
  const totalDemMap = new Map((ordenes || []).map((o) => {
    const cant = o?.cantidad_solicitada;
    const dem = o?.demasia;
    const label = cant != null
      ? `${cant}${dem != null ? ` +${dem}` : ""}`
      : "-";
    return [o.orden_id, label];
  }));
  const userMap = new Map((users || []).map((u) => [u.id, getProfileDisplayName(u) || u.username || u.id]));
  const maqMap = new Map((maqs || []).map((m) => [m.id, m.nombre]));
  const juegoMap = new Map((juegos || []).map((j) => [Number(j.id), j]));
  reportOrdenLookup = new Map((ordenes || []).map((o) => [Number(o.orden_id), o]));

  if (ordenSearch) {
    const q = ordenSearch.toLowerCase();
    regs = (regs || []).filter((r) => {
      const ord = String(ordenMap.get(r.orden_id) || ("#" + r.orden_id)).toLowerCase();
      const cli = String(clienteMap.get(r.orden_id) || "").toLowerCase();
      return ord.includes(q) || cli.includes(q);
    });
  }

  const selOperador = $("rgOperador");
  if (selOperador) {
    const current = selOperador.value || "";
    selOperador.innerHTML = `<option value="">Todos</option>` + (users || []).map((u) => `<option value="${u.id}">${esc(getProfileDisplayName(u) || u.username || u.id)}</option>`).join("");
    selOperador.value = current;
  }

  const tb = $("tbRegs");
  if (tb) {
    tb.innerHTML = (regs || []).length
      ? (regs || []).map((r) => `<tr>
          <td>${esc(ordenMap.get(r.orden_id) || ("#" + r.orden_id))}</td>
          <td>${esc(clienteMap.get(r.orden_id) || "-")}</td>
          <td>${esc(trabajoMap.get(r.orden_id) || "-")}</td>
          <td>${esc(
            String(juegoMap.get(Number(r.orden_juego_id || 0))?.nombre || "").trim()
            || buildPlacaFallback(r.juego_num, r.cara_impresion)
            || fmtTipoImpresion(tipoImpMap.get(r.orden_id) || "-")
          )}</td>
          <td>${esc(userMap.get(r.user_id) || r.user_id || "-")}</td>
          <td>${esc(maqMap.get(r.maquina_id) || r.maquina_id || "-")}</td>
          <td>${esc(fmtDTPE(r.hora_inicio))}</td>
          <td>${esc(fmtDTPE(r.hora_fin))}</td>
          <td>${esc(totalDemMap.get(r.orden_id) || "-")}</td>
          <td>${esc(r.cantidad_buena ?? "-")}</td>
          <td>${esc(r.cantidad_mala ?? 0)}</td>
          <td><button class="btn btn-ghost" type="button" data-action="view-order" data-oid="${r.orden_id}">Ver orden</button></td>
        </tr>`).join("")
      : `<tr><td colspan="12" class="preview-empty">No hay registros para los filtros seleccionados.</td></tr>`;
  }
  setText("msgRegs", `Registros cargados: ${(regs || []).length}`);
}

(async function init() {
  const prof = await requireAdmin();
  if (!prof) return;
  const rawName = String(getProfileDisplayName(prof) || "").trim();
  const displayName = rawName && !rawName.includes("@")
    ? rawName
    : (prof?.rol === "ADMIN" ? "Administrador" : "Usuario");
  initFullscreenToggle();
  setText("userPill", `${displayName} | ${prof.rol}`);

  $("btnLogout")?.addEventListener("click", async () => {
    await logout();
    window.location.href = "./login.html";
  });
  $("btnClearRepFilters")?.addEventListener("click", () => {
    if ($("repCliente")) $("repCliente").value = "";
    if ($("repDesde")) $("repDesde").value = "";
    if ($("repHasta")) $("repHasta").value = "";
    msg("Filtros limpiados.");
    refreshPreviewReporte();
  });
  $("btnReporteEntregados")?.addEventListener("click", exportReporteEntregados);
  $("tabBtnEntregados")?.addEventListener("click", () => setActiveTab("entregados"));
  $("tabBtnProduccion")?.addEventListener("click", () => setActiveTab("produccion"));
  $("btnCloseReportOrden")?.addEventListener("click", closeReportOrdenDetail);
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if ($("reportOrdenDetailWrap")?.classList.contains("hide")) return;
    closeReportOrdenDetail();
  });
  $("tbRegs")?.addEventListener("click", async (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest('button[data-action="view-order"]');
    if (!(btn instanceof HTMLButtonElement)) return;
    const ordenId = Number(btn.getAttribute("data-oid"));
    if (!ordenId) return;
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Abriendo...";
    try {
      await openReportOrdenDetail(ordenId);
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  });
  $("btnReloadRegs")?.addEventListener("click", loadRegistros);
  $("btnApplyRegs")?.addEventListener("click", loadRegistros);
  const onPreviewChange = debounce(refreshPreviewReporte, 220);
  $("repCliente")?.addEventListener("change", onPreviewChange);
  $("repDesde")?.addEventListener("input", onPreviewChange);
  $("repDesde")?.addEventListener("change", onPreviewChange);
  $("repHasta")?.addEventListener("input", onPreviewChange);
  $("repHasta")?.addEventListener("change", onPreviewChange);
  $("rgQuickPresets")?.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const chip = t.closest("button[data-rg-preset]");
    if (!chip) return;
    $("rgPreset").value = chip.getAttribute("data-rg-preset");
    $("rgPreset").dispatchEvent(new Event("change"));
    loadRegistros();
  });
  $("rgPreset")?.addEventListener("change", () => {
    const custom = $("rgPreset").value === "custom";
    if (custom) {
      $("rgFrom")?.removeAttribute("disabled");
      $("rgTo")?.removeAttribute("disabled");
    } else {
      $("rgFrom")?.setAttribute("disabled", "disabled");
      $("rgTo")?.setAttribute("disabled", "disabled");
    }
    syncRegsPresetChips();
  });
  $("rgPreset")?.dispatchEvent(new Event("change"));

  clientesCache = await fetchClientes().catch(() => []);
  loadClientesFilter();
  setActiveTab("entregados");
  refreshPreviewReporte();
  loadRegistros();
})().catch((e) => {
  console.error("ADMIN_REPORTES_INIT_ERROR:", e);
  msg("ERROR cargando reportes: " + (e?.message || e));
});
