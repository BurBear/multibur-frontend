import { requireAdmin, logout, getProfileDisplayName } from "./auth.js";
import { $, setText, debounce } from "./ui.js";
import {
  fetchClientes,
  fetchMaquinas,
  fetchTrabajosAdminBoard,
  fetchRegistros,
  fetchProfilesByIds,
  fetchMaquinasByIds,
  createOrdenConDetalles,
  fetchOrdenById,
  fetchOrdenResumenByIds,
  fetchOrdenesMetaByIds,
  fetchReporteEntregados,
  rpcFinalizarEntregaOrden
} from "./api.js";
import { supabase } from "./supabaseClient.js";

const ESTADO_FINAL = "TERMINADO";
const ESTADO_ENTREGADO = "ENTREGADO";
const EXTERNAL_TAG = "[EXTERNO]";
let clientesCache = [];
let materialesCache = [];
let detailRowCtx = null;
let detailExtraCtx = null;
let entregaCtx = null;
let entregaRequiresGuia = false;
let smartMode = null;
let smartSelectedId = null;

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function msgJobs(t) { setText("msgJobs", t || ""); }
function msgRegs(t) { setText("msgRegs", t || ""); }
function msgCreate(t) { setText("msgCreate", t || ""); }

function hasExternalFlow(obs) {
  return String(obs || "").toUpperCase().includes(EXTERNAL_TAG);
}

function toDbEstado(v) {
  const n = norm(v);
  if (n === "diseno") return "DISEÑO";
  return String(v || "");
}

function estadoKey(v) {
  return norm(v).toUpperCase();
}

function fmtDTPE(x) {
  return x ? new Date(x).toLocaleString("es-PE", { timeZone: "America/Lima" }) : "-";
}

function setKPIs(regs) {
  setText("kRegs", String((regs || []).length));
  setText("kAct", String((regs || []).filter((x) => !x.hora_fin).length));
  const last = regs?.[0]?.hora_inicio
    ? new Date(regs[0].hora_inicio).toLocaleTimeString("es-PE", { timeZone: "America/Lima" })
    : "--:--";
  setText("kLast", last);
}

function dbLocalTimestamp(dtLocal) {
  if (!dtLocal) return null;
  const [datePart, timePartRaw] = String(dtLocal).split("T");
  if (!datePart || !timePartRaw) return null;
  const timePart = timePartRaw.length === 5 ? `${timePartRaw}:00` : timePartRaw.slice(0, 8);
  return `${datePart}T${timePart}`;
}

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

function toNumOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function normalizeTipoCliente(v) {
  const t = String(v || "").trim().toUpperCase();
  if (t === "SERVICIO_IMPRESION") return "SERVICIO";
  return t || "";
}

function toDbTipoImpresion(v) {
  const raw = String(v || "").trim().toUpperCase();
  if (!raw) return null;
  if (raw === "TIRA/RETIRA") return "TIRA_RETIRA";
  if (raw === "T+R") return "TIRA+RETIRA";
  if (raw === "DOBLE PINZA") return "DOBLE_PINZA";
  return raw;
}

function fmtTipoImpresion(v) {
  const raw = String(v || "").trim().toUpperCase();
  if (raw === "TIRA_RETIRA") return "TIRA/RETIRA";
  if (raw === "TIRA+RETIRA") return "T+R";
  if (raw === "DOBLE_PINZA") return "DOBLE PINZA";
  return String(v || "-");
}

function validateOrdenForm() {
  const isExt = $("o_externo")?.checked ?? false;
  const req = ["o_desc", "o_cliente", "o_entrega", "d_cant", "d_color_mode"];
  if (!isExt) {
    req.push("d_maq", "d_tipoimp", "d_color_text");
  }
  if ($("d_material")) req.push("d_material");
  if ($("d_formato")) req.push("d_formato");
  if ($("o_tiene_oc")?.checked) req.push("o_oc_numero");
  const miss = req.filter((id) => !String($(id)?.value ?? "").trim());
  if ((Number($("d_cant")?.value || 0)) <= 0) miss.push("d_cant");
  return miss;
}

function refreshFormState() {
  const btn = $("btnGuardarOrden");
  if (!btn) return;
  const miss = validateOrdenForm();
  btn.disabled = miss.length > 0;
  msgCreate(miss.length ? "Completa los campos obligatorios para guardar." : "Formulario listo para guardar.");
}

function renderClienteSelectBase() {
  const sel = $("o_cliente");
  if (!sel) return;
  sel.innerHTML = `<option value="">- Selecciona -</option>` +
    (clientesCache || []).map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
}

function syncClienteSelectedText() {
  const sel = $("o_cliente");
  if (!sel) return;
  const c = (clientesCache || []).find((x) => String(x.id) === String(sel.value));
  $("o_cliente_search").value = c?.nombre || "";
  setText("o_cliente_selected", c ? `OK Cliente: ${c.nombre}` : "");
  const docLabel = c ? `${c.doc_fiscal_tipo || "-"} ${c.doc_fiscal_numero || "-"}` : "-";
  setText("o_cli_tipo", c?.tipo_cliente || "-");
  setText("o_cli_doc", docLabel);
  if ($("o_tiene_oc")) {
    $("o_tiene_oc").checked = !!c?.requiere_oc_default;
    syncOcFields();
  }
  refreshFormState();
}

function renderMaterialSelectBase() {
  const sel = $("d_material");
  if (!sel) return;
  sel.innerHTML = `<option value="">- Selecciona material -</option>` +
    (materialesCache || []).map((m) => `<option value="${m.id}" data-nombre="${esc(m.nombre)}" data-gramaje="${m.gramaje ?? ""}">${esc(m.nombre)}${m.gramaje ? ` ${esc(m.gramaje)}g` : ""}</option>`).join("");
}

function syncMaterialSelectedText() {
  const sel = $("d_material");
  if (!sel) return;
  const m = (materialesCache || []).find((x) => String(x.id) === String(sel.value));
  $("d_material_search").value = m ? `${m.nombre}${m.gramaje ? ` ${m.gramaje}g` : ""}` : "";
  setText("d_material_selected", m ? `OK Material: ${m.nombre}${m.gramaje ? ` (${m.gramaje}g)` : ""}` : "");
}

