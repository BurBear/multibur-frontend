import { requireAdmin, logout, getProfileDisplayName } from "../auth.js";
import { $, setText, debounce } from "../ui.js";
import { initFullscreenToggle } from "../fullscreen.js";
import { normalizeText, escapeHtml, formatDbError, toNumOrNull, getClientColor, getClientBgColor } from "../utils/helpers.js";
import { fmtDateTimePE } from "../utils/formatters.js";
import { msgJobs, msgRegs, msgCreate, showToast } from "./admin-ui.js";
import { bindAdminRealtime } from "./admin-realtime.js";
import { bindAdminEvents } from "./admin-events.js";
import { isEditableEstado, toDbTipoImpresion, toDbColorMode, fmtTipoImpresion } from "./admin-orders.js";
import {
  renderPrioridadBadge,
  renderPinnedBadge,
  renderIncidenciaBadge,
  getProcesosAcabadosText,
  renderOverdueBadge,
  renderRouteStatusPill
} from "./admin-render.js";
import { syncRegsPresetChips, createLiveDurationHelpers } from "./admin-registros.js";
import { csvCell, downloadCsv } from "./admin-actions.js";
import {
  buildExternalObservaciones,
  resolveExternalFlag,
  stripLegacyExternalTag
} from "../orders/external-flow.js";
import {
  fetchClientes,
  fetchMaquinas,
  fetchTrabajosAdminBoardSnapshot,
  fetchOrdenesAncladas,
  fetchUltimasIncidenciasByOrdenIds,
  fetchUltimosEstadosProduccionByOrdenIds,
  fetchRegistros,
  fetchProfilesByIds,
  fetchMaquinasByIds,
  createOrdenConDetalles,
  updateOrdenConDetalles,
  fetchOrdenById,
  fetchOrdenResumenByIds,
  fetchClienteTiposByOrdenIds,
  fetchOrdenesMetaByIds,
  fetchReporteEntregados,
  rpcSetOrdenAnclada,
  rpcFinalizarEntregaOrden,
  rpcTransferirOrdenRuta
} from "../api.js";
import { supabase } from "../supabaseClient.js";

const ESTADO_FINAL = "TERMINADO";
const ESTADO_ENTREGADO = "ENTREGADO";
let clientesCache = [];
let materialesCache = [];
let detailRowCtx = null;
let detailExtraCtx = null;
let entregaCtx = null;
let entregaRequiresGuia = false;
let smartMode = null;
let smartSelectedId = null;
const { formatDurationMinutes, refreshLiveDurationLabels, ensureLiveDurationTicker } = createLiveDurationHelpers();
let currentAdminResponsable = "Administrador";
let ordenModalMode = "create";
let ordenEditId = null;
let routeProcessDraft = [];
let liveRegsStatusText = "";
let jobsBoardRowsCache = [];
let adminBoardHeightObserver = null;
const ADMIN_PENDING_PINS_KEY = "multibur_admin_pending_pins_v1";
const ADMIN_LIVE_PANEL_MODE_KEY = "multibur_admin_live_panel_mode_v1";

function readLocalJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeLocalJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore localStorage errors in preview mode
  }
}

function syncAdminPanelHeights() {
  const boardCard = $("adminBoardCard");
  const sideCard = $("adminSideCard");
  if (!boardCard || !sideCard) return;
  if (window.innerWidth <= 1200) {
    sideCard.style.height = "";
    return;
  }
  const boardHeight = Math.ceil(boardCard.getBoundingClientRect().height || 0);
  if (!boardHeight) return;
  sideCard.style.height = `${boardHeight}px`;
}

function bindAdminPanelHeightSync() {
  if (adminBoardHeightObserver) return;
  const boardCard = $("adminBoardCard");
  if (!boardCard || typeof ResizeObserver === "undefined") return;
  adminBoardHeightObserver = new ResizeObserver(() => syncAdminPanelHeights());
  adminBoardHeightObserver.observe(boardCard);
  window.addEventListener("resize", syncAdminPanelHeights);
}

let livePanelMode = String(readLocalJson(ADMIN_LIVE_PANEL_MODE_KEY, "") || "").trim().toLowerCase();
let pendingPinnedOrderIds = new Set(
  (readLocalJson(ADMIN_PENDING_PINS_KEY, []) || [])
    .map((value) => Number(value))
    .filter(Boolean)
);
let pendingPinsStorageMode = pendingPinnedOrderIds.size ? "local" : "unknown";
let pendingPinsLegacySyncDone = false;
const PROCESS_ROUTE_META = Object.freeze({
  corte: { key: "corte", inputId: "p_corte", label: "Corte", module: "CORTADOR" },
  empaquetado: { key: "empaquetado", inputId: "p_empaq", label: "Empaquetado", module: "ACABADOS" },
  doblez: { key: "doblez", inputId: "p_doblez", label: "Doblez", module: "ACABADOS" },
  compaginado: { key: "compaginado", inputId: "p_compa", label: "Compaginado", module: "ACABADOS" },
  troquelado: { key: "troquelado", inputId: "p_troq", label: "Troquelado", module: "ACABADOS" },
  sectorizado: { key: "sectorizado", inputId: "p_sect", label: "Sectorizado", module: "ACABADOS" },
  barniz: { key: "barniz", inputId: "p_barniz", label: "Barniz", module: "ACABADOS" },
  plastificado: { key: "plastificado", inputId: null, label: "Plastificado", module: "ACABADOS" },
  encolado: { key: "encolado", inputId: "p_encolado", label: "Encolado", module: "ACABADOS" },
  marcado: { key: "marcado", inputId: "p_marcado", label: "Marcado", module: "ACABADOS" },
  anillado: { key: "anillado", inputId: "p_anillado", label: "Anillado", module: "ACABADOS" },
  perforado: { key: "perforado", inputId: "p_perforado", label: "Perforado", module: "ACABADOS" },
  pegado_solapa: { key: "pegado_solapa", inputId: "p_pegado_solapa", label: "Pegado solapa", module: "ACABADOS" },
  semi_corte: { key: "semi_corte", inputId: "p_semi_corte", label: "Semi corte", module: "ACABADOS" },
  enumerado: { key: "enumerado", inputId: "p_enumerado", label: "Enumerado", module: "ACABADOS" }
});
const PROCESS_VARIANT_META = Object.freeze({
  plastificado: {
    key: "plastificado",
    controlId: "p_plast",
    routeControlId: "routePlastMode",
    label: "Modo de plastificado",
    defaultValue: "BRILLO",
    options: [
      { value: "BRILLO", label: "BRILLO" },
      { value: "MATE", label: "MATE" }
    ],
    renderDisplay: (value) => `Plastificado (${value || "BRILLO"})`
  },
  perforado: {
    key: "perforado",
    controlId: "p_perforado_tipo",
    routeControlId: "routePerforadoTipo",
    label: "Tipo de perforado",
    defaultValue: "PERFORADO",
    options: [
      { value: "PERFORADO", label: "Perforado" },
      { value: "PICADO_PERFORADO", label: "Picado/Perforado" }
    ],
    renderDisplay: (value) => (
      value === "PICADO_PERFORADO"
        ? "Perforado (Picado/Perforado)"
        : "Perforado"
    )
  }
});

const norm = normalizeText;
const esc = escapeHtml;
const fmtDTPE = fmtDateTimePE;

function bindRealtime() {
  bindAdminRealtime({
    supabase,
    fetchOrdenResumenByIds,
    fetchProfilesByIds,
    getProfileDisplayName,
    showToast,
    loadJobs,
    loadRegistros
  });
}

function syncResponsableDisenoField() {
  const input = $("o_resp");
  if (!input) return;
  input.value = currentAdminResponsable || "Administrador";
}



function hasExternalFlow(obs) {
  return resolveExternalFlag({ observacionesGenerales: obs });
}

function toDbEstado(v) {
  const n = norm(v);
  if (n === "diseno") return "DISEÑO";
  return String(v || "");
}

function estadoKey(v) {
  return norm(v).toUpperCase();
}

function toCanonicalDbEstado(v) {
  const n = norm(v);
  if (n === "diseno") return "DISENO";
  return String(v || "");
}

function resolveExternalCompat(row = null) {
  return resolveExternalFlag({
    esExterno: row?.es_externo,
    observacionesGenerales: row?.observaciones_generales
  });
}



function setKPIs(regs) {
  setText("kRegs", String((regs || []).length));
  setText("kAct", String((regs || []).filter((x) => !x.hora_fin).length));
  const last = regs?.[0]?.hora_inicio
    ? new Date(regs[0].hora_inicio).toLocaleTimeString("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit" }).replace(/\s?a\.?\s*m\.?/i, 'am').replace(/\s?p\.?\s*m\.?/i, 'pm')
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

function splitEntregaLabel(value) {
  const raw = String(value || "-").trim();
  if (!raw || raw === "-") return { date: "-", time: "" };
  const parts = raw.split(",");
  if (parts.length >= 2) {
    return {
      date: parts[0].trim() || "-",
      time: parts.slice(1).join(",").trim()
    };
  }
  return { date: raw, time: "" };
}



function normalizeTipoCliente(v) {
  const t = String(v || "").trim().toUpperCase();
  if (!t) return "";
  if (t.includes("SERVICIO")) return "SERVICIO";
  if (t.includes("DIRECTO")) return "DIRECTO";
  return t || "";
}

function isDeliverableTrackedRow(row) {
  if (!row) return false;
  const e = estadoKey(row.estado);
  if (e === estadoKey(ESTADO_ENTREGADO)) return false;
  return e === estadoKey(ESTADO_FINAL) || !!row.route_all_closed;
}

function isTrackedDirectRow(row) {
  if (!row) return false;
  const e = estadoKey(row.estado);
  if (e === estadoKey(ESTADO_ENTREGADO)) return false;
  if (pendingPinnedOrderIds.has(Number(row?.orden_id))) return true;
  if (normalizeTipoCliente(row?.cliente_tipo) !== "DIRECTO") return false;
  if (isDeliverableTrackedRow(row)) return true;
  return e === "PLACAS" || e === "IMPRESION" || e === "ACABADOS";
}

function getTrackedDirectStageRank(row) {
  if (isDeliverableTrackedRow(row)) return 0;
  const e = estadoKey(row?.estado);
  if (e === "ACABADOS") return 1;
  if (e === "IMPRESION") return 2;
  if (e === "PLACAS") return 3;
  if (e === "DISENO") return 4;
  return 5;
}

function getTrackedDirectBadgeLabel(row) {
  if (!row) return "-";
  if (isDeliverableTrackedRow(row)) return "Listo para entregar";

  const e = estadoKey(row.estado);
  const prodEstado = String(row?.produccion_estado || "").trim().toUpperCase();
  const routeLabel = String(row?.route_badge_label || "").trim();

  if (e === "PLACAS") return "Listo para operador";
  if (e === "IMPRESION") return prodEstado === "PAUSADO" ? "Pausado en impresion" : "Imprimiendo";
  if (e === "ACABADOS") return routeLabel || String(row?.route_stage_primary || "").trim() || "En acabados";
  if (e === "DISENO") return "En diseno";
  return routeLabel || row?.estado || "-";
}

function parseSortNumeroOrden(row) {
  const raw = String(row?.numero_orden_fisica || "").replace(/\D/g, "");
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  return Number(row?.orden_id || 0) || 0;
}

function getPinnedOrderRank(ordenId) {
  const oid = Number(ordenId);
  if (!oid) return null;
  const ids = [...pendingPinnedOrderIds];
  const index = ids.findIndex((value) => Number(value) === oid);
  return index >= 0 ? index + 1 : null;
}

function setPinnedOrderIds(ids = []) {
  const orderedIds = [...new Set((ids || []).map((value) => Number(value)).filter(Boolean))];
  pendingPinnedOrderIds = new Set(orderedIds);
}

function getLegacyPinnedOrderIds() {
  return [...new Set(
    (readLocalJson(ADMIN_PENDING_PINS_KEY, []) || [])
      .map((value) => Number(value))
      .filter(Boolean)
  )];
}

function clearLegacyPinnedOrderIds() {
  try {
    window.localStorage.removeItem(ADMIN_PENDING_PINS_KEY);
  } catch {
    writeLocalJson(ADMIN_PENDING_PINS_KEY, []);
  }
}

