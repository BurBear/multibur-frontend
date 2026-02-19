import { requireAdmin, logout, getProfileDisplayName } from "./auth.js";
import { fetchClientes, fetchReporteEntregados } from "./api.js";
import { $, setText } from "./ui.js";

const msg = (t) => setText("msgReport", t || "");
let clientesCache = [];

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function fmtEntrega(value) {
  if (!value) return "-";
  const s = String(value).trim();
  const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/i.test(s);
  if (hasOffset) return new Date(s).toLocaleString("es-PE", { timeZone: "America/Lima" });
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const [, y, mo, d, hh, mm, ss = "00"] = m;
    return `${d}/${mo}/${y}, ${hh}:${mm}:${ss}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("es-PE");
}

function normalizeTipoCliente(v) {
  const t = String(v || "").trim().toUpperCase();
  if (t === "SERVICIO_IMPRESION") return "SERVICIO";
  return t || "";
}

function loadClientesFilter() {
  const sel = $("repCliente");
  if (!sel) return;
  const current = sel.value || "";
  sel.innerHTML = `<option value="">Todos</option>` +
    (clientesCache || []).map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
  sel.value = current;
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
  const selectedCliente = clienteId
    ? ((clientesCache || []).find((c) => String(c.id) === String(clienteId))?.nombre || `ID ${clienteId}`)
    : "Todos";
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
      <td>${esc(r.tipo_impresion)}</td>
      <td>${esc(r.color)}</td>
      ${isServicioOnly ? "" : `<td>${r.tiene_oc ? "SI" : "NO"}</td><td>${esc(r.oc_numero || "-")}</td>`}
      <td>${r.tiene_guia ? "SI" : "NO"}</td>
      <td>${esc(r.guia_numero || "-")}</td>
      <td>${esc(r.guia_observacion || "-")}</td>
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
      <div class="sub">${isServicioOnly ? "Formato: Servicio (sin OC)." : "Formato: Completo."}</div>
    </div>
  </div>
  <div class="kpis">
    <div class="kpi"><span>Total entregados</span><b>${total}</b></div>
    <div class="kpi"><span>Total cantidad</span><b>${totalCant}</b></div>
    ${isServicioOnly ? "" : `<div class="kpi"><span>Con OC</span><b>${totalOc}</b></div>`}
    <div class="kpi"><span>Con guia</span><b>${totalGuia}</b></div>
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
        ${isServicioOnly ? "" : "<th>OC</th><th>Nro OC</th>"}
        <th>Guia</th>
        <th>Nro guia</th>
        <th>Obs guia</th>
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

(async function init() {
  const prof = await requireAdmin();
  if (!prof) return;
  const dn = getProfileDisplayName(prof);
  setText("userPill", `${dn} | ${prof.rol}`);

  $("btnLogout")?.addEventListener("click", async () => {
    await logout();
    window.location.href = "./login.html";
  });
  $("btnClearRepFilters")?.addEventListener("click", () => {
    if ($("repCliente")) $("repCliente").value = "";
    if ($("repDesde")) $("repDesde").value = "";
    if ($("repHasta")) $("repHasta").value = "";
    msg("Filtros limpiados.");
  });
  $("btnReporteEntregados")?.addEventListener("click", exportReporteEntregados);

  clientesCache = await fetchClientes().catch(() => []);
  loadClientesFilter();
})().catch((e) => {
  console.error("ADMIN_REPORTES_INIT_ERROR:", e);
  msg("ERROR cargando reportes: " + (e?.message || e));
});