function syncReporteClientesFilter() {
  const sel = $("repCliente");
  if (!sel) return;
  const current = sel.value || "";
  sel.innerHTML = `<option value="">Todos</option>` +
    (clientesCache || []).map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
  sel.value = current;
}

function getReporteFilters() {
  const clienteId = $("repCliente")?.value || "";
  const dateFrom = $("repDesde")?.value || "";
  const dateTo = $("repHasta")?.value || "";
  return { clienteId, dateFrom, dateTo };
}

function filterSmartRows(mode, q) {
  const source = mode === "cliente" ? clientesCache : materialesCache;
  const n = norm(q);
  return (source || []).filter((x) => {
    const hay = mode === "cliente" ? `${x.nombre} ${x.id}` : `${x.nombre} ${x.gramaje || ""} ${x.id}`;
    return norm(hay).includes(n);
  }).slice(0, 100);
}

function renderSmartList() {
  const list = $("smartList");
  const q = $("smartSearch")?.value || "";
  if (!list || !smartMode) return;
  const rows = filterSmartRows(smartMode, q);
  setText("smartCount", `${rows.length} resultado(s)`);
  if (!rows.length) {
    list.innerHTML = `<div class="smart-empty">Sin resultados</div>`;
    return;
  }
  list.innerHTML = rows.map((x) => {
    const selected = String(x.id) === String(smartSelectedId);
    const meta = smartMode === "cliente" ? `ID: ${esc(x.id)}` : `${x.gramaje ? `${esc(x.gramaje)}g` : "Sin gramaje"} - ID: ${esc(x.id)}`;
    return `<button class="smart-item ${selected ? "is-selected" : ""}" type="button" data-smart-id="${x.id}"><span>${esc(x.nombre)}</span><span class="smart-meta">${meta}</span></button>`;
  }).join("");
}

function openSmartModal(mode) {
  smartMode = mode;
  smartSelectedId = mode === "cliente" ? $("o_cliente")?.value : $("d_material")?.value;
  setText("smartTitle", mode === "cliente" ? "Buscar cliente" : "Buscar material");
  setText("smartSub", mode === "cliente" ? "Filtra por nombre" : "Filtra por nombre o gramaje");
  $("smartSearch").value = "";
  renderSmartList();
  $("smartWrap")?.classList.remove("hide");
  $("smartWrap")?.setAttribute("aria-hidden", "false");
  setTimeout(() => $("smartSearch")?.focus(), 0);
}

function closeSmartModal() {
  $("smartWrap")?.classList.add("hide");
  $("smartWrap")?.setAttribute("aria-hidden", "true");
}

function wireSmartPickers() {
  $("o_cliente_search")?.addEventListener("click", () => openSmartModal("cliente"));
  $("d_material_search")?.addEventListener("click", () => openSmartModal("material"));
  $("o_cliente_search")?.addEventListener("focus", () => openSmartModal("cliente"));
  $("d_material_search")?.addEventListener("focus", () => openSmartModal("material"));
  $("smartClose")?.addEventListener("click", closeSmartModal);
  $("smartClear")?.addEventListener("click", () => { smartSelectedId = null; renderSmartList(); });
  $("smartConfirm")?.addEventListener("click", () => {
    if (!smartMode || !smartSelectedId) return;
    if (smartMode === "cliente") {
      $("o_cliente").value = String(smartSelectedId);
      syncClienteSelectedText();
    } else {
      $("d_material").value = String(smartSelectedId);
      syncMaterialSelectedText();
      $("d_material")?.dispatchEvent(new Event("change"));
    }
    closeSmartModal();
    refreshFormState();
  });
  $("smartSearch")?.addEventListener("input", debounce(renderSmartList, 120));
  $("smartList")?.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const btn = t.closest("button[data-smart-id]");
    if (!btn) return;
    smartSelectedId = btn.getAttribute("data-smart-id");
    renderSmartList();
  });
  $("smartWrap")?.addEventListener("click", (ev) => {
    if (ev.target && ev.target.id === "smartWrap") closeSmartModal();
  });
}

async function loadCombosClientesMaquinas() {
  const [clientes, maqs] = await Promise.all([fetchClientes(), fetchMaquinas()]);
  clientesCache = clientes || [];
  renderClienteSelectBase();
  syncClienteSelectedText();
  syncReporteClientesFilter();
  const selMaq = $("d_maq");
  if (selMaq) {
    selMaq.innerHTML = `<option value="">-</option>` + (maqs || []).map((m) => `<option value="${m.id}">${esc(m.nombre)} (${esc(m.tipo)})</option>`).join("");
  }
}

async function loadCombosMaterialesFormatos() {
  const { data: mats } = await supabase.from("materiales").select("id,nombre,gramaje").order("nombre", { ascending: true });
  materialesCache = mats || [];
  renderMaterialSelectBase();
  syncMaterialSelectedText();

  const { data: fors } = await supabase.from("formatos").select("id,nombre,ancho,alto").order("id", { ascending: false });
  const selFor = $("d_formato");
  if (selFor) {
    selFor.innerHTML = `<option value="">- Selecciona formato -</option>` +
      (fors || []).map((f) => `<option value="${f.id}" data-ancho="${f.ancho ?? ""}" data-alto="${f.alto ?? ""}">${esc(f.nombre)} (${esc(f.ancho)} x ${esc(f.alto)})</option>`).join("");
  }
}

function wireAutoFillMaterialFormato() {
  const selMat = $("d_material");
  const selFor = $("d_formato");
  const selColorMode = $("d_color_mode");
  const inpColorText = $("d_color_text");
  selMat?.addEventListener("change", () => {
    refreshFormState();
  });
  selFor?.addEventListener("change", () => {
    refreshFormState();
  });
  selColorMode?.addEventListener("change", () => {
    const mode = selColorMode.value;
    if (!inpColorText) return;
    if (mode === "FC") {
      inpColorText.value = "F/C";
      inpColorText.readOnly = true;
    } else if (mode === "BN") {
      inpColorText.value = "1 COLOR";
      inpColorText.readOnly = true;
    } else {
      inpColorText.readOnly = false;
      if (!String(inpColorText.value || "").trim() || inpColorText.value === "F/C" || inpColorText.value === "1 COLOR") {
        inpColorText.value = "";
      }
      inpColorText.focus();
    }
    refreshFormState();
  });
  selColorMode?.dispatchEvent(new Event("change"));
}