async function loadSharedPinnedOrders({ syncLegacy = false } = {}) {
  let dbPins = null;
  try {
    dbPins = await fetchOrdenesAncladas();
  } catch (error) {
    console.warn("No pude cargar las ordenes ancladas compartidas.", error);
    pendingPinsStorageMode = "local";
    return [...pendingPinnedOrderIds];
  }

  if (dbPins === null) {
    pendingPinsStorageMode = "local";
    return [...pendingPinnedOrderIds];
  }

  pendingPinsStorageMode = "db";
  let orderedIds = dbPins.map((row) => Number(row?.orden_id)).filter(Boolean);

  if (syncLegacy && !pendingPinsLegacySyncDone) {
    const legacyIds = getLegacyPinnedOrderIds();
    const missingLegacyIds = legacyIds.filter((id) => !orderedIds.includes(id));
    let migrationFailed = false;

    if (missingLegacyIds.length) {
      for (const ordenId of missingLegacyIds) {
        try {
          await rpcSetOrdenAnclada({ ordenId, pin: true });
        } catch (error) {
          migrationFailed = true;
          console.warn(`No pude migrar el anclado local de la orden ${ordenId}.`, error);
        }
      }

      const refreshedPins = await fetchOrdenesAncladas().catch(() => dbPins);
      orderedIds = (refreshedPins || []).map((row) => Number(row?.orden_id)).filter(Boolean);
    }

    if (!migrationFailed) {
      clearLegacyPinnedOrderIds();
      pendingPinsLegacySyncDone = true;
    }
  }

  setPinnedOrderIds(orderedIds);
  return orderedIds;
}

function comparePendingEntregaRows(a, b) {
  const aPinned = pendingPinnedOrderIds.has(Number(a?.orden_id)) ? 0 : 1;
  const bPinned = pendingPinnedOrderIds.has(Number(b?.orden_id)) ? 0 : 1;
  if (aPinned !== bPinned) return aPinned - bPinned;
  if (aPinned === 0 && bPinned === 0) {
    const aRank = getPinnedOrderRank(a?.orden_id) || Number.MAX_SAFE_INTEGER;
    const bRank = getPinnedOrderRank(b?.orden_id) || Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;
  }

  const aTipo = normalizeTipoCliente(a?.cliente_tipo) === "DIRECTO" ? 0 : 1;
  const bTipo = normalizeTipoCliente(b?.cliente_tipo) === "DIRECTO" ? 0 : 1;
  if (aTipo !== bTipo) return aTipo - bTipo;

  const aStage = getTrackedDirectStageRank(a);
  const bStage = getTrackedDirectStageRank(b);
  if (aStage !== bStage) return aStage - bStage;

  const aPrio = String(a?.prioridad || "").trim().toUpperCase() === "URGENTE" ? 0 : 1;
  const bPrio = String(b?.prioridad || "").trim().toUpperCase() === "URGENTE" ? 0 : 1;
  if (aPrio !== bPrio) return aPrio - bPrio;

  const aEntrega = parseEntregaDate(a?.fecha_entrega)?.getTime() || Number.MAX_SAFE_INTEGER;
  const bEntrega = parseEntregaDate(b?.fecha_entrega)?.getTime() || Number.MAX_SAFE_INTEGER;
  if (aEntrega !== bEntrega) return aEntrega - bEntrega;

  return parseSortNumeroOrden(a) - parseSortNumeroOrden(b);
}

function getPendingEntregaRows(rows = jobsBoardRowsCache) {
  return (rows || []).filter(isTrackedDirectRow).sort(comparePendingEntregaRows);
}

function sortJobsBoardRows(rows = []) {
  return (rows || [])
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const aPinned = pendingPinnedOrderIds.has(Number(a?.row?.orden_id)) ? 0 : 1;
      const bPinned = pendingPinnedOrderIds.has(Number(b?.row?.orden_id)) ? 0 : 1;
      if (aPinned !== bPinned) return aPinned - bPinned;
      if (aPinned === 0 && bPinned === 0) {
        const aRank = getPinnedOrderRank(a?.row?.orden_id) || Number.MAX_SAFE_INTEGER;
        const bRank = getPinnedOrderRank(b?.row?.orden_id) || Number.MAX_SAFE_INTEGER;
        if (aRank !== bRank) return aRank - bRank;
      }
      return a.index - b.index;
    })
    .map(({ row }) => row);
}

function setLivePanelMode(mode = "produccion") {
  livePanelMode = String(mode || "produccion").trim().toLowerCase() === "pendientes"
    ? "pendientes"
    : "produccion";
  writeLocalJson(ADMIN_LIVE_PANEL_MODE_KEY, livePanelMode);
  syncLivePanelMode();
}

function syncLivePanelMode() {
  const liveButton = $("btnRegsViewLive");
  const pendingButton = $("btnRegsViewPending");
  const pendingCount = $("btnRegsPendingCount");
  const liveSection = $("regsLiveSection");
  const pendingSection = $("regsPendingSection");
  const pendingRows = getPendingEntregaRows();
  const effectiveMode = livePanelMode || (pendingRows.length ? "pendientes" : "produccion");

  if (pendingCount) {
    const total = pendingRows.length;
    pendingCount.hidden = total <= 0;
    pendingCount.textContent = total > 99 ? "99+" : String(total);
  }

  if (liveButton) liveButton.classList.toggle("is-active", effectiveMode === "produccion");
  if (pendingButton) pendingButton.classList.toggle("is-active", effectiveMode === "pendientes");
  if (liveSection) liveSection.hidden = effectiveMode !== "produccion";
  if (pendingSection) pendingSection.hidden = effectiveMode !== "pendientes";
  if (effectiveMode === "produccion") {
    msgRegs(liveRegsStatusText || "Sin operadores activos.");
    return;
  }

  const directCount = pendingRows.filter((row) => normalizeTipoCliente(row?.cliente_tipo) === "DIRECTO").length;
  const pinnedCount = pendingRows.filter((row) => pendingPinnedOrderIds.has(Number(row?.orden_id))).length;
  msgRegs(
    pendingRows.length
      ? `${pendingRows.length} seguimiento(s) - ${directCount} directo(s) - ${pinnedCount} anclado(s)`
      : "No hay trabajos directos en seguimiento."
  );
  syncAdminPanelHeights();
}

async function togglePinnedPendingOrder(ordenId) {
  const oid = Number(ordenId);
  if (!oid) return;

  if (pendingPinsStorageMode === "db") {
    await rpcSetOrdenAnclada({
      ordenId: oid,
      pin: !pendingPinnedOrderIds.has(oid)
    });
    await loadSharedPinnedOrders();
  } else {
    if (pendingPinnedOrderIds.has(oid)) pendingPinnedOrderIds.delete(oid);
    else pendingPinnedOrderIds.add(oid);
    writeLocalJson(ADMIN_PENDING_PINS_KEY, [...pendingPinnedOrderIds]);
  }

  await loadJobs();
}

async function openPendingPanelDetail(ordenId) {
  const oid = Number(ordenId);
  if (!oid) return;
  const row = (jobsBoardRowsCache || []).find((item) => Number(item?.orden_id) === oid);
  if (!row) {
    msgRegs("No se encontro la orden para abrir el detalle.");
    return;
  }
  const extra = await fetchOrdenById(oid).catch(() => null);
  openDetalleOrden(row, extra);
}

