import { requireAdmin, logout, getProfileDisplayName } from "./auth.js";
import { fetchClientes, fetchReporteEntregados, fetchRegistros, fetchProfilesByIds, fetchMaquinasByIds, fetchOrdenesProduccionByIds, fetchOrdenJuegosByIds } from "./api.js";
import { $, setText, debounce } from "./ui.js";
import { escapeHtml } from "./utils/helpers.js";
import { fmtEntrega, fmtDateTimePE } from "./utils/formatters.js";
import { fmtTipoImpresion } from "./admin/admin-orders.js";

const msg = (t) => setText("msgReport", t || "");
let clientesCache = [];
let previewReqId = 0;
let activeTab = "entregados";

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
    <div>
      <h1>Reporte de Trabajos Entregados</h1>
      <div class="sub">MultiBur - generado: ${esc(stamp)}</div>
      <div class="sub">Filtro cliente: ${esc(selectedCliente)} | Rango fecha entregado: ${esc(filtroFecha)}</div>
      <div class="sub">${isServicioOnly ? "Formato: Servicio (sin OC ni guia)." : "Formato: Completo."}</div>
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
        </tr>`).join("")
      : `<tr><td colspan="11" class="preview-empty">No hay registros para los filtros seleccionados.</td></tr>`;
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