async function updateOrdenEstado(id, estado, extras = {}) {
  const payload = { estado };
  if (estadoKey(estado) === estadoKey(ESTADO_ENTREGADO)) {
    payload.fecha_entregado = new Date().toISOString();
    payload.entregado_por = extras.userId || null;
    payload.obs_entrega = extras.obsEntrega || null;
    payload.tiene_guia = !!extras.tieneGuia;
    payload.guia_numero = extras.tieneGuia ? (extras.guiaNumero || null) : null;
    payload.guia_observacion = extras.tieneGuia ? (extras.guiaObservacion || null) : null;
  }
  const { error } = await supabase.from("ordenes").update(payload).eq("id", id);
  if (error) throw error;
}

function syncExternalFlowUI() {
  const checked = $("o_externo")?.checked ?? false;
  const hint = $("o_externo_hint");
  if (hint) {
    hint.textContent = checked
      ? "Flujo externo activo: DISENO -> ACABADOS"
      : "Flujo normal: DISENO -> PLACAS -> IMPRESION -> ACABADOS";
    hint.classList.toggle("is-external", checked);
  }

  const disableIds = ["d_dem", "d_maq", "d_tipoimp", "d_color_text", "d_obs_tecnica"];
  disableIds.forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.disabled = checked;
    const block = el.closest("div");
    if (block) block.style.display = checked ? "none" : "";
  });

  if (checked) {
    if ($("d_dem")) $("d_dem").value = "";
    if ($("d_maq")) $("d_maq").value = "";
    if ($("d_tipoimp")) $("d_tipoimp").value = "";
    if ($("d_obs_tecnica")) $("d_obs_tecnica").value = "";
    // Keep color text aligned to selected mode for external flow.
    $("d_color_mode")?.dispatchEvent(new Event("change"));
  }
  refreshFormState();
}

function syncOcFields() {
  const on = $("o_tiene_oc")?.checked ?? false;
  const ocNum = $("o_oc_numero");
  const ocObs = $("o_oc_obs");
  if (ocNum) {
    ocNum.disabled = !on;
    if (!on) ocNum.value = "";
  }
  if (ocObs) {
    ocObs.disabled = !on;
    if (!on) ocObs.value = "";
  }
}

function syncEntregaGuiaFields() {
  const chk = $("e_tiene_guia");
  const onRaw = chk?.checked ?? false;
  const guiaNum = $("e_guia_numero");
  const guiaObs = $("e_guia_obs");
  const rule = $("e_guia_rule");
  if (chk) chk.disabled = entregaRequiresGuia;
  if (entregaRequiresGuia && chk) chk.checked = true;
  const on = entregaRequiresGuia ? true : onRaw;
  if (rule) {
    rule.textContent = entregaRequiresGuia
      ? "Esta orden requiere OC, por lo tanto la guia es obligatoria al entregar."
      : "Si no corresponde guia, puedes dejarla desactivada.";
  }
  if (guiaNum) {
    guiaNum.disabled = !on;
    if (!on) guiaNum.value = "";
  }
  if (guiaObs) {
    guiaObs.disabled = !on;
    if (!on) guiaObs.value = "";
  }
}

async function openEntregaModal(row) {
  entregaCtx = row || null;
  let extra = null;
  try {
    extra = row?.orden_id ? await fetchOrdenById(row.orden_id) : null;
  } catch {
    extra = null;
  }
  entregaRequiresGuia = !!extra?.tiene_oc;
  setText("entregaOrdenInfo", row ? `Orden: ${row.numero_orden_fisica || ("#" + row.orden_id)} | Cliente: ${row.cliente_nombre || "-"}` : "");
  if ($("e_tiene_guia")) $("e_tiene_guia").checked = entregaRequiresGuia;
  if ($("e_guia_numero")) $("e_guia_numero").value = "";
  if ($("e_guia_obs")) $("e_guia_obs").value = "";
  if ($("e_obs_entrega")) $("e_obs_entrega").value = "";
  syncEntregaGuiaFields();
  $("entregaWrap")?.classList.remove("hide");
}

function closeEntregaModal() {
  entregaCtx = null;
  entregaRequiresGuia = false;
  $("entregaWrap")?.classList.add("hide");
}

async function confirmEntregaDesdeModal() {
  if (!entregaCtx?.orden_id) return;
  const oid = Number(entregaCtx.orden_id);
  const tieneGuia = entregaRequiresGuia ? true : ($("e_tiene_guia")?.checked ?? false);
  const guiaNumero = $("e_guia_numero")?.value?.trim() || "";
  if (tieneGuia && !guiaNumero) {
    msgJobs("ERROR: Si activas guia, debes ingresar Nro guia.");
    return;
  }
  const { data: { user } } = await supabase.auth.getUser();
  const payload = {
    userId: user?.id || null,
    obsEntrega: $("e_obs_entrega")?.value?.trim() || null,
    tieneGuia,
    guiaNumero: tieneGuia ? guiaNumero : null,
    guiaObservacion: tieneGuia ? ($("e_guia_obs")?.value?.trim() || null) : null
  };
  const rpcRes = await rpcFinalizarEntregaOrden({
    ordenId: oid,
    userId: payload.userId,
    obsEntrega: payload.obsEntrega,
    tieneGuia: payload.tieneGuia,
    guiaNumero: payload.guiaNumero,
    guiaObservacion: payload.guiaObservacion
  });
  if (!rpcRes) {
    await updateOrdenEstado(oid, ESTADO_ENTREGADO, payload);
  }
  closeEntregaModal();
  msgJobs(`OK Orden ${oid} marcada como ENTREGADO.`);
  await loadJobs();
}