function renderPendingEntregaCards(rows = jobsBoardRowsCache) {
  const wrap = $("regsPendingList");
  if (!wrap) return;

  const pendingRows = getPendingEntregaRows(rows);

  if (!pendingRows.length) {
    wrap.innerHTML = `<div class="live-empty">No hay trabajos directos en seguimiento.</div>`;
    syncLivePanelMode();
    return;
  }

  wrap.innerHTML = pendingRows.map((row) => {
    const pinned = pendingPinnedOrderIds.has(Number(row?.orden_id));
    const pinnedRank = pinned ? getPinnedOrderRank(row?.orden_id) : null;
    const tipoCliente = normalizeTipoCliente(row?.cliente_tipo) || "SERVICIO";
    const entrega = splitEntregaLabel(fmtEntrega(row?.fecha_entrega));
    const prioridadBadge = renderPrioridadBadge(row?.prioridad);
    const badgeLabel = getTrackedDirectBadgeLabel(row);
    const overdue = isOrdenOverdue(row?.fecha_entrega, row?.estado);
    const canDeliver = isDeliverableTrackedRow(row);
    const actionLabel = canDeliver ? "Entregar" : "Ver detalle";
    const actionClass = canDeliver ? "btn btn-deliver" : "btn btn-ghost";

    return `
      <article class="pending-card ${tipoCliente === "DIRECTO" ? "is-directo" : ""} ${pinned ? "is-pinned" : ""}">
        <div class="pending-card-head">
          <div class="pending-card-title">
            <div class="pending-card-order">
              ${pinnedRank ? `<span class="pin-order-badge" title="Anclado #${pinnedRank}" aria-label="Anclado ${pinnedRank}">${pinnedRank}</span>` : ""}
              <span>Orden ${esc(row?.numero_orden_fisica || `#${row?.orden_id}`)}</span>
            </div>
            <div class="pending-card-client">${esc(row?.cliente_nombre || "-")}</div>
            <div class="pending-card-job">${esc(row?.descripcion_trabajo || "-")}</div>
          </div>
          <div class="pending-card-badges">
            <span class="pending-chip ${tipoCliente === "DIRECTO" ? "is-directo" : "is-servicio"}">${esc(tipoCliente)}</span>
            ${pinned ? renderPinnedBadge() : ""}
          </div>
        </div>

        <div class="pending-card-grid">
          <div class="pending-card-meta">
            <span class="k">Entrega</span>
            <span class="v">${esc(entrega.date)}</span>
          </div>
          <div class="pending-card-meta">
            <span class="k">Hora</span>
            <span class="v">${esc(entrega.time || "-")}</span>
          </div>
          <div class="pending-card-meta">
            <span class="k">Estado</span>
            <span class="v">${esc(badgeLabel)}</span>
          </div>
          <div class="pending-card-meta">
            <span class="k">Prioridad</span>
            <span class="v">${prioridadBadge}${overdue ? `<div class="small" style="margin-top:4px">${renderOverdueBadge(true)}</div>` : ""}</span>
          </div>
        </div>

        <div class="pending-card-actions">
          <button class="btn btn-pin ${pinned ? "is-pinned" : ""}" type="button" data-pending-action="pin" data-oid="${row.orden_id}">
            ${pinned ? "Desanclar" : "Anclar"}
          </button>
          <button class="${actionClass}" type="button" data-pending-action="${canDeliver ? "deliver" : "detail"}" data-oid="${row.orden_id}">
            ${actionLabel}
          </button>
        </div>
      </article>
    `;
  }).join("");

  syncLivePanelMode();
  syncAdminPanelHeights();
}

async function buildAdminBoardSupport(orderIds = []) {
  const uniqueOrderIds = [...new Set((orderIds || []).map((value) => Number(value)).filter(Boolean))];
  if (!uniqueOrderIds.length) {
    return {
      metaMap: new Map(),
      incidenciaMap: new Map(),
      produccionEstadoMap: new Map(),
      tipoClienteMap: new Map()
    };
  }

  const [metas, incidencias, produccionEstados, clienteTipos] = await Promise.all([
    fetchOrdenesMetaByIds(uniqueOrderIds).catch(() => []),
    fetchUltimasIncidenciasByOrdenIds(uniqueOrderIds).catch(() => []),
    fetchUltimosEstadosProduccionByOrdenIds(uniqueOrderIds).catch(() => []),
    fetchClienteTiposByOrdenIds(uniqueOrderIds).catch(() => [])
  ]);

  return {
    metaMap: new Map((metas || []).map((m) => [Number(m.id), m])),
    incidenciaMap: new Map((incidencias || []).map((i) => [Number(i.orden_id), i])),
    produccionEstadoMap: new Map((produccionEstados || []).map((s) => [Number(s.orden_id), s])),
    tipoClienteMap: new Map(
      (clienteTipos || []).map((o) => [Number(o.id), normalizeTipoCliente(o?.cliente?.tipo_cliente)])
    )
  };
}

function hydrateAdminBoardRows(rows = [], support = null) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!safeRows.length) return [];

  const metaMap = support?.metaMap || new Map();
  const incidenciaMap = support?.incidenciaMap || new Map();
  const produccionEstadoMap = support?.produccionEstadoMap || new Map();
  const tipoClienteMap = support?.tipoClienteMap || new Map();

  return safeRows.map((r) => {
    const inc = incidenciaMap.get(Number(r.orden_id)) || null;
    const meta = metaMap.get(Number(r.orden_id)) || null;
    const prod = produccionEstadoMap.get(Number(r.orden_id)) || null;
    const tipoCliente = normalizeTipoCliente(r?.cliente_tipo || tipoClienteMap.get(Number(r.orden_id)) || "");
    return {
      ...r,
      cliente_tipo: tipoCliente || "",
      is_external: resolveExternalCompat({
        es_externo: r?.es_externo ?? meta?.es_externo,
        observaciones_generales: meta?.observaciones_generales
      }),
      incidencia_motivo: inc?.motivo_incidencia || null,
      incidencia_obs: inc?.obs_incidencia || null,
      incidencia_estado: inc?.estado_registro || null,
      produccion_estado: prod?.estado_registro || null
    };
  });
}

function isTipoImpresionTR(v) {
  const s = String(v || "").trim().toUpperCase();
  return s === "T+R" || s === "TIRA+RETIRA";
}

function juegosPlacaLabel(row) {
  const total = Number(row?.juegos_placa_total || 0);
  if (!row?.requiere_juegos_placa || !isTipoImpresionTR(row?.tipo_impresion) || total <= 0) return "";
  return `Juegos: ${total}`;
}

function juegosPlacaNombres(row, extra = null) {
  const det = Array.isArray(extra?.detalles_orden) ? extra.detalles_orden[0] : extra?.detalles_orden;
  const requiere = det?.requiere_juegos_placa ?? row?.requiere_juegos_placa;
  const tipoImpresion = det?.tipo_impresion ?? row?.tipo_impresion;
  if (!requiere || !isTipoImpresionTR(tipoImpresion)) return "";

  const total = Number(det?.juegos_placa_total ?? row?.juegos_placa_total ?? 0);
  const raw = det?.juegos_placa_detalle ?? null;
  const rows = parseJuegosPlacaDetalle(raw, total > 0 ? total : 2);
  const names = (rows || [])
    .map((x) => String(x?.nombre || "").trim())
    .filter(Boolean);
  return names.join(" | ");
}







function sanitizePlacasTotal(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 2;
  return Math.max(2, Math.floor(n));
}

function buildDefaultPlacasDetalle(total) {
  const safeTotal = sanitizePlacasTotal(total);
  const out = [];
  for (let i = 1; i <= safeTotal; i += 1) {
    const grupo = Math.ceil(i / 2);
    const isTira = i % 2 === 1;
    const suf = isTira ? "A" : "B";
    const cara = isTira ? "TIRA" : "RETIRA";
    out.push({
      orden: i,
      cara,
      nombre: `${cara} ${grupo}${suf}`
    });
  }
  return out;
}

function parseJuegosPlacaDetalle(raw, fallbackTotal = 2) {
  let data = raw;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      data = null;
    }
  }
  if (!Array.isArray(data) || !data.length) return buildDefaultPlacasDetalle(fallbackTotal);
  return data.map((item, idx) => {
    const pos = idx + 1;
    const isTira = pos % 2 === 1;
    const grupo = Math.ceil(pos / 2);
    const defaultName = `${isTira ? "TIRA" : "RETIRA"} ${grupo}${isTira ? "A" : "B"}`;
    const nombre = String(item?.nombre || item?.name || "").trim() || defaultName;
    return {
      orden: Number(item?.orden || item?.index || pos) || pos,
      cara: String(item?.cara || item?.side || (isTira ? "TIRA" : "RETIRA")).toUpperCase(),
      nombre
    };
  });
}

function renderJuegosPlacaDetalle(rows) {
  const wrap = $("d_placas_list");
  if (!wrap) return;
  wrap.innerHTML = (rows || []).map((r, idx) => `
    <div class="placas-item">
      <span class="small muted">Juego ${idx + 1} - ${esc(r.cara || "-")}</span>
      <input class="placa-name-input" data-placa-index="${idx}" value="${esc(r.nombre || "")}" placeholder="Ej: TIRA ${Math.ceil((idx + 1) / 2)}A" />
    </div>
  `).join("");
}

function collectJuegosPlacaDetalle() {
  const names = Array.from(document.querySelectorAll("#d_placas_list .placa-name-input"));
  return names.map((inp, idx) => {
    const pos = idx + 1;
    const isTira = pos % 2 === 1;
    const grupo = Math.ceil(pos / 2);
    const fallbackName = `${isTira ? "TIRA" : "RETIRA"} ${grupo}${isTira ? "A" : "B"}`;
    const nombre = String(inp?.value || "").trim() || fallbackName;
    return {
      orden: pos,
      cara: isTira ? "TIRA" : "RETIRA",
      nombre
    };
  });
}

function isRouteModuleCutting(item) {
  return String(item?.module || "").toUpperCase() === "CORTADOR";
}

function getProcessVariantMeta(key) {
  return PROCESS_VARIANT_META[String(key || "").trim()] || null;
}

function normalizeProcessVariant(key, value) {
  const meta = getProcessVariantMeta(key);
  if (!meta) return null;
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return null;
  const allowed = meta.options.map((opt) => String(opt?.value || "").trim().toUpperCase()).filter(Boolean);
  return allowed.includes(raw) ? raw : null;
}

function getProcessVariantValue(key, { fallbackDefault = true } = {}) {
  const meta = getProcessVariantMeta(key);
  if (!meta) return null;
  const normalized = normalizeProcessVariant(key, $(meta.controlId)?.value);
  if (normalized) return normalized;
  return fallbackDefault ? meta.defaultValue : null;
}

function getProcessDisplayLabel(meta, variant = null) {
  const variantMeta = getProcessVariantMeta(meta?.key);
  if (!variantMeta) return meta?.label || "-";
  const safeVariant = normalizeProcessVariant(meta.key, variant) || variantMeta.defaultValue;
  return variantMeta.renderDisplay(safeVariant);
}

function parseStoredRoute(raw) {
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

function buildRoutePayload() {
  return routeProcessDraft.map((item, index) => ({
    key: item.key,
    order: index + 1,
    variant: item.variant || null,
    module: item.module || null
  }));
}

function buildRouteDraftItem(meta, extra = {}) {
  const variantMeta = getProcessVariantMeta(meta.key);
  const variant = variantMeta
    ? (normalizeProcessVariant(meta.key, extra.variant) || variantMeta.defaultValue)
    : null;
  return {
    ...meta,
    key: meta.key,
    inputId: meta.inputId,
    module: meta.module,
    variant,
    displayLabel: getProcessDisplayLabel(meta, variant),
    order: Number(extra.order || 0) || null
  };
}

function getSelectedProcessItemsFromForm() {
  const rows = [];
  Object.values(PROCESS_ROUTE_META).forEach((meta) => {
    const variantMeta = getProcessVariantMeta(meta.key);
    if (variantMeta) {
      const variant = getProcessVariantValue(meta.key, { fallbackDefault: true });
      const selected = meta.inputId
        ? !!$(meta.inputId)?.checked
        : !!normalizeProcessVariant(meta.key, $(variantMeta.controlId)?.value);
      if (!selected) return;
      rows.push(buildRouteDraftItem(meta, { variant }));
      return;
    }
    if ($(meta.inputId)?.checked) {
      rows.push(buildRouteDraftItem(meta));
    }
  });
  return rows;
}

function normalizeRouteDraft(current = routeProcessDraft, selected = getSelectedProcessItemsFromForm()) {
  const currentMap = new Map((current || []).map((item) => [item.key, item]));
  return selected.map((item) => {
    const prev = currentMap.get(item.key);
    return {
      ...item,
      variant: item.variant || null,
      displayLabel: item.displayLabel,
      module: item.module,
      key: item.key,
      inputId: item.inputId,
      order: prev?.order || null
    };
  }).sort((a, b) => {
    const aOrder = Number(a.order || 0);
    const bOrder = Number(b.order || 0);
    if (aOrder && bOrder) return aOrder - bOrder;
    if (aOrder) return -1;
    if (bOrder) return 1;
    return 0;
  }).map((item, index) => ({ ...item, order: index + 1 }));
}

function syncRouteDraftFromForm() {
  routeProcessDraft = normalizeRouteDraft(routeProcessDraft, getSelectedProcessItemsFromForm());
  applyRouteDraftToFormControls();
  renderRouteSummary();
  renderRouteProcessPicker();
  renderRouteModalList();
}

function buildDefaultRouteDraft() {
  routeProcessDraft = normalizeRouteDraft([], getSelectedProcessItemsFromForm());
  applyRouteDraftToFormControls();
  renderRouteSummary();
  renderRouteProcessPicker();
  renderRouteModalList();
}

function buildRouteDraftFromStoredRoute(rawRoute) {
  const selected = getSelectedProcessItemsFromForm();
  const selectedMap = new Map(selected.map((item) => [item.key, item]));
  const ordered = [];

  parseStoredRoute(rawRoute)
    .sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0))
    .forEach((entry) => {
      const key = String(entry?.key || "").trim();
      const meta = PROCESS_ROUTE_META[key];
      const base = selectedMap.get(key);
      if (!meta || !base) return;
      ordered.push(
        buildRouteDraftItem(meta, {
          variant: entry?.variant || base.variant || null,
          order: entry?.order
        })
      );
      selectedMap.delete(key);
    });

  for (const item of selected) {
    if (!selectedMap.has(item.key)) continue;
    ordered.push(item);
  }

  routeProcessDraft = normalizeRouteDraft(ordered, selected);
  applyRouteDraftToFormControls();
  renderRouteSummary();
  renderRouteProcessPicker();
  renderRouteModalList();
}

function applyRouteDraftToFormControls() {
  const selectedMap = new Map(routeProcessDraft.map((item) => [item.key, item]));
  Object.values(PROCESS_ROUTE_META).forEach((meta) => {
    const selectedItem = selectedMap.get(meta.key) || null;
    if (meta.inputId && $(meta.inputId)) $(meta.inputId).checked = !!selectedItem;
    const variantMeta = getProcessVariantMeta(meta.key);
    if (variantMeta && $(variantMeta.controlId)) {
      $(variantMeta.controlId).value = selectedItem
        ? (selectedItem.variant || variantMeta.defaultValue)
        : "";
    }
  });
}

function renderRouteProcessPicker() {
  const wrap = $("routeProcessPicker");
  const count = $("routeSelectionCount");
  if (!wrap) return;
  if (count) {
    const total = routeProcessDraft.length;
    count.textContent = `${total} proceso${total === 1 ? "" : "s"}`;
  }

  const selected = new Map(routeProcessDraft.map((item) => [item.key, item]));
  wrap.innerHTML = Object.values(PROCESS_ROUTE_META).map((meta) => {
    const current = selected.get(meta.key) || null;
    const checked = !!current;
    const variantMeta = getProcessVariantMeta(meta.key);
    const variant = variantMeta
      ? (current?.variant || getProcessVariantValue(meta.key, { fallbackDefault: true }) || variantMeta.defaultValue)
      : null;
    return `
      <article class="route-pick-card ${checked ? "is-selected" : ""}">
        <div class="route-pick-head">
          <label class="route-pick-check">
            <input
              type="checkbox"
              data-route-pick="${esc(meta.key)}"
              ${checked ? "checked" : ""}
            />
            <span class="route-pick-title">${esc(meta.label)}</span>
          </label>
        </div>
        ${
          variantMeta && checked
            ? `
              <div class="route-mode-row">
                <label class="field-lb" for="${esc(variantMeta.routeControlId)}">${esc(variantMeta.label)}</label>
                <select
                  id="${esc(variantMeta.routeControlId)}"
                  data-route-variant="${esc(meta.key)}"
                >
                  ${variantMeta.options.map((opt) => `
                    <option value="${esc(opt.value)}" ${variant === opt.value ? "selected" : ""}>${esc(opt.label)}</option>
                  `).join("")}
                </select>
              </div>
            `
            : ""
        }
      </article>
    `;
  }).join("");
}

function renderRouteSummary() {
  const wrap = $("procesoRutaSummary");
  const trigger = $("routePickerTrigger");
  if (!wrap) return;

  if (!routeProcessDraft.length) {
    wrap.className = "route-summary is-empty";
    wrap.textContent = "Haz click en el cuadro para definir procesos y secuencia.";
    if (trigger) trigger.value = "";
    return;
  }

  if (trigger) {
    trigger.value = `${routeProcessDraft.length} proceso${routeProcessDraft.length === 1 ? "" : "s"} configurado${routeProcessDraft.length === 1 ? "" : "s"}`;
  }
  wrap.className = "route-summary";
  wrap.innerHTML = `
    <div class="route-summary-meta">Secuencia definida</div>
    <div class="route-summary-path">
      ${routeProcessDraft.map((item, index) => `
        <span class="route-summary-fragment">
          <span class="route-summary-order">${index + 1}</span>
          <span class="route-summary-label">${esc(item.displayLabel)}</span>
          ${index < routeProcessDraft.length - 1 ? '<span class="route-summary-sep">&rarr;</span>' : ""}
        </span>
      `).join("")}
    </div>
  `;
}

function renderRouteModalList() {
  const list = $("routeList");
  const hint = $("routeHint");
  const sidePanel = $("routeSidePanel");
  if (!list) return;

  if (!routeProcessDraft.length) {
    if (sidePanel) sidePanel.classList.add("is-blocked");
    list.innerHTML = '<div class="route-empty">Selecciona 2 o mas procesos para habilitar la secuencia.</div>';
    if (hint) hint.textContent = "La secuencia se activa cuando eliges mas de un proceso.";
    return;
  }

  if (routeProcessDraft.length === 1) {
    if (sidePanel) sidePanel.classList.add("is-blocked");
    list.innerHTML = `
      <div class="route-empty">
        Con un solo proceso no hace falta ordenar la secuencia.
      </div>
    `;
    if (hint) hint.textContent = "La secuencia se define automaticamente con un solo proceso.";
    return;
  }

  if (sidePanel) sidePanel.classList.remove("is-blocked");
  if (hint) {
    hint.textContent = "";
  }

  list.innerHTML = routeProcessDraft.map((item, index) => `
    <div class="route-item">
      <span class="route-index">${index + 1}</span>
      <div>
        <div class="route-item-title">
          <span>${esc(item.displayLabel)}</span>
        </div>
      </div>
      <div class="route-actions">
        <button
          class="route-arrow-btn"
          type="button"
          data-route-move="up"
          data-route-index="${index}"
          ${index === 0 ? "disabled" : ""}
          aria-label="Mover arriba"
          title="Mover arriba"
        >&#8593;</button>
        <button
          class="route-arrow-btn"
          type="button"
          data-route-move="down"
          data-route-index="${index}"
          ${index === routeProcessDraft.length - 1 ? "disabled" : ""}
          aria-label="Mover abajo"
          title="Mover abajo"
        >&#8595;</button>
      </div>
    </div>
  `).join("");
}

function openRouteModal() {
  syncRouteDraftFromForm();
  $("routeWrap")?.classList.remove("hide");
  $("routeWrap")?.setAttribute("aria-hidden", "false");
}

function closeRouteModal() {
  $("routeWrap")?.classList.add("hide");
  $("routeWrap")?.setAttribute("aria-hidden", "true");
}

function moveRouteItem(index, direction) {
  const pos = Number(index);
  if (!Number.isInteger(pos) || pos < 0 || pos >= routeProcessDraft.length) return;
  const target = direction === "up" ? pos - 1 : pos + 1;
  if (target < 0 || target >= routeProcessDraft.length) return;
  const next = [...routeProcessDraft];
  [next[pos], next[target]] = [next[target], next[pos]];
  routeProcessDraft = next.map((item, idx) => ({ ...item, order: idx + 1 }));
  applyRouteDraftToFormControls();
  renderRouteSummary();
  renderRouteProcessPicker();
  renderRouteModalList();
}

function toggleRouteProcess(key) {
  const meta = PROCESS_ROUTE_META[String(key || "").trim()];
  if (!meta) return;

  const exists = routeProcessDraft.find((item) => item.key === meta.key);
  if (exists) {
    routeProcessDraft = routeProcessDraft
      .filter((item) => item.key !== meta.key)
      .map((item, idx) => ({ ...item, order: idx + 1 }));
  } else {
    const variantMeta = getProcessVariantMeta(meta.key);
    const variant = variantMeta
      ? (getProcessVariantValue(meta.key, { fallbackDefault: true }) || variantMeta.defaultValue)
      : null;
    routeProcessDraft = [
      ...routeProcessDraft,
      buildRouteDraftItem(meta, { variant, order: routeProcessDraft.length + 1 })
    ];
  }

  applyRouteDraftToFormControls();
  renderRouteSummary();
  renderRouteProcessPicker();
  renderRouteModalList();
  refreshFormState();
}

function setRouteProcessVariant(key, value) {
  const variantMeta = getProcessVariantMeta(key);
  if (!variantMeta) return;
  const safeVariant = normalizeProcessVariant(key, value) || variantMeta.defaultValue;
  routeProcessDraft = routeProcessDraft.map((item) => (
    item.key === key
      ? buildRouteDraftItem(PROCESS_ROUTE_META[key], { variant: safeVariant, order: item.order })
      : item
  ));
  applyRouteDraftToFormControls();
  renderRouteSummary();
  renderRouteProcessPicker();
  renderRouteModalList();
  refreshFormState();
}

function syncJuegosPlacaUI({ forceRegenerate = false } = {}) {
  const section = $("d_multi_placas_section");
  const isExternal = $("o_externo")?.checked ?? false;
  const tipoImpDb = toDbTipoImpresion($("d_tipoimp")?.value);
  const canUse = !isExternal && tipoImpDb === "TIRA+RETIRA";
  if (canUse && forceRegenerate && $("d_multi_placas") && !$("d_multi_placas").checked) {
    $("d_multi_placas").checked = true;
  }
  const isOn = $("d_multi_placas")?.checked ?? false;
  const wrap = $("d_multi_placas_wrap");
  const hint = $("d_multi_placas_hint");
  const totalInput = $("d_placas_total");
  if (section) section.classList.toggle("hide", !canUse);
  if (!canUse) {
    if ($("d_multi_placas")) $("d_multi_placas").checked = false;
    if (wrap) wrap.classList.add("hide");
    const list = $("d_placas_list");
    if (list) list.innerHTML = "";
    refreshFormState();
    return;
  }
  if (wrap) wrap.classList.toggle("hide", !isOn);
  if (hint) {
    hint.textContent = isOn
      ? "Define y nombra cada placa para que el operador tenga la secuencia correcta."
      : "Activalo cuando la orden se divide en varias placas (revista, libro u otros).";
  }
  if (!isOn) {
    const list = $("d_placas_list");
    if (list) list.innerHTML = "";
    refreshFormState();
    return;
  }
  if (totalInput) totalInput.value = String(sanitizePlacasTotal(totalInput.value));
  const currentCount = document.querySelectorAll("#d_placas_list .placa-name-input").length;
  const expectedCount = sanitizePlacasTotal(totalInput?.value || 2);
  if (forceRegenerate || currentCount !== expectedCount) {
    renderJuegosPlacaDetalle(buildDefaultPlacasDetalle(expectedCount));
  }
  refreshFormState();
}

function wireJuegosPlaca() {
  $("d_multi_placas")?.addEventListener("change", () => syncJuegosPlacaUI({ forceRegenerate: true }));
  $("d_tipoimp")?.addEventListener("change", () => syncJuegosPlacaUI({ forceRegenerate: true }));
  $("d_placas_total")?.addEventListener("input", refreshFormState);
  $("d_placas_total")?.addEventListener("change", () => syncJuegosPlacaUI({ forceRegenerate: true }));
  $("btnPlacasGenerar")?.addEventListener("click", () => syncJuegosPlacaUI({ forceRegenerate: true }));
  $("d_placas_list")?.addEventListener("input", refreshFormState);
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
  if (isCustomFormatoSelected()) {
    if (!String($("d_ancho")?.value ?? "").trim()) miss.push("d_ancho");
    if (!String($("d_alto")?.value ?? "").trim()) miss.push("d_alto");
    if ((Number($("d_ancho")?.value || 0)) <= 0) miss.push("d_ancho");
    if ((Number($("d_alto")?.value || 0)) <= 0) miss.push("d_alto");
  }
  if ($("d_multi_placas")?.checked) {
    const total = sanitizePlacasTotal($("d_placas_total")?.value || 2);
    if (total < 2) miss.push("d_placas_total");
    const detalle = collectJuegosPlacaDetalle();
    if (detalle.length !== total) miss.push("d_placas_total");
    if (detalle.some((x) => !String(x.nombre || "").trim())) miss.push("d_placas_list");
  }
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



function toInputDatetimeLocal(value) {
  if (!value) return "";
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${da}T${hh}:${mm}`;
}

function clearOrdenForm() {
  if ($("o_desc")) $("o_desc").value = "";
  if ($("o_cliente")) $("o_cliente").value = "";
  if ($("o_entrega")) $("o_entrega").value = "";
  if ($("o_prio")) $("o_prio").value = "NORMAL";
  if ($("o_estado")) $("o_estado").value = "DISENO";
  if ($("o_obs")) $("o_obs").value = "";
  if ($("o_tiene_oc")) $("o_tiene_oc").checked = false;
  if ($("o_oc_numero")) $("o_oc_numero").value = "";
  if ($("o_oc_obs")) $("o_oc_obs").value = "";
  if ($("o_externo")) $("o_externo").checked = false;

  if ($("d_material")) $("d_material").value = "";
  if ($("d_formato")) $("d_formato").value = "";
  if ($("d_ancho")) $("d_ancho").value = "";
  if ($("d_alto")) $("d_alto").value = "";
  if ($("d_cant")) $("d_cant").value = "";
  if ($("d_dem")) $("d_dem").value = "";
  if ($("d_maq")) $("d_maq").value = "";
  if ($("d_tipoimp")) $("d_tipoimp").value = "";
  if ($("d_color_mode")) $("d_color_mode").value = "FC";
  if ($("d_color_text")) $("d_color_text").value = "F/C";
  if ($("d_obs_tecnica")) $("d_obs_tecnica").value = "";
  if ($("p_plast")) $("p_plast").value = "";
  if ($("p_perforado_tipo")) $("p_perforado_tipo").value = "";
  if ($("d_multi_placas")) $("d_multi_placas").checked = false;
  if ($("d_placas_total")) $("d_placas_total").value = "2";
  if ($("d_placas_list")) $("d_placas_list").innerHTML = "";

  [
    "p_corte",
    "p_empaq",
    "p_doblez",
    "p_compa",
    "p_troq",
    "p_sect",
    "p_barniz",
    "p_encolado",
    "p_marcado",
    "p_anillado",
    "p_perforado",
    "p_pegado_solapa",
    "p_semi_corte",
    "p_enumerado"
  ].forEach((id) => {
    if ($(id)) $(id).checked = false;
  });

  routeProcessDraft = [];
  renderRouteSummary();
  renderRouteModalList();

  syncResponsableDisenoField();
  syncClienteSelectedText();
  syncMaterialSelectedText();
  syncOcFields();
  syncExternalFlowUI();
  syncFormatoFields();
  syncJuegosPlacaUI();
  $("d_color_mode")?.dispatchEvent(new Event("change"));
}

function setOrdenModalMode(mode, row = null) {
  ordenModalMode = mode;
  ordenEditId = mode === "edit" ? Number(row?.orden_id || 0) : null;
  setText("ordTitle", mode === "edit" ? `Editar Orden ${row?.numero_orden_fisica || ""}` : "Nueva Orden");
  const btn = $("btnGuardarOrden");
  if (btn) btn.textContent = mode === "edit" ? "Guardar Cambios" : "Guardar Orden";
}

async function openOrdenModalForEdit(row) {
  if (!row?.orden_id) return;
  if (!isEditableEstado(row.estado)) {
    msgJobs("Solo puedes editar ordenes en DISENO o PLACAS.");
    return;
  }
  const full = await fetchOrdenById(row.orden_id);
  const det = Array.isArray(full?.detalles_orden) ? full.detalles_orden[0] : (full?.detalles_orden || {});
  const isExt = resolveExternalCompat(full);

  clearOrdenForm();
  setOrdenModalMode("edit", row);
  $("modalOrdenWrap")?.classList.remove("hide");

  if ($("o_desc")) $("o_desc").value = full?.descripcion_trabajo || row.descripcion_trabajo || "";
  if ($("o_cliente")) $("o_cliente").value = String(full?.cliente_id || "");
  if ($("o_entrega")) $("o_entrega").value = toInputDatetimeLocal(full?.fecha_entrega || row.fecha_entrega);
  if ($("o_prio")) $("o_prio").value = full?.prioridad || row.prioridad || "NORMAL";
  if ($("o_estado")) $("o_estado").value = (estadoKey(full?.estado) === "PLACAS") ? "PLACAS" : "DISENO";
  if ($("o_obs")) $("o_obs").value = stripLegacyExternalTag(full?.observaciones_generales);
  if ($("o_tiene_oc")) $("o_tiene_oc").checked = !!full?.tiene_oc;
  if ($("o_oc_numero")) $("o_oc_numero").value = full?.oc_numero || "";
  if ($("o_oc_obs")) $("o_oc_obs").value = full?.oc_observacion || "";
  if ($("o_externo")) $("o_externo").checked = !!isExt;

  if ($("d_material")) $("d_material").value = det?.material_id ? String(det.material_id) : "";
  if ($("d_formato")) {
    if (det?.formato_id) $("d_formato").value = String(det.formato_id);
    else if (det?.medida_ancho && det?.medida_alto) $("d_formato").value = "__CUSTOM__";
    else $("d_formato").value = "";
  }
  if ($("d_ancho")) $("d_ancho").value = det?.medida_ancho ?? "";
  if ($("d_alto")) $("d_alto").value = det?.medida_alto ?? "";
  if ($("d_cant")) $("d_cant").value = det?.cantidad_solicitada ?? "";
  if ($("d_dem")) $("d_dem").value = det?.demasia ?? "";
  if ($("d_maq")) $("d_maq").value = det?.maquina_sugerida_id ? String(det.maquina_sugerida_id) : "";
  if ($("d_tipoimp")) $("d_tipoimp").value = det?.tipo_impresion || "";
  if ($("d_color_mode")) $("d_color_mode").value = det?.color_mode || "FC";
  if ($("d_color_text")) $("d_color_text").value = det?.color_text || "F/C";
  if ($("d_obs_tecnica")) $("d_obs_tecnica").value = det?.observacion_tecnica || "";
  if ($("p_plast")) $("p_plast").value = det?.plastificado || "";
  if ($("p_perforado_tipo")) $("p_perforado_tipo").value = det?.perforado_tipo || "";
  if ($("d_multi_placas")) $("d_multi_placas").checked = !!det?.requiere_juegos_placa;
  if ($("d_placas_total")) {
    const totalSaved = sanitizePlacasTotal(det?.juegos_placa_total || 2);
    $("d_placas_total").value = String(totalSaved);
    if (det?.requiere_juegos_placa) {
      renderJuegosPlacaDetalle(parseJuegosPlacaDetalle(det?.juegos_placa_detalle, totalSaved));
    }
  }

  if ($("p_corte")) $("p_corte").checked = !!det?.corte;
  if ($("p_empaq")) $("p_empaq").checked = !!det?.empaquetado;
  if ($("p_doblez")) $("p_doblez").checked = !!det?.doblez;
  if ($("p_compa")) $("p_compa").checked = !!det?.compaginado;
  if ($("p_troq")) $("p_troq").checked = !!det?.troquelado;
  if ($("p_sect")) $("p_sect").checked = !!det?.sectorizado;
  if ($("p_barniz")) $("p_barniz").checked = !!det?.barniz;
  if ($("p_encolado")) $("p_encolado").checked = !!det?.encolado;
  if ($("p_marcado")) $("p_marcado").checked = !!det?.marcado;
  if ($("p_anillado")) $("p_anillado").checked = !!det?.anillado;
  if ($("p_perforado")) $("p_perforado").checked = !!det?.perforado;
  if ($("p_pegado_solapa")) $("p_pegado_solapa").checked = !!det?.pegado_solapa;
  if ($("p_semi_corte")) $("p_semi_corte").checked = !!det?.semi_corte;
  if ($("p_enumerado")) $("p_enumerado").checked = !!det?.enumerado;
  if (Array.isArray(det?.ruta_procesos) || typeof det?.ruta_procesos === "string") {
    buildRouteDraftFromStoredRoute(det?.ruta_procesos);
  } else {
    buildDefaultRouteDraft();
  }

  syncClienteSelectedText();
  syncMaterialSelectedText();
  syncOcFields();
  syncExternalFlowUI();
  syncFormatoFields();
  syncJuegosPlacaUI();
  $("d_color_mode")?.dispatchEvent(new Event("change"));
  refreshFormState();
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
      `<option value="__CUSTOM__">Medida personalizada</option>` +
      (fors || []).map((f) => `<option value="${f.id}" data-ancho="${f.ancho ?? ""}" data-alto="${f.alto ?? ""}">${esc(f.nombre)} (${esc(f.ancho)} x ${esc(f.alto)})</option>`).join("");
  }
}

function isCustomFormatoSelected() {
  return String($("d_formato")?.value || "") === "__CUSTOM__";
}

function syncFormatoFields() {
  const isCustom = isCustomFormatoSelected();
  const wrap = $("d_medida_wrap");
  const hint = $("d_formato_hint");
  const inpAncho = $("d_ancho");
  const inpAlto = $("d_alto");
  const opt = $("d_formato")?.selectedOptions?.[0] || null;

  if (wrap) wrap.classList.toggle("hide", !isCustom);
  if (hint) {
    hint.textContent = isCustom
      ? "Ingresa las medidas manuales para este trabajo."
      : (opt?.dataset?.ancho && opt?.dataset?.alto
        ? `Formato seleccionado: ${opt.dataset.ancho} x ${opt.dataset.alto}`
        : "Usa el catalogo o elige medida personalizada.");
  }

  if (inpAncho) {
    inpAncho.disabled = !isCustom;
    if (!isCustom) inpAncho.value = "";
  }
  if (inpAlto) {
    inpAlto.disabled = !isCustom;
    if (!isCustom) inpAlto.value = "";
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
    syncFormatoFields();
    refreshFormState();
  });
  selColorMode?.addEventListener("change", () => {
    const mode = toDbColorMode(selColorMode.value);
    if (!inpColorText) return;
    if (mode === "FC") {
      inpColorText.value = "F/C";
      inpColorText.readOnly = true;
    } else if (mode === "ONE_COLOR") {
      inpColorText.value = "1 COLOR";
      inpColorText.readOnly = true;
    } else if (mode === "TWO_COLORS") {
      inpColorText.value = "2 COLORES";
      inpColorText.readOnly = true;
    } else {
      inpColorText.readOnly = false;
      if (!String(inpColorText.value || "").trim() || inpColorText.value === "F/C" || inpColorText.value === "1 COLOR" || inpColorText.value === "2 COLORES") {
        inpColorText.value = "";
      }
      inpColorText.focus();
    }
    refreshFormState();
  });
  syncFormatoFields();
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
  syncJuegosPlacaUI();
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

async function openPendingEntregaModal(ordenId) {
  const oid = Number(ordenId);
  if (!oid) return;
  const row = (jobsBoardRowsCache || []).find((item) => Number(item?.orden_id) === oid);
  if (!row) {
    msgRegs("No se encontro la orden pendiente para abrir la entrega.");
    return;
  }
  await openEntregaModal(row);
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
  const prodEstado = String(r.produccion_estado || "").trim().toUpperCase();
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
    if (prodEstado === "PAUSADO") {
      return `<span class="state-pill is-paused">Pausado</span>`;
    }
    return `<span class="state-pill is-printing">Imprimiendo</span>`;
  }
  if (e === "ACABADOS") {
    const routeNeedsHandoff = !!r.route_requires_handoff;
    const nextRouteModule = String(r.route_next_process_modulo || "").trim().toUpperCase();
    if (r.route_all_closed || String(r.route_badge_tone || "").trim().toLowerCase() === "done") {
      return `<button class="btn btn-deliver" type="button" data-action="deliver" data-oid="${r.orden_id}" style="padding:8px 10px">ENTREGAR</button>`;
    }
    if (routeNeedsHandoff && (nextRouteModule === "ACABADOS" || nextRouteModule === "CORTADOR")) {
      const label = nextRouteModule === "CORTADOR" ? "Enviar a CORTE" : "Enviar a ACABADOS";
      return `<button class="btn btn-warn" type="button" data-action="route-transfer" data-oid="${r.orden_id}" data-module="${nextRouteModule}" style="padding:8px 10px">${label}</button>`;
    }
    return renderRouteStatusPill(r);
  }
  if (e === estadoKey(ESTADO_FINAL)) {
    return `<button class="btn btn-deliver" type="button" data-action="deliver" data-oid="${r.orden_id}" style="padding:8px 10px">ENTREGAR</button>`;
  }
  if (e === estadoKey(ESTADO_ENTREGADO)) {
    return `<span class="small muted">Entregado</span>`;
  }
  return `<span class="small muted">-</span>`;
}

function parseEntregaDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/i.test(s);
  if (hasOffset) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const [, y, mo, d, hh, mm, ss = "00"] = m;
    const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isOrdenOverdue(fechaEntrega, estado) {
  const e = estadoKey(estado);
  if (e === estadoKey(ESTADO_ENTREGADO)) return false;
  const entregaDate = parseEntregaDate(fechaEntrega);
  if (!entregaDate) return false;
  return entregaDate.getTime() < Date.now();
}

function isDetalleOrdenOpen() {
  const wrap = $("jobDetailWrap");
  return !!wrap && !wrap.classList.contains("hide");
}

async function refreshDetalleOrdenIfOpen(latestRows = []) {
  if (!isDetalleOrdenOpen()) return;
  const oid = Number(detailRowCtx?.orden_id || 0);
  if (!oid) return;

  const latestRow = (latestRows || []).find((row) => Number(row?.orden_id) === oid) || detailRowCtx;
  const latestExtra = await fetchOrdenById(oid).catch(() => detailExtraCtx || null);

  if (!isDetalleOrdenOpen() || Number(detailRowCtx?.orden_id || 0) !== oid) return;

  openDetalleOrden(
    { ...(detailRowCtx || {}), ...(latestRow || {}) },
    latestExtra || detailExtraCtx || null
  );
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
  const incMotivo = r?.incidencia_motivo || "-";
  const incObs = r?.incidencia_obs || "-";
  const overdue = isOrdenOverdue(entregaRaw, r.estado);
  const prodEstado = String(r.produccion_estado || "").trim().toUpperCase();
  const routeTone = String(r.route_badge_tone || "").trim().toLowerCase();
  const incidenciaBadge = renderIncidenciaBadge({
    motivo_incidencia: r?.incidencia_motivo,
    obs_incidencia: r?.incidencia_obs,
    estado_registro: r?.incidencia_estado
  });
  const pausedBadge = prodEstado === "PAUSADO"
    ? `<span class="state-pill is-paused">Pausado en operador</span>`
    : routeTone === "paused"
      ? `<span class="state-pill is-paused">Pausado en ruta</span>`
      : "";
  const detailAlerts = [renderOverdueBadge(overdue), incidenciaBadge, pausedBadge].filter(Boolean).join("");
  const procesoActualDetalle = estadoKey(r.estado) === "ACABADOS"
    ? [r.route_stage_primary, r.route_stage_secondary].filter(Boolean).join(" | ")
    : estadoKey(r.estado) === "IMPRESION"
      ? `Impresion | ${String(r.produccion_estado || "").trim().toUpperCase() === "PAUSADO" ? "Pausado en operador" : "Trabajando en operador"}`
      : r.estado || "-";
  const moduloRutaActual = r.route_current_module || "-";
  const estadoGeneral = r.estado || "-";
  const juegosLabel = juegosPlacaLabel(r);
  const juegosNombres = juegosPlacaNombres(r, extra);
  const documentoFiscal = `${cliDocTipo} ${cliDocNum}`.trim() || "-";
  const materialText = `${r.papel_material || "-"}${r.gramaje ? ` (${r.gramaje}g)` : ""}`;
  const formatLongText = (value) => {
    const raw = String(value || "").trim();
    if (!raw || raw === "-") return "-";
    return esc(raw).replace(/\n/g, "<br>");
  };
  const detailItem = (label, value, opts = {}) => `
    <div class="order-detail-item ${opts.full ? "order-detail-item--full" : ""} ${opts.html ? "has-html" : ""}">
      <span class="detail-k">${label}</span>
      <span class="detail-v">${value || "-"}</span>
    </div>
  `;
  const detailMetric = (label, value, opts = {}) => `
    <div class="order-detail-metric ${opts.primary ? "is-primary" : ""} ${opts.html ? "has-html" : ""}">
      <span class="detail-k">${label}</span>
      <span class="detail-v">${value || "-"}</span>
    </div>
  `;
  const chipGroup = (raw, variant = "neutral") => {
    const values = String(raw || "")
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean);

    if (!values.length || (values.length === 1 && values[0] === "-")) {
      return '<span class="order-detail-empty">Sin informacion registrada.</span>';
    }

    return `
      <div class="order-detail-chip-group">
        ${values.map((value) => `<span class="order-detail-chip is-${variant}">${esc(value)}</span>`).join("")}
      </div>
    `;
  };
  const noteCard = (label, value, tone = "neutral") => `
    <article class="order-detail-note is-${tone}">
      <span class="detail-k">${label}</span>
      <div class="order-detail-note-copy">${formatLongText(value)}</div>
    </article>
  `;

  $("jobDetailBody").innerHTML = `
    <div class="order-detail-shell">
      <section class="order-detail-hero">
        <div class="order-detail-identity">
          <div class="order-detail-topline">
            <span class="order-detail-order">Orden ${esc(r.numero_orden_fisica || ("#" + r.orden_id))}</span>
            <span class="order-detail-state-chip">${esc(estadoGeneral)}</span>
            <span class="order-detail-client-chip">${esc(cliTipo)}</span>
          </div>
          <h3 class="order-detail-job">${esc(r.descripcion_trabajo || "-")}</h3>
          <div class="order-detail-client">${esc(r.cliente_nombre || "-")}</div>
          ${detailAlerts ? `<div class="order-detail-alerts">${detailAlerts}</div>` : ""}
        </div>

        <div class="order-detail-hero-grid">
          ${detailMetric("Proceso actual", esc(procesoActualDetalle || "-"), { primary: true })}
          ${detailMetric("Entrega", esc(entrega))}
          ${detailMetric("Modulo actual", esc(moduloRutaActual))}
          ${detailMetric("Prioridad", renderPrioridadBadge(r.prioridad), { html: true })}
        </div>
      </section>

      <div class="order-detail-layout">
        <section class="order-detail-card">
          <div class="order-detail-card-head">
            <h4>Comercial</h4>
            <span>Cliente y documento</span>
          </div>
          <div class="order-detail-list">
            ${detailItem("Tipo cliente", esc(cliTipo))}
            ${detailItem("Documento fiscal", esc(documentoFiscal))}
            ${detailItem("Requiere OC", esc(tieneOc ? "SI" : "NO"))}
            ${detailItem("Nro OC", esc(ocNum))}
            ${detailItem("Obs OC", esc(ocObs), { full: true })}
            ${detailItem("Tiene guia", esc(tieneGuia ? "SI" : "NO"))}
            ${detailItem("Nro guia", esc(guiaNum))}
            ${detailItem("Obs guia", esc(guiaObs), { full: true })}
          </div>
        </section>

        <section class="order-detail-card">
          <div class="order-detail-card-head">
            <h4>Produccion</h4>
            <span>Ficha tecnica</span>
          </div>
          <div class="order-detail-list">
            ${detailItem("Maquina", esc(r.maquina_sugerida_nombre || "-"))}
            ${detailItem("Formato", esc(formato))}
            ${detailItem("Material", esc(materialText))}
            ${detailItem("Tipo impresion", esc(fmtTipoImpresion(r.tipo_impresion)))}
            ${detailItem("Juegos de placa", esc(juegosLabel || "-"))}
            ${detailItem("Cantidad solicitada", esc(cantidad))}
            ${detailItem("Demasia", esc(demasia))}
            ${detailItem("Color", esc(r.color_text || "-"))}
          </div>
        </section>

        <section class="order-detail-card order-detail-card--wide">
          <div class="order-detail-card-head">
            <h4>Ruta y Juegos</h4>
            <span>Configuracion del trabajo</span>
          </div>
          <div class="order-detail-stack">
            <div class="order-detail-panel">
              <span class="detail-k">Nombres de juegos</span>
              ${chipGroup(juegosNombres || "-", "game")}
            </div>
            <div class="order-detail-panel">
              <span class="detail-k">Procesos acabados</span>
              ${chipGroup(procesosAcabados || "-", "process")}
            </div>
          </div>
        </section>

        <section class="order-detail-card order-detail-card--wide">
          <div class="order-detail-card-head">
            <h4>Observaciones</h4>
            <span>Incidencias y notas</span>
          </div>
          <div class="order-detail-notes">
            ${noteCard("Motivo incidencia", incMotivo, "warn")}
            ${noteCard("Observacion incidencia", incObs, "warn")}
            ${noteCard("Observacion tecnica (impresor)", obsTecnica, "neutral")}
            ${noteCard("Observacion acabados", obsAcabados, "info")}
          </div>
        </section>
      </div>
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

async function inspectOrdenesFisicas(...rawNumbers) {
  const numbers = rawNumbers
    .flat()
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (!numbers.length) {
    console.warn("inspectOrdenesFisicas: indica al menos un numero de orden fisica.");
    return [];
  }

  const { data: ordenes, error: ordenesError } = await supabase
    .from("ordenes")
    .select("id,numero_orden_fisica,estado,fecha_entrega,prioridad,descripcion_trabajo")
    .in("numero_orden_fisica", numbers)
    .order("id", { ascending: false });

  if (ordenesError) throw ordenesError;

  const orderIds = (ordenes || []).map((row) => Number(row.id)).filter(Boolean);
  if (!orderIds.length) {
    console.warn("inspectOrdenesFisicas: no encontre esas ordenes.", numbers);
    return [];
  }

  const [
    { data: detalles, error: detallesError },
    { data: procesos, error: procesosError }
  ] = await Promise.all([
    supabase
      .from("detalles_orden")
      .select("*")
      .in("orden_id", orderIds),
    supabase
      .from("orden_procesos")
      .select("id,orden_id,proceso_codigo,modulo_responsable,estado,secuencia,configuracion,observaciones,assigned_user_id,started_at,finished_at,created_at,updated_at")
      .in("orden_id", orderIds)
      .order("orden_id", { ascending: true })
      .order("secuencia", { ascending: true })
      .order("id", { ascending: true })
  ]);

  if (detallesError) throw detallesError;
  if (procesosError) throw procesosError;

  const detalleMap = new Map((detalles || []).map((row) => [Number(row.orden_id), row]));
  const procesosMap = new Map();

  for (const proceso of procesos || []) {
    const oid = Number(proceso.orden_id);
    const bucket = procesosMap.get(oid) || [];
    bucket.push(proceso);
    procesosMap.set(oid, bucket);
  }

  const output = (ordenes || []).map((orden) => ({
    ...orden,
    detalle: detalleMap.get(Number(orden.id)) || null,
    procesos: procesosMap.get(Number(orden.id)) || []
  }));

  console.group("inspectOrdenesFisicas");
  console.table(output.map((row) => ({
    id: row.id,
    numero_orden_fisica: row.numero_orden_fisica,
    estado: row.estado,
    fecha_entrega: row.fecha_entrega,
    modulo_ruta_actual: row.detalle?.modulo_ruta_actual || null,
    ruta_procesos: row.detalle?.ruta_procesos || null,
    procesos_total: Array.isArray(row.procesos) ? row.procesos.length : 0
  })));
  output.forEach((row) => {
    console.log(`Orden ${row.numero_orden_fisica || row.id}`, row);
  });
  console.groupEnd();

  return output;
}

window.inspectOrdenesFisicas = inspectOrdenesFisicas;

function printOrden(r, extra = null) {
  const entregaRaw = extra?.fecha_entrega || r.fecha_entrega || null;
  const entrega = fmtEntrega(entregaRaw);
  const emitido = new Date().toLocaleString("es-PE", { timeZone: "America/Lima" });
  const formato = (r.medida_ancho && r.medida_alto) ? `${r.medida_ancho} x ${r.medida_alto}` : "-";
  const material = `${r.papel_material || "-"}${r.gramaje ? ` (${r.gramaje}g)` : ""}`;
  const cantidad = r.cantidad_solicitada ?? "-";
  const demasia = r.demasia ?? "-";
  const responsable = extra?.responsable_diseno || r.responsable_diseno || "-";
  const cantidadConDemasia = demasia === "-" ? String(cantidad) : `${cantidad} + ${demasia}`;
  const obsAcabados = extra?.observaciones_generales || "-";
  const obsTecnica = r.observacion_tecnica || "-";
  const procesosAcabados = getProcesosAcabadosText(r);
  const cliTipo = extra?.cliente?.tipo_cliente || "-";
  const cliDocTipo = extra?.cliente?.doc_fiscal_tipo || "-";
  const cliDocNum = extra?.cliente?.doc_fiscal_numero || "-";
  const ocNum = extra?.oc_numero || "-";
  const juegosLabel = juegosPlacaLabel(r);
  const juegosNombres = juegosPlacaNombres(r, extra);
  const cliTipoNorm = String(cliTipo || "").trim().toUpperCase();
  const showOcField = cliTipoNorm === "DIRECTO";
  const showTrFields = isTipoImpresionTR(r.tipo_impresion);
  const logoUrl = `${window.location.origin}/app/assets/logo.svg`;
  const html = `