function renderAccion(r) {
  const e = estadoKey(r.estado);
  if (e === "DISENO") {
    if (r.is_external) {
      return `<button class="btn btn-warn" type="button" data-action="set" data-oid="${r.orden_id}" data-to="ACABADOS" style="padding:8px 10px">Enviar a ACABADOS</button>`;
    }
    return `<button class="btn btn-warn" type="button" data-action="set" data-oid="${r.orden_id}" data-to="PLACAS" style="padding:8px 10px">Pasar a PLACAS</button>`;
  }
  if (e === "PLACAS") {
    return `<span class="state-pill is-ready">Listo para operador</span>`;
  }
  if (e === "IMPRESION") {
    return `<span class="state-pill is-printing">En impresion (operador)</span>`;
  }
  if (e === "ACABADOS") {
    return `<button class="btn btn-primary" type="button" data-action="set" data-oid="${r.orden_id}" data-to="${ESTADO_FINAL}" style="padding:8px 10px">FINALIZAR</button>`;
  }
  if (e === estadoKey(ESTADO_FINAL)) {
    return `<button class="btn btn-deliver" type="button" data-action="deliver" data-oid="${r.orden_id}" style="padding:8px 10px">ENTREGAR</button>`;
  }
  if (e === estadoKey(ESTADO_ENTREGADO)) {
    return `<span class="small muted">Entregado</span>`;
  }
  return `<span class="small muted">-</span>`;
}

function renderPrioridadBadge(prio) {
  const p = String(prio || "NORMAL").toUpperCase();
  const cls = p === "URGENTE" ? "prio-badge is-urgent" : "prio-badge";
  return `<span class="${cls}">${esc(p)}</span>`;
}

function getProcesosAcabadosText(r) {
  const procesos = [];
  if (r?.corte) procesos.push("Corte");
  if (r?.empaquetado) procesos.push("Empaquetado");
  if (r?.doblez) procesos.push("Doblez");
  if (r?.compaginado) procesos.push("Compaginado");
  if (r?.troquelado) procesos.push("Troquelado");
  if (r?.sectorizado) procesos.push("Sectorizado");
  if (r?.barniz) procesos.push("Barniz");
  if (r?.plastificado) procesos.push(`Plastificado: ${r.plastificado}`);
  return procesos.length ? procesos.join(", ") : "Ninguno";
}

function openDetalleOrden(r, extra = null) {
  const entregaRaw = extra?.fecha_entrega || r.fecha_entrega || null;
  const entrega = fmtEntrega(entregaRaw);
  const formato = (r.medida_ancho && r.medida_alto) ? `${r.medida_ancho} x ${r.medida_alto}` : "-";
  const cantidad = r.cantidad_solicitada ?? "-";
  const demasia = r.demasia ?? "-";
  const obsAcabados = extra?.observaciones_generales || "-";
  const obsTecnica = r.observacion_tecnica || "-";
  const procesosAcabados = getProcesosAcabadosText(r);
  const cliTipo = extra?.cliente?.tipo_cliente || "-";
  const cliDocTipo = extra?.cliente?.doc_fiscal_tipo || "-";
  const cliDocNum = extra?.cliente?.doc_fiscal_numero || "-";
  const tieneOc = !!extra?.tiene_oc;
  const ocNum = extra?.oc_numero || "-";
  const ocObs = extra?.oc_observacion || "-";
  const tieneGuia = !!extra?.tiene_guia;
  const guiaNum = extra?.guia_numero || "-";
  const guiaObs = extra?.guia_observacion || "-";
  $("jobDetailBody").innerHTML = `
    <div class="detail-grid">
      <div><span class="detail-k">Orden</span><span class="detail-v">${esc(r.numero_orden_fisica || ("#" + r.orden_id))}</span></div>
      <div><span class="detail-k">Estado</span><span class="detail-v">${esc(r.estado || "-")}</span></div>
      <div><span class="detail-k">Prioridad</span><span class="detail-v">${renderPrioridadBadge(r.prioridad)}</span></div>
      <div><span class="detail-k">Entrega</span><span class="detail-v">${esc(entrega)}</span></div>
      <div><span class="detail-k">Cliente</span><span class="detail-v">${esc(r.cliente_nombre || "-")}</span></div>
      <div><span class="detail-k">Tipo cliente</span><span class="detail-v">${esc(cliTipo)}</span></div>
      <div><span class="detail-k">Documento fiscal</span><span class="detail-v">${esc(`${cliDocTipo} ${cliDocNum}`)}</span></div>
      <div><span class="detail-k">Maquina</span><span class="detail-v">${esc(r.maquina_sugerida_nombre || "-")}</span></div>
      <div><span class="detail-k">Requiere OC</span><span class="detail-v">${tieneOc ? "SI" : "NO"}</span></div>
      <div><span class="detail-k">Nro OC</span><span class="detail-v">${esc(ocNum)}</span></div>
      <div><span class="detail-k">Obs OC</span><span class="detail-v">${esc(ocObs)}</span></div>
      <div><span class="detail-k">Tiene guia</span><span class="detail-v">${tieneGuia ? "SI" : "NO"}</span></div>
      <div><span class="detail-k">Nro guia</span><span class="detail-v">${esc(guiaNum)}</span></div>
      <div><span class="detail-k">Obs guia</span><span class="detail-v">${esc(guiaObs)}</span></div>
      <div><span class="detail-k">Formato</span><span class="detail-v">${esc(formato)}</span></div>
      <div><span class="detail-k">Material</span><span class="detail-v">${esc(r.papel_material || "-")} ${esc(r.gramaje ? `(${r.gramaje}g)` : "")}</span></div>
      <div><span class="detail-k">Tipo impresion</span><span class="detail-v">${esc(fmtTipoImpresion(r.tipo_impresion))}</span></div>
      <div><span class="detail-k">Color</span><span class="detail-v">${esc(r.color_text || "-")}</span></div>
      <div><span class="detail-k">Cantidad</span><span class="detail-v">${esc(cantidad)}</span></div>
      <div><span class="detail-k">Demasia</span><span class="detail-v">${esc(demasia)}</span></div>
      <div style="grid-column:1/-1"><span class="detail-k">Procesos acabados</span><span class="detail-v">${esc(procesosAcabados)}</span></div>
      <div style="grid-column:1/-1"><span class="detail-k">Trabajo</span><span class="detail-v">${esc(r.descripcion_trabajo || "-")}</span></div>
      <div style="grid-column:1/-1"><span class="detail-k">Observacion tecnica (impresor)</span><span class="detail-v">${esc(obsTecnica)}</span></div>
      <div style="grid-column:1/-1"><span class="detail-k">Observacion acabados</span><span class="detail-v">${esc(obsAcabados)}</span></div>
    </div>`;
  detailRowCtx = r;
  detailExtraCtx = extra;
  $("btnPrintDetail").disabled = false;
  $("jobDetailWrap")?.classList.remove("hide");
}

function closeDetalleOrden() {
  detailRowCtx = null;
  detailExtraCtx = null;
  $("btnPrintDetail").disabled = true;
  $("jobDetailWrap")?.classList.add("hide");
}

function printOrden(r, extra = null) {
  const entregaRaw = extra?.fecha_entrega || r.fecha_entrega || null;
  const entrega = fmtEntrega(entregaRaw);
  const emitido = new Date().toLocaleString("es-PE", { timeZone: "America/Lima" });
  const formato = (r.medida_ancho && r.medida_alto) ? `${r.medida_ancho} x ${r.medida_alto}` : "-";
  const material = `${r.papel_material || "-"}${r.gramaje ? ` (${r.gramaje}g)` : ""}`;
  const cantidad = r.cantidad_solicitada ?? "-";
  const demasia = r.demasia ?? "-";
  const obsAcabados = extra?.observaciones_generales || "-";
  const obsTecnica = r.observacion_tecnica || "-";
  const procesosAcabados = getProcesosAcabadosText(r);
  const cliTipo = extra?.cliente?.tipo_cliente || "-";
  const cliDocTipo = extra?.cliente?.doc_fiscal_tipo || "-";
  const cliDocNum = extra?.cliente?.doc_fiscal_numero || "-";
  const ocNum = extra?.oc_numero || "-";
  const html = `
<!doctype html><html lang="es"><head><meta charset="utf-8" /><title>Orden ${esc(r.numero_orden_fisica || ("#" + r.orden_id))}</title>
<style>
@page{size:A5 portrait;margin:8mm}
:root{--line:#d4d4d8;--muted:#52525b;--ink:#111827}*{box-sizing:border-box}
body{font-family:"Segoe UI",Arial,sans-serif;margin:0;padding:0;color:var(--ink);background:#fff}
.sheet{max-width:100%;margin:0 auto;display:flex;flex-direction:column}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;border-bottom:2px solid var(--ink);padding-bottom:8px;margin-bottom:10px}
.brand h1{font-size:15px;line-height:1.1;margin:0}.brand small{display:block;color:var(--muted);margin-top:4px;font-size:10px}
.meta{text-align:right}.meta .n{font-size:14px;font-weight:800}.meta .s{font-size:10px;color:var(--muted);margin-top:3px}
.section{border:1px solid var(--line);border-radius:8px;padding:8px 9px;margin-bottom:8px}
.section h3{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin:0 0 6px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 10px}.k{display:block;color:var(--muted);font-size:10px}.v{display:block;font-size:11px;font-weight:600;margin-top:1px}.wide{grid-column:1/-1}
.sign-space{flex:1;min-height:28px}
.signs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:8px}
.sign{padding-top:14px;border-top:1px solid #a1a1aa;text-align:center;font-size:10px;color:#3f3f46}
.foot{margin-top:10px;font-size:9px;color:#71717a;text-align:right}
</style></head><body><div class="sheet">
<header class="head"><div class="brand"><h1>MultiBur - Orden de Produccion</h1><small>Documento operativo para planta y control</small></div><div class="meta"><div class="n">Nro ${esc(r.numero_orden_fisica || ("#" + r.orden_id))}</div><div class="s">Emitido: ${esc(emitido)}</div></div></header>
<section class="section"><h3>Datos generales</h3><div class="grid">
<div><span class="k">Cliente</span><span class="v">${esc(r.cliente_nombre || "-")}</span></div>
<div><span class="k">Fecha entrega</span><span class="v">${esc(entrega)}</span></div>
<div><span class="k">Tipo cliente</span><span class="v">${esc(cliTipo)}</span></div>
<div><span class="k">Documento fiscal</span><span class="v">${esc(`${cliDocTipo} ${cliDocNum}`)}</span></div>
<div><span class="k">Estado</span><span class="v">${esc(r.estado || "-")}</span></div>
<div><span class="k">Prioridad</span><span class="v">${esc(r.prioridad || "NORMAL")}</span></div>
<div><span class="k">Nro OC</span><span class="v">${esc(ocNum)}</span></div>
<div class="wide"><span class="k">Trabajo</span><span class="v">${esc(r.descripcion_trabajo || "-")}</span></div>
</div></section>
<section class="section"><h3>Ficha tecnica</h3><div class="grid">
  <div><span class="k">Maquina sugerida</span><span class="v">${esc(r.maquina_sugerida_nombre || "-")}</span></div>
  <div><span class="k">Formato</span><span class="v">${esc(formato)}</span></div>
  <div><span class="k">Material</span><span class="v">${esc(material)}</span></div>
  <div><span class="k">Impresion / Color</span><span class="v">${esc(fmtTipoImpresion(r.tipo_impresion))} / ${esc(r.color_text || "-")}</span></div>
  <div><span class="k">Cantidad</span><span class="v">${esc(cantidad)}</span></div>
  <div><span class="k">Demasia</span><span class="v">${esc(demasia)}</span></div>
  <div class="wide"><span class="k">Procesos acabados</span><span class="v">${esc(procesosAcabados)}</span></div>
  <div class="wide"><span class="k">Observacion tecnica (impresor)</span><span class="v">${esc(obsTecnica)}</span></div>
  <div class="wide"><span class="k">Observacion acabados</span><span class="v">${esc(obsAcabados)}</span></div>
</div></section>
<div class="sign-space"></div>
<section class="signs"><div class="sign">Diseno / Preprensa</div><div class="sign">Produccion</div><div class="sign">Control de calidad</div></section>
<div class="foot">Orden interna MultiBur</div>
</div></body></html>`;
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) {
    msgJobs("ERROR: El navegador bloqueo la ventana de impresion.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}

async function loadJobs() {
  msgJobs("");
  const estadoRaw = $("fEstado")?.value || "";
  const estado = toDbEstado(estadoRaw);
  const limit = Number($("fLimit")?.value || 50);
  const q = ($("q")?.value || "").trim().toLowerCase();
  let rows = await fetchTrabajosAdminBoard({ estado });
  const metas = await fetchOrdenesMetaByIds((rows || []).map((r) => Number(r.orden_id)).filter(Boolean)).catch(() => []);
  const metaMap = new Map((metas || []).map((m) => [Number(m.id), m]));
  rows = (rows || []).map((r) => ({ ...r, is_external: hasExternalFlow(metaMap.get(Number(r.orden_id))?.observaciones_generales) }));
  if (!estado) rows = rows.filter((r) => estadoKey(r.estado) !== estadoKey(ESTADO_ENTREGADO));
  if (q) rows = rows.filter((r) => [r.numero_orden_fisica, r.cliente_nombre, r.descripcion_trabajo, r.estado, r.tipo_impresion, r.color_text, r.maquina_sugerida_nombre].join(" ").toLowerCase().includes(q));
  rows = rows.slice(0, Number.isFinite(limit) && limit > 0 ? limit : 50);
  const tb = $("tbJobs");
  if (!tb) return;
  tb.innerHTML = (rows || []).map((r) => {
    const formato = (r.medida_ancho && r.medida_alto) ? `${r.medida_ancho} x ${r.medida_alto}` : "-";
    const entrega = fmtEntrega(r.fecha_entrega);
    return `<tr>
      <td><b>${esc(r.numero_orden_fisica || ("#" + r.orden_id))}</b><div class="small muted">${esc(r.estado)} - ${renderPrioridadBadge(r.prioridad)}</div></td>
      <td>${esc(entrega)}</td>
      <td>${esc(r.cliente_nombre || "-")}</td>
      <td>${esc(r.descripcion_trabajo || "-")}</td>
      <td><b>${esc(formato)}</b><div class="small muted">${esc(r.papel_material || "")} ${esc(r.gramaje ? (r.gramaje + "g") : "")}</div></td>
      <td>${esc(fmtTipoImpresion(r.tipo_impresion))}</td>
      <td>${esc(r.color_text || "-")}</td>
      <td>${esc(r.maquina_sugerida_nombre || "-")}</td>
      <td><div class="row-actions">${renderAccion(r)}<button class="btn btn-ghost" type="button" data-action="detail" data-oid="${r.orden_id}" style="padding:8px 10px">Detalle</button></div></td>
    </tr>`;
  }).join("");

  tb.querySelectorAll('button[data-action="set"]').forEach((btn) => btn.addEventListener("click", async () => {
    const oid = Number(btn.getAttribute("data-oid"));
    const to = String(btn.getAttribute("data-to") || "");
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Procesando...";
    try {
      let extras = {};
      if (estadoKey(to) === estadoKey(ESTADO_ENTREGADO)) {
        const { data: { user } } = await supabase.auth.getUser();
        extras = { userId: user?.id || null, obsEntrega: null };
      }
      await updateOrdenEstado(oid, to, extras);
      msgJobs(`OK Orden ${oid} -> ${to}`);
      await loadJobs();
    } catch (e) {
      msgJobs("ERROR: No se pudo actualizar estado: " + (e?.message || e));
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }));

  tb.querySelectorAll('button[data-action="deliver"]').forEach((btn) => btn.addEventListener("click", async () => {
    const oid = Number(btn.getAttribute("data-oid"));
    const row = (rows || []).find((x) => Number(x.orden_id) === oid);
    if (!row) return;
    await openEntregaModal(row);
  }));

  tb.querySelectorAll('button[data-action="detail"]').forEach((btn) => btn.addEventListener("click", async () => {
    const oid = Number(btn.getAttribute("data-oid"));
    const row = (rows || []).find((x) => Number(x.orden_id) === oid);
    if (!row) return;
    const extra = await fetchOrdenById(oid).catch(() => null);
    openDetalleOrden(row, extra);
  }));

  msgJobs(`Cargados: ${(rows || []).length} trabajo(s).`);
}

async function loadRegistros() {
  const preset = $("rgPreset")?.value || "today";
  const fromDate = $("rgFrom")?.value || "";
  const toDate = $("rgTo")?.value || "";
  const ordenId = $("rgOrden")?.value ? Number($("rgOrden").value) : null;
  const userId = $("rgOperador")?.value || "";
  const regs = await fetchRegistros({ preset, fromDate, toDate, ordenId, userId, limit: 300 });
  const orderIds = [...new Set((regs || []).map((r) => r.orden_id).filter(Boolean))];
  const userIds = [...new Set((regs || []).map((r) => r.user_id).filter(Boolean))];
  const maqIds = [...new Set((regs || []).map((r) => r.maquina_id).filter(Boolean))];
  const [ordenes, users, maqs] = await Promise.all([fetchOrdenResumenByIds(orderIds), fetchProfilesByIds(userIds), fetchMaquinasByIds(maqIds)]);
  const ordenMap = new Map((ordenes || []).map((o) => [o.orden_id, o.numero_orden_fisica]));
  const userMap = new Map((users || []).map((u) => [u.id, getProfileDisplayName(u) || u.username || u.id]));
  const maqMap = new Map((maqs || []).map((m) => [m.id, m.nombre]));

  const selOperador = $("rgOperador");
  if (selOperador) {
    const current = selOperador.value || "";
    selOperador.innerHTML = `<option value="">Todos</option>` + (users || []).map((u) => `<option value="${u.id}">${esc(getProfileDisplayName(u) || u.username || u.id)}</option>`).join("");
    selOperador.value = current;
  }

  const tb = $("tbRegs");
  if (tb) {
    tb.innerHTML = (regs || []).map((r) => `<tr>
      <td>${esc(ordenMap.get(r.orden_id) || ("#" + r.orden_id))}</td>
      <td>${esc(userMap.get(r.user_id) || r.user_id || "-")}</td>
      <td>${esc(maqMap.get(r.maquina_id) || r.maquina_id || "-")}</td>
      <td>${esc(fmtDTPE(r.hora_inicio))}</td>
      <td>${esc(fmtDTPE(r.hora_fin))}</td>
      <td>${esc(r.cantidad_buena ?? "-")}</td>
      <td>${esc(r.cantidad_mala ?? 0)}</td>
    </tr>`).join("");
  }
  setKPIs(regs);
  msgRegs(`Registros cargados: ${(regs || []).length}`);
}

async function onGuardarOrden() {
  const miss = validateOrdenForm();
  if (miss.length) {
    refreshFormState();
    return;
  }
  const btn = $("btnGuardarOrden");
  const old = btn?.textContent || "Guardar Orden";
  try {
    if (btn) { btn.disabled = true; btn.textContent = "Guardando..."; }
    const isExt = $("o_externo")?.checked ?? false;
    const obsBase = ($("o_obs")?.value || "").trim();
    const obs = isExt
      ? (hasExternalFlow(obsBase) ? obsBase : `${EXTERNAL_TAG}${obsBase ? ` ${obsBase}` : ""}`.trim())
      : (obsBase || null);
    const orden = {
      cliente_id: Number($("o_cliente").value),
      descripcion_trabajo: $("o_desc").value.trim(),
      fecha_entrega: dbLocalTimestamp($("o_entrega").value),
      prioridad: $("o_prio")?.value || "NORMAL",
      estado: toDbEstado(isExt ? "DISENO" : ($("o_estado")?.value || "DISENO")),
      responsable_diseno: $("o_resp")?.value?.trim() || null,
      observaciones_generales: obs,
      tiene_oc: $("o_tiene_oc")?.checked ?? false,
      oc_numero: $("o_tiene_oc")?.checked ? ($("o_oc_numero")?.value?.trim() || null) : null,
      oc_observacion: $("o_tiene_oc")?.checked ? ($("o_oc_obs")?.value?.trim() || null) : null
    };
    const selectedMaterialId = $("d_material")?.value ? Number($("d_material").value) : null;
    const selectedFormatoOpt = $("d_formato")?.selectedOptions?.[0] || null;
    const selectedMaterial = (materialesCache || []).find((m) => Number(m.id) === Number(selectedMaterialId));
    const formatoAncho = toNumOrNull(selectedFormatoOpt?.dataset?.ancho);
    const formatoAlto = toNumOrNull(selectedFormatoOpt?.dataset?.alto);
    const gramajeFromMaterial = toNumOrNull(selectedMaterial?.gramaje);
    const gramajeFinal = toNumOrNull($("d_gram")?.value) ?? gramajeFromMaterial;
    const anchoFinal = toNumOrNull($("d_ancho")?.value) ?? formatoAncho;
    const altoFinal = toNumOrNull($("d_alto")?.value) ?? formatoAlto;
    const cantFinal = toNumOrNull($("d_cant")?.value);
    const demasiaFinal = isExt ? null : toNumOrNull($("d_dem")?.value);

    if (!cantFinal || cantFinal <= 0) {
      msgCreate("ERROR: La cantidad debe ser mayor a 0.");
      return;
    }

    const detalles = {
      papel_material: $("d_papel")?.value?.trim() || selectedMaterial?.nombre || null,
      gramaje: gramajeFinal,
      medida_ancho: anchoFinal,
      medida_alto: altoFinal,
      material_id: selectedMaterialId,
      formato_id: $("d_formato")?.value ? Number($("d_formato").value) : null,
      cantidad_solicitada: cantFinal,
      demasia: demasiaFinal,
      maquina_sugerida_id: isExt ? null : (Number($("d_maq").value) || null),
      tipo_impresion: isExt ? null : toDbTipoImpresion($("d_tipoimp")?.value),
      observacion_tecnica: isExt ? null : ($("d_obs_tecnica")?.value?.trim() || null),
      color_mode: $("d_color_mode")?.value || "FC",
      color_text: $("d_color_text")?.value?.trim() || "F/C",
      corte: $("p_corte")?.checked ?? false,
      empaquetado: $("p_empaq")?.checked ?? false,
      doblez: $("p_doblez")?.checked ?? false,
      compaginado: $("p_compa")?.checked ?? false,
      troquelado: $("p_troq")?.checked ?? false,
      sectorizado: $("p_sect")?.checked ?? false,
      barniz: $("p_barniz")?.checked ?? false,
      plastificado: $("p_plast")?.value || null
    };
    const res = await createOrdenConDetalles({ orden, detalles });
    const ordSaved = await fetchOrdenById(res.id).catch(() => null);
    const entregaSaved = fmtEntrega(ordSaved?.fecha_entrega);
    msgCreate(
      `OK Orden creada\nID: ${res.id}\nNro Orden: ${res.numero_orden_fisica || ("#" + res.id)}\nEntrega guardada: ${entregaSaved}`
    );
    await loadJobs();
    await loadRegistros();
    $("o_desc").value = "";
    $("o_obs").value = "";
    if ($("d_obs_tecnica")) $("d_obs_tecnica").value = "";
    if ($("o_tiene_oc")) $("o_tiene_oc").checked = false;
    if ($("o_oc_numero")) $("o_oc_numero").value = "";
    if ($("o_oc_obs")) $("o_oc_obs").value = "";
    syncOcFields();
    $("modalOrdenWrap")?.classList.add("hide");
  } catch (e) {
    console.error("CREATE_ORDEN_ERROR", e);
    const detail = e?.details ? `\nDetalle: ${e.details}` : "";
    const hint = e?.hint ? `\nHint: ${e.hint}` : "";
    const code = e?.code ? `\nCode: ${e.code}` : "";
    msgCreate("ERROR guardando orden: " + (e?.message || e) + code + detail + hint);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = old; }
    refreshFormState();
  }
}

function syncRegsPresetChips() {
  const current = $("rgPreset")?.value || "today";
  document.querySelectorAll("#rgQuickPresets .regs-chip").forEach((chip) => {
    const active = chip.getAttribute("data-rg-preset") === current;
    chip.classList.toggle("is-active", active);
  });
}

function csvCell(v) {
  const s = String(v ?? "");
  if (!/[",\n]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, rows) {
  const content = rows.map((r) => r.map(csvCell).join(",")).join("\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function exportReporteEntregadosCsv() {
  try {
    const { clienteId, dateFrom, dateTo } = getReporteFilters();
    if (dateFrom && dateTo && dateFrom > dateTo) {
      msgJobs("ERROR: El rango de fechas no es valido (Desde no puede ser mayor a Hasta).");
      return;
    }
    msgJobs("Generando reporte de entregados...");
    const rows = await fetchReporteEntregados({
      clienteId: clienteId || null,
      dateFrom,
      dateTo,
      limit: 2000
    });
    if (!rows.length) {
      msgJobs("No hay trabajos en estado ENTREGADO para exportar.");
      return;
    }
    const fmt = (x) => fmtEntrega(x);
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
        <td>${esc(fmtTipoImpresion(r.tipo_impresion))}</td>
        <td>${esc(r.color)}</td>
        ${isServicioOnly ? "" : `<td>${esc((r.oc_numero || "").trim() || "NO")}</td>`}
        ${isServicioOnly ? "" : `<td>${esc((r.guia_numero || "").trim() || "NO")}</td><td>${esc(r.guia_observacion || "-")}</td>`}
        <td>${esc(String(r.cantidad ?? "-"))}</td>
        <td>${esc(fmt(r.fecha_entregado))}</td>
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
      <div class="sub">${isServicioOnly ? "Formato: Servicio de impresion (sin OC ni guia)." : "Formato: Completo."}</div>
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
      msgJobs("ERROR: El navegador bloqueo la ventana del reporte.");
      return;
    }
    w.document.open();
    w.document.write(printHtml);
    w.document.close();
    msgJobs(`OK Reporte generado: ${rows.length} registro(s). Filtro cliente: ${selectedCliente}.`);
  } catch (e) {
    msgJobs("ERROR generando reporte: " + (e?.message || e));
  }
}

(async function init() {
  const prof = await requireAdmin();
  if (!prof) return;
  const dn = getProfileDisplayName(prof);
  const un = String(prof?.username || "").trim();
  const identity = un && dn && dn !== un ? `${dn} (${un})` : (dn || un || "Usuario");
  setText("userPill", `${identity} | ${prof.rol}`);

  $("btnLogout")?.addEventListener("click", async () => { await logout(); window.location.href = "./login.html"; });
  $("btnReporteEntregados")?.addEventListener("click", exportReporteEntregadosCsv);
  $("btnClearRepFilters")?.addEventListener("click", () => {
    if ($("repCliente")) $("repCliente").value = "";
    if ($("repDesde")) $("repDesde").value = "";
    if ($("repHasta")) $("repHasta").value = "";
    msgJobs("Filtros de reporte limpiados.");
  });
  $("btnReloadJobs")?.addEventListener("click", loadJobs);
  $("btnReloadRegs")?.addEventListener("click", loadRegistros);
  $("btnApplyRegs")?.addEventListener("click", loadRegistros);
  $("q")?.addEventListener("input", debounce(loadJobs, 250));
  $("fLimit")?.addEventListener("change", loadJobs);
  $("fEstado")?.addEventListener("change", loadJobs);
  $("o_cliente")?.addEventListener("change", syncClienteSelectedText);
  $("o_tiene_oc")?.addEventListener("change", () => { syncOcFields(); refreshFormState(); });
  $("o_oc_numero")?.addEventListener("input", refreshFormState);
  $("d_material")?.addEventListener("change", syncMaterialSelectedText);
  $("o_externo")?.addEventListener("change", syncExternalFlowUI);
  $("btnOpenOrden")?.addEventListener("click", () => {
    $("modalOrdenWrap")?.classList.remove("hide");
    syncExternalFlowUI();
    refreshFormState();
  });
  $("btnCloseOrden")?.addEventListener("click", () => $("modalOrdenWrap")?.classList.add("hide"));
  $("modalOrdenWrap")?.addEventListener("click", (ev) => { if (ev.target && ev.target.id === "modalOrdenWrap") $("modalOrdenWrap")?.classList.add("hide"); });
  $("btnGuardarOrden")?.addEventListener("click", onGuardarOrden);

  $("btnCloseDetail")?.addEventListener("click", closeDetalleOrden);
  $("btnPrintDetail")?.addEventListener("click", () => { if (detailRowCtx) printOrden(detailRowCtx, detailExtraCtx); });
  $("jobDetailWrap")?.addEventListener("click", (ev) => { if (ev.target && ev.target.id === "jobDetailWrap") closeDetalleOrden(); });
  $("btnCloseEntrega")?.addEventListener("click", closeEntregaModal);
  $("btnConfirmEntrega")?.addEventListener("click", confirmEntregaDesdeModal);
  $("e_tiene_guia")?.addEventListener("change", syncEntregaGuiaFields);
  $("entregaWrap")?.addEventListener("click", (ev) => { if (ev.target && ev.target.id === "entregaWrap") closeEntregaModal(); });

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

  ["o_desc", "o_entrega", "d_cant", "d_maq", "d_tipoimp", "d_color_mode", "d_color_text", "d_formato"].forEach((id) => {
    $(id)?.addEventListener("input", refreshFormState);
    $(id)?.addEventListener("change", refreshFormState);
  });

  wireSmartPickers();
  await loadCombosClientesMaquinas();
  await loadCombosMaterialesFormatos();
  wireAutoFillMaterialFormato();
  syncOcFields();
  syncEntregaGuiaFields();
  syncExternalFlowUI();
  refreshFormState();
  await loadJobs();
  await loadRegistros();
})().catch((e) => {
  console.error("ADMIN_INIT_ERROR:", e);
  setText("userPill", "Error de carga");
  msgJobs("ERROR inicializando Admin: " + (e?.message || e));
  msgRegs("Revisa consola del navegador.");
});