<!doctype html><html lang="es"><head><meta charset="utf-8" /><title>Orden ${esc(r.numero_orden_fisica || ("#" + r.orden_id))}</title>
<style>
@page{size:A5 portrait;margin:6mm}
:root{--line:#d4d4d8;--muted:#52525b;--ink:#111827}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
html,body{margin:0;padding:0}
body{font-family:"Segoe UI",Arial,sans-serif;color:var(--ink);background:#fff}
.sheet{
  width:100%;
  min-height:calc(210mm - 12mm);
  margin:0;
  display:flex;
  flex-direction:column;
}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:6px;border-bottom:1.4px solid var(--ink);padding-bottom:5px;margin-bottom:6px}
.brand{display:flex;align-items:center;gap:7px}
.brand-logo{width:22px;height:22px;display:block}
.brand h1{font-size:12px;line-height:1.06;margin:0}
.brand small{display:block;color:var(--muted);margin-top:2px;font-size:8px}
.meta{text-align:right}
.meta .n{font-size:12px;font-weight:800}
.meta .s{font-size:8px;color:var(--muted);margin-top:2px}
.section{border:1px solid var(--line);border-radius:6px;padding:5px 6px;margin-bottom:5px;break-inside:avoid}
.section h3{font-size:8px;text-transform:uppercase;letter-spacing:.45px;color:var(--muted);margin:0 0 4px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 6px}
.k{display:block;color:var(--muted);font-size:9.5px}
.v{display:block;font-size:11px;font-weight:600;margin-top:1px;line-height:1.16;word-break:break-word}
.section-tecnica .k{font-size:10.5px}
.section-tecnica .v{font-size:12.5px;line-height:1.2}
.section-tecnica .grid{gap:5px 7px}
.wide{grid-column:1/-1}
.foot{margin-top:5px;font-size:7.5px;color:#71717a;text-align:right}
</style></head><body><div class="sheet">
<header class="head"><div class="brand"><img class="brand-logo" src="${esc(logoUrl)}" alt="Logo MultiBur" /><div><h1>MultiBur - Orden de Produccion</h1><small>Documento operativo para planta y control</small></div></div><div class="meta"><div class="n">Nro ${esc(r.numero_orden_fisica || ("#" + r.orden_id))}</div><div class="s">Emitido: ${esc(emitido)}</div></div></header>
<section class="section"><h3>Datos generales</h3><div class="grid">
<div><span class="k">Cliente</span><span class="v">${esc(r.cliente_nombre || "-")}</span></div>
<div><span class="k">Fecha entrega</span><span class="v">${esc(entrega)}</span></div>
<div><span class="k">Tipo cliente</span><span class="v">${esc(cliTipo)}</span></div>
<div><span class="k">Documento fiscal</span><span class="v">${esc(`${cliDocTipo} ${cliDocNum}`)}</span></div>
<div><span class="k">Estado</span><span class="v">${esc(r.estado || "-")}</span></div>
<div><span class="k">Prioridad</span><span class="v">${esc(r.prioridad || "NORMAL")}</span></div>
<div><span class="k">Responsable</span><span class="v">${esc(responsable)}</span></div>
${showOcField ? `<div><span class="k">Nro OC</span><span class="v">${esc(ocNum)}</span></div>` : ""}
<div class="wide"><span class="k">Trabajo</span><span class="v">${esc(r.descripcion_trabajo || "-")}</span></div>
</div></section>
<section class="section section-tecnica"><h3>Ficha tecnica</h3><div class="grid">
  <div><span class="k">Maquina sugerida</span><span class="v">${esc(r.maquina_sugerida_nombre || "-")}</span></div>
  <div><span class="k">Formato</span><span class="v">${esc(formato)}</span></div>
  <div><span class="k">Material</span><span class="v">${esc(material)}</span></div>
  <div><span class="k">Impresion / Color</span><span class="v">${esc(fmtTipoImpresion(r.tipo_impresion))} / ${esc(r.color_text || "-")}</span></div>
  ${showTrFields ? `<div><span class="k">Juegos de placa</span><span class="v">${esc(juegosLabel || "-")}</span></div>` : ""}
  ${showTrFields ? `<div class="wide"><span class="k">Nombres de juegos</span><span class="v">${esc(juegosNombres || "-")}</span></div>` : ""}
  <div class="wide"><span class="k">Cantidad + demasia</span><span class="v">${esc(cantidadConDemasia)}</span></div>
  <div class="wide"><span class="k">Procesos acabados</span><span class="v">${esc(procesosAcabados)}</span></div>
  <div class="wide"><span class="k">Observacion tecnica (impresor)</span><span class="v">${esc(obsTecnica)}</span></div>
  <div class="wide"><span class="k">Observacion acabados</span><span class="v">${esc(obsAcabados)}</span></div>
</div></section>
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
  const tipoClienteFiltro = String($("fTipoCliente")?.value || "").trim().toUpperCase();
  const q = ($("q")?.value || "").trim().toLowerCase();
  await loadSharedPinnedOrders({ syncLegacy: true });
  const [visibleRawRows, pendingRawRows] = await Promise.all([
    fetchTrabajosAdminBoardSnapshot({ estado }),
    fetchTrabajosAdminBoardSnapshot({ estado: "" })
  ]);
  const allOrderIds = [
    ...(visibleRawRows || []).map((r) => Number(r.orden_id)).filter(Boolean),
    ...(pendingRawRows || []).map((r) => Number(r.orden_id)).filter(Boolean)
  ];
  const support = await buildAdminBoardSupport(allOrderIds);
  let rows = hydrateAdminBoardRows(visibleRawRows, support);
  jobsBoardRowsCache = hydrateAdminBoardRows(pendingRawRows, support);
  const detailRefreshRows = [...rows, ...jobsBoardRowsCache].filter(Boolean);
  renderPendingEntregaCards(jobsBoardRowsCache);
  syncLivePanelMode();
  if (!estado) rows = rows.filter((r) => estadoKey(r.estado) !== estadoKey(ESTADO_ENTREGADO));
  if (tipoClienteFiltro) {
    rows = rows.filter((r) => normalizeTipoCliente(r.cliente_tipo) === tipoClienteFiltro);
  }
  if (q) rows = rows.filter((r) => [
    r.numero_orden_fisica,
    r.cliente_nombre,
    r.descripcion_trabajo,
    r.estado,
    r.route_stage_primary,
    r.route_stage_secondary,
    r.route_current_module,
    r.route_next_process_label,
    r.route_badge_label,
    r.tipo_impresion,
    r.color_text,
    r.maquina_sugerida_nombre
  ].join(" ").toLowerCase().includes(q));
  rows = sortJobsBoardRows(rows);
  const tb = $("tbJobs");
  refreshDetalleOrdenIfOpen(detailRefreshRows).catch((error) => {
    console.warn("No pude refrescar el detalle abierto de la orden.", error);
  });
  if (!tb) return;
  tb.innerHTML = (rows || []).map((r) => {
    const formato = (r.medida_ancho && r.medida_alto) ? `${r.medida_ancho} x ${r.medida_alto}` : "-";
    const entrega = fmtEntrega(r.fecha_entrega);
    const entregaLabel = splitEntregaLabel(entrega);
    const overdue = isOrdenOverdue(r.fecha_entrega, r.estado);
    const prioridadBadge = renderPrioridadBadge(r.prioridad);
    const isPinned = pendingPinnedOrderIds.has(Number(r?.orden_id));
    const pinnedBadge = isPinned ? renderPinnedBadge() : "";
    const pinnedRank = isPinned ? getPinnedOrderRank(r?.orden_id) : null;
    const incidenciaBadge = renderIncidenciaBadge({
      motivo_incidencia: r.incidencia_motivo,
      obs_incidencia: r.incidencia_obs,
      estado_registro: r.incidencia_estado
    });
    const juegosLabel = juegosPlacaLabel(r);
    return `<tr class="jobs-row ${isPinned ? "is-pinned-row" : ""}" style="border-left: 5px solid ${getClientColor(r.cliente_nombre)}; background-color: ${getClientBgColor(r.cliente_nombre)};">
      <td>
        <div class="order-headline">
          ${pinnedRank ? `<span class="pin-order-badge" title="Anclado #${pinnedRank}" aria-label="Anclado ${pinnedRank}">${pinnedRank}</span>` : ""}
          <b>${esc(r.numero_orden_fisica || ("#" + r.orden_id))}</b>
        </div>
        <div class="small muted order-meta">
          <div class="order-state-line">${esc(r.estado)}</div>
          <div class="order-priority-line">
            <div class="order-priority-main">${prioridadBadge}</div>
            ${incidenciaBadge ? `<div class="order-priority-inc">${incidenciaBadge}</div>` : ""}
          </div>
        </div>
      </td>
      <td>
        <div class="entrega-date">${esc(entregaLabel.date)}</div>
        ${entregaLabel.time ? `<div class="small muted entrega-time">${esc(entregaLabel.time)}</div>` : ""}
        <div class="small">${renderOverdueBadge(overdue)}</div>
      </td>
      <td><div class="text-elide" style="max-width: 110px" title="${esc(r.cliente_nombre || '-')}">${esc(r.cliente_nombre || "-")}</div></td>
      <td><div class="text-elide" style="max-width: 130px" title="${esc(r.descripcion_trabajo || '-')}">${esc(r.descripcion_trabajo || "-")}</div></td>
      <td><b>${esc(r.cantidad_solicitada || "-")}</b>${r.demasia ? `<div class="small muted">+${esc(r.demasia)} demasía</div>` : ""}</td>
      <td><b>${esc(formato)}</b><div class="small muted">${esc(r.papel_material || "")} ${esc(r.gramaje ? (r.gramaje + "g") : "")}</div></td>
      <td><b>${esc(fmtTipoImpresion(r.tipo_impresion))}</b>${juegosLabel ? `<div class="small muted">${esc(juegosLabel)}</div>` : ""}</td>
      <td>${esc(r.color_text || "-")}</td>
      <td>
        <div class="machine-cell">
          <div class="machine-name">${esc(r.maquina_sugerida_nombre || "-")}</div>
          ${pinnedBadge ? `<div class="machine-pin">${pinnedBadge}</div>` : ""}
        </div>
      </td>
      <td>
        <div class="row-actions">
          <div class="row-actions-main">${renderAccion(r)}</div>
          <div class="row-actions-secondary">
            ${isEditableEstado(r.estado) ? `<button class="btn btn-ghost row-icon-btn" type="button" data-action="edit" data-oid="${r.orden_id}" title="Editar" aria-label="Editar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>` : ""}
            <button class="btn btn-ghost row-icon-btn" type="button" data-action="detail" data-oid="${r.orden_id}" title="Detalle" aria-label="Detalle">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
        </div>
      </td>
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

  tb.querySelectorAll('button[data-action="route-transfer"]').forEach((btn) => btn.addEventListener("click", async () => {
    const oid = Number(btn.getAttribute("data-oid"));
    const moduleTarget = String(btn.getAttribute("data-module") || "").trim().toUpperCase();
    const row = (rows || []).find((x) => Number(x.orden_id) === oid);
    if (!row || !moduleTarget) return;
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = moduleTarget === "CORTADOR" ? "Enviando a CORTE..." : "Enviando a ACABADOS...";
    try {
      const res = await rpcTransferirOrdenRuta({
        ordenId: oid,
        moduloDestino: moduleTarget
      });
      msgJobs(res?.mensaje || `OK Orden ${oid} enviada a ${moduleTarget}.`);
      await loadJobs();
    } catch (e) {
      const detail = formatDbError(e);
      msgJobs(`ERROR: No se pudo transferir la orden ${row.numero_orden_fisica || oid}: ${detail}`);
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }));

  tb.querySelectorAll('button[data-action="detail"]').forEach((btn) => btn.addEventListener("click", async () => {
    const oid = Number(btn.getAttribute("data-oid"));
    const row = (rows || []).find((x) => Number(x.orden_id) === oid);
    if (!row) return;
    const extra = await fetchOrdenById(oid).catch(() => null);
    openDetalleOrden(row, extra);
  }));

  tb.querySelectorAll('button[data-action="edit"]').forEach((btn) => btn.addEventListener("click", async () => {
    const oid = Number(btn.getAttribute("data-oid"));
    const row = (rows || []).find((x) => Number(x.orden_id) === oid);
    if (!row) return;
    try {
      await openOrdenModalForEdit(row);
    } catch (e) {
      msgJobs("ERROR abriendo editor: " + (e?.message || e));
    }
  }));

  msgJobs(`Cargados: ${(rows || []).length} trabajo(s).`);
  syncAdminPanelHeights();
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
  const [ordenes, users, maqs, clienteTipos] = await Promise.all([
    fetchOrdenResumenByIds(orderIds),
    fetchProfilesByIds(userIds),
    fetchMaquinasByIds(maqIds),
    fetchClienteTiposByOrdenIds(orderIds)
  ]);
  const ordenMap = new Map((ordenes || []).map((o) => [o.orden_id, o.numero_orden_fisica]));
  const userMap = new Map((users || []).map((u) => [u.id, getProfileDisplayName(u) || u.username || u.id]));
  const maqMap = new Map((maqs || []).map((m) => [m.id, m.nombre]));
  const tipoClienteMap = new Map((clienteTipos || []).map((o) => [o.id, o.cliente?.tipo_cliente]));

  const selOperador = $("rgOperador");
  if (selOperador) {
    const current = selOperador.value || "";
    selOperador.innerHTML = `<option value="">Todos</option>` + (users || []).map((u) => `<option value="${u.id}">${esc(getProfileDisplayName(u) || u.username || u.id)}</option>`).join("");
    selOperador.value = current;
  }

  const activeRegs = (regs || []).filter((r) => !r.hora_fin);
  const activeWrap = $("regsActiveNow");
  if (activeWrap) {
    activeWrap.innerHTML = activeRegs.length
      ? activeRegs.map((r) => {
        const ordenRaw = (ordenes || []).find((o) => o.orden_id === r.orden_id) || {};
        const ordenNum = ordenRaw.numero_orden_fisica || ("#" + r.orden_id);
        const clienteNom = ordenRaw.cliente_nombre || "Sin cliente";
        const trabajoNom = ordenRaw.descripcion_trabajo || "Sin trabajo";
        const tipoC = tipoClienteMap.get(r.orden_id);
        const tipoBadge = tipoC ? ` - ${tipoC}` : "";
        const operador = userMap.get(r.user_id) || r.user_id || "-";
        const maq = maqMap.get(r.maquina_id) || r.maquina_id || "-";
        const cara = String(r.cara_impresion || "").toUpperCase();
        const juegoNum = Number(r.juego_num || 0);
        const sufijoCara = cara === "TIRA" ? "A" : (cara === "RETIRA" ? "B" : "");
        const juegoCaraLabel = (juegoNum && (cara === "TIRA" || cara === "RETIRA"))
          ? `${cara} ${juegoNum}${sufijoCara}`
          : "";
        return `<article class="live-card">
          <div class="live-card-top">
            <div>
              <div class="live-card-name">${esc(operador)}</div>
              <div class="live-card-order">Orden ${esc(ordenNum)}${juegoCaraLabel ? ` | ${esc(juegoCaraLabel)}` : ""}</div>
            </div>
            <div class="live-status"><span class="live-dot"></span>En curso</div>
          </div>
          <div class="live-meta">
            <div class="live-meta-item">
              <span class="k">Maquina / Inicio</span>
              <span class="v">${esc(maq)}</span>
              <div style="font-size: 11px; opacity: 0.8; margin-top: 4px;">${esc(fmtDTPE(r.hora_inicio))}</div>
            </div>
            <div class="live-meta-item">
              <span class="k" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;" title="CLIENTE${tipoBadge}">CLIENTE${tipoBadge}</span>
              <div class="v" style="font-size: 13px; white-space: normal; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;" title="${esc(clienteNom)}">${esc(clienteNom)}</div>
            </div>
            <div class="live-meta-item">
              <span class="k">Tiempo transcurrido</span>
              <span class="v" data-live-start="${esc(r.hora_inicio || "")}">${esc(formatDurationMinutes(r.hora_inicio))}</span>
            </div>
            <div class="live-meta-item">
              <span class="k">Trabajo</span>
              <div class="v" style="font-size: 13px; font-weight: normal; white-space: normal; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;" title="${esc(trabajoNom)}">${esc(trabajoNom)}</div>
            </div>
          </div>
        </article>`;
      }).join("")
      : `<div class="live-empty">No hay operadores trabajando en este momento con los filtros aplicados.</div>`;
  }

  const recentWrap = $("regsRecentList");
  if (recentWrap) {
    recentWrap.innerHTML = (regs || []).length
      ? (regs || []).slice(0, 14).map((r) => {
        const orden = ordenMap.get(r.orden_id) || ("#" + r.orden_id);
        const operador = userMap.get(r.user_id) || r.user_id || "-";
        const maq = maqMap.get(r.maquina_id) || r.maquina_id || "-";
        const status = r.hora_fin ? `Finalizo ${fmtDTPE(r.hora_fin)}` : `Activo desde ${fmtDTPE(r.hora_inicio)}`;
        return `<div class="live-row">
          <div class="ord">${esc(orden)}</div>
          <div class="op">${esc(operador)}</div>
          <div>${esc(maq)}</div>
          <div class="time">${esc(status)}</div>
        </div>`;
      }).join("")
      : `<div class="live-empty">No hay movimientos para mostrar.</div>`;
  }
  setKPIs(regs);
  refreshLiveDurationLabels();
  ensureLiveDurationTicker();
  liveRegsStatusText = activeRegs.length
    ? `Monitoreo activo: ${activeRegs.length} operador(es) trabajando ahora.`
    : `Sin operadores activos. Movimientos cargados: ${(regs || []).length}`;
  syncLivePanelMode();
  syncAdminPanelHeights();
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
    const obs = buildExternalObservaciones({ isExternal: isExt, observaciones: obsBase });
    const orden = {
      cliente_id: Number($("o_cliente").value),
      descripcion_trabajo: $("o_desc").value.trim(),
      fecha_entrega: dbLocalTimestamp($("o_entrega").value),
      prioridad: $("o_prio")?.value || "NORMAL",
      estado: toDbEstado(isExt ? "DISENO" : ($("o_estado")?.value || "DISENO")),
      responsable_diseno: currentAdminResponsable || "Administrador",
      es_externo: isExt,
      observaciones_generales: obs,
      tiene_oc: $("o_tiene_oc")?.checked ?? false,
      oc_numero: $("o_tiene_oc")?.checked ? ($("o_oc_numero")?.value?.trim() || null) : null,
      oc_observacion: $("o_tiene_oc")?.checked ? ($("o_oc_obs")?.value?.trim() || null) : null
    };
    const selectedMaterialId = $("d_material")?.value ? Number($("d_material").value) : null;
    const selectedFormatoOpt = isCustomFormatoSelected() ? null : ($("d_formato")?.selectedOptions?.[0] || null);
    const selectedMaterial = (materialesCache || []).find((m) => Number(m.id) === Number(selectedMaterialId));
    const formatoAncho = toNumOrNull(selectedFormatoOpt?.dataset?.ancho);
    const formatoAlto = toNumOrNull(selectedFormatoOpt?.dataset?.alto);
    const gramajeFromMaterial = toNumOrNull(selectedMaterial?.gramaje);
    const gramajeFinal = toNumOrNull($("d_gram")?.value) ?? gramajeFromMaterial;
    const anchoFinal = toNumOrNull($("d_ancho")?.value) ?? formatoAncho;
    const altoFinal = toNumOrNull($("d_alto")?.value) ?? formatoAlto;
    const cantFinal = toNumOrNull($("d_cant")?.value);
    const demasiaFinal = isExt ? null : toNumOrNull($("d_dem")?.value);
    const multiPlacasOn = $("d_multi_placas")?.checked ?? false;
    const juegosPlacaTotal = multiPlacasOn ? sanitizePlacasTotal($("d_placas_total")?.value || 2) : null;
    const juegosPlacaDetalle = multiPlacasOn ? collectJuegosPlacaDetalle() : [];

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
      formato_id: isCustomFormatoSelected() ? null : ($("d_formato")?.value ? Number($("d_formato").value) : null),
      cantidad_solicitada: cantFinal,
      demasia: demasiaFinal,
      maquina_sugerida_id: isExt ? null : (Number($("d_maq").value) || null),
      tipo_impresion: isExt ? null : toDbTipoImpresion($("d_tipoimp")?.value),
      observacion_tecnica: isExt ? null : ($("d_obs_tecnica")?.value?.trim() || null),
      requiere_juegos_placa: multiPlacasOn,
      juegos_placa_total: juegosPlacaTotal,
      juegos_placa_detalle: multiPlacasOn ? juegosPlacaDetalle : null,
      color_mode: toDbColorMode($("d_color_mode")?.value),
      color_text: $("d_color_text")?.value?.trim() || "F/C",
      corte: $("p_corte")?.checked ?? false,
      empaquetado: $("p_empaq")?.checked ?? false,
      doblez: $("p_doblez")?.checked ?? false,
      compaginado: $("p_compa")?.checked ?? false,
      troquelado: $("p_troq")?.checked ?? false,
      sectorizado: $("p_sect")?.checked ?? false,
      barniz: $("p_barniz")?.checked ?? false,
      plastificado: $("p_plast")?.value || null,
      encolado: $("p_encolado")?.checked ?? false,
      marcado: $("p_marcado")?.checked ?? false,
      anillado: $("p_anillado")?.checked ?? false,
      perforado: $("p_perforado")?.checked ?? false,
      perforado_tipo: $("p_perforado")?.checked ? ($("p_perforado_tipo")?.value || "PERFORADO") : null,
      pegado_solapa: $("p_pegado_solapa")?.checked ?? false,
      semi_corte: $("p_semi_corte")?.checked ?? false,
      enumerado: $("p_enumerado")?.checked ?? false,
      ruta_procesos: buildRoutePayload()
    };
    let res = null;
    if (ordenModalMode === "edit" && ordenEditId) {
      const latest = await fetchOrdenById(ordenEditId);
      if (!isEditableEstado(latest?.estado)) {
        msgCreate("ERROR: Esta orden ya no esta en DISENO/PLACAS y no puede editarse.");
        return;
      }
      res = await updateOrdenConDetalles({ ordenId: ordenEditId, orden, detalles });
      const ordSaved = await fetchOrdenById(ordenEditId).catch(() => null);
      const entregaSaved = fmtEntrega(ordSaved?.fecha_entrega);
      msgCreate(
        `OK Orden actualizada\nID: ${ordenEditId}\nNro Orden: ${res?.numero_orden_fisica || ("#" + ordenEditId)}\nEntrega guardada: ${entregaSaved}`
      );
    } else {
      res = await createOrdenConDetalles({ orden, detalles });
      const ordSaved = await fetchOrdenById(res.id).catch(() => null);
      const entregaSaved = fmtEntrega(ordSaved?.fecha_entrega);
      msgCreate(
        `OK Orden creada\nID: ${res.id}\nNro Orden: ${res.numero_orden_fisica || ("#" + res.id)}\nEntrega guardada: ${entregaSaved}`
      );
    }
    await loadJobs();
    await loadRegistros();
    clearOrdenForm();
    setOrdenModalMode("create");
    $("modalOrdenWrap")?.classList.add("hide");
  } catch (e) {
    console.error("CREATE_ORDEN_ERROR", {
      message: e?.message || null,
      code: e?.code || null,
      details: e?.details || null,
      hint: e?.hint || null,
      raw: e
    });
    msgCreate("ERROR guardando orden:\n" + formatDbError(e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = old; }
    refreshFormState();
  }
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
        <div class="sub">${isServicioOnly ? "Formato: Servicio de impresion (sin OC ni guia)." : "Formato: Completo."}</div>
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
  const rawName = String(getProfileDisplayName(prof) || "").trim();
  const displayName = rawName && !rawName.includes("@")
    ? rawName
    : (prof?.rol === "ADMIN" ? "Administrador" : "Usuario");
  initFullscreenToggle();
  currentAdminResponsable = displayName || "Administrador";
  setText("userPill", `${displayName} | ${prof.rol}`);
  syncResponsableDisenoField();

  $("btnReporteEntregados")?.addEventListener("click", exportReporteEntregadosCsv);
  bindAdminEvents({
    $,
    logout,
    msgJobs,
    loadJobs,
    loadRegistros,
    debounce,
    syncClienteSelectedText,
    syncOcFields,
    refreshFormState,
    syncMaterialSelectedText,
    syncExternalFlowUI,
    setOrdenModalMode,
    clearOrdenForm,
    onGuardarOrden,
    closeDetalleOrden,
    getDetailRowCtx: () => detailRowCtx,
    getDetailExtraCtx: () => detailExtraCtx,
    printOrden,
    closeEntregaModal,
    confirmEntregaDesdeModal,
    syncEntregaGuiaFields,
    syncRouteDraftFromForm,
    openRouteModal,
    closeRouteModal,
    moveRouteItem,
    buildDefaultRouteDraft,
    toggleRouteProcess,
    setRouteProcessVariant,
    syncRegsPresetChips,
    setLivePanelMode,
    togglePinnedPendingOrder,
    openPendingEntregaModal,
    openPendingPanelDetail
  });

  wireSmartPickers();
  await loadCombosClientesMaquinas();
  await loadCombosMaterialesFormatos();
  wireAutoFillMaterialFormato();
  wireJuegosPlaca();
  syncOcFields();
  syncEntregaGuiaFields();
  syncExternalFlowUI();
  syncJuegosPlacaUI();
  renderRouteSummary();
  renderRouteModalList();
  refreshFormState();
  bindAdminPanelHeightSync();
  bindRealtime();
  await loadJobs();
  await loadRegistros();
  syncAdminPanelHeights();
})().catch((e) => {
  console.error("ADMIN_INIT_ERROR:", e);
  setText("userPill", "Error de carga");
  msgJobs("ERROR inicializando Admin: " + (e?.message || e));
  msgRegs("Revisa consola del navegador.");
});





