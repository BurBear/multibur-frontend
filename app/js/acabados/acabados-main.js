import { requireRole, logout, getProfileDisplayName } from "../auth.js";
import {
  fetchAcabadosBoardSnapshot,
  fetchOrdenesAncladas,
  rpcEnsureOrdenProcesosAcabados,
  rpcFinalizarProcesoAcabado,
  rpcIniciarProcesoAcabado,
  rpcPausarProcesoAcabado,
  rpcRetomarProcesoAcabado,
  rpcTransferirOrdenRuta
} from "../api.js";
import { initFullscreenToggle } from "../fullscreen.js";
import { formatDbError } from "../utils/helpers.js";
import { createToastController } from "../utils/toast.js";
import { bindAcabadosEvents } from "./acabados-events.js";
import { renderAcabadosApp } from "./acabados-render.js";
import {
  acabadosState,
  clearActionNoteDraft,
  closeDetail,
  getSelectedOrder,
  getSelectedProcess,
  setActionLoading,
  setOrders,
  setSelection,
  setSession
} from "./acabados-state.js";

const { showToast } = createToastController();
let boardSnapshotCache = [];
let boardCacheReady = false;
let pinnedRowsCache = [];
let pinnedSyncScheduled = false;
let pinnedSignatureCache = "";

function getPauseModalElements() {
  return {
    modal: document.getElementById("pauseModal"),
    reason: document.getElementById("pauseReason"),
    observation: document.getElementById("pauseObservation"),
    message: document.getElementById("pauseMsg")
  };
}

function setPauseMessage(text, isError = false) {
  const { message } = getPauseModalElements();
  if (!message) return;
  message.textContent = text || "";
  message.classList.toggle("is-error", !!isError);
}

function buildPauseNote() {
  const { reason, observation } = getPauseModalElements();
  const motivo = String(reason?.value || "").trim();
  const observacion = String(observation?.value || "").trim();
  if (!motivo) return null;
  if (!observacion) return `Motivo: ${motivo}`;
  return `Motivo: ${motivo}\nObservacion: ${observacion}`;
}

function openPauseModal() {
  const process = getSelectedProcess();
  const currentUserId = acabadosState.currentUser?.id || null;
  const isMineActive = process?.estado === "EN_PROCESO" && currentUserId && process?.assigned_user_id === currentUserId;
  if (!isMineActive) {
    showToast("Solo puedes pausar un proceso que ya esta en curso contigo.", "warn");
    return;
  }

  const { modal, reason, observation } = getPauseModalElements();
  if (!modal) return;
  if (reason) reason.value = "";
  if (observation) observation.value = "";
  setPauseMessage("");
  modal.hidden = false;
  modal.classList.add("is-open");
}

function closePauseModal() {
  const { modal, reason, observation } = getPauseModalElements();
  if (!modal) return;
  modal.hidden = true;
  modal.classList.remove("is-open");
  if (reason) reason.value = "";
  if (observation) observation.value = "";
  setPauseMessage("");
}

function setMessage(text, isError = false) {
  const el = document.getElementById("msgAcabados");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("is-error", !!isError);
}

function syncUserPill() {
  const el = document.getElementById("userPill");
  if (!el) return;
  const display = getProfileDisplayName(acabadosState.currentProfile) || acabadosState.currentProfile?.rol || "-";
  el.textContent = display;
}

function syncMainMenuButton() {
  const el = document.getElementById("btnMainMenu");
  if (!el) return;

  const role = String(acabadosState.currentProfile?.rol || "").toUpperCase();
  const shouldShow = role === "CORTADOR";

  el.hidden = !shouldShow;
  el.onclick = shouldShow ? () => {
    window.location.href = "./cortador_hub.html";
  } : null;
}

function renderAll() {
  if (!acabadosState.detailOpen) {
    closePauseModal();
  }
  renderAcabadosApp();
}

function orderNeedsSeed(order = null) {
  if (!order) return false;
  return !!(
    order.empaquetado ||
    order.doblez ||
    order.compaginado ||
    order.troquelado ||
    order.sectorizado ||
    order.barniz ||
    String(order.plastificado || "").trim() ||
    order.encolado ||
    order.marcado ||
    order.anillado ||
    order.perforado ||
    order.pegado_solapa ||
    order.semi_corte ||
    order.enumerado
  );
}

function pickNextOpenProcess(order = null, excludeProcessId = null) {
  const excluded = Number(excludeProcessId || 0);
  return (order?.procesos || []).find((process) =>
    Number(process.id) !== excluded && ["PENDIENTE", "PAUSADO"].includes(process.estado)
  ) || null;
}

function buildPinnedMeta(pinnedRows = []) {
  const orderedIds = [...new Set(
    (pinnedRows || [])
      .map((row) => Number(row?.orden_id || row))
      .filter(Boolean)
  )];
  return {
    ids: new Set(orderedIds),
    rankMap: new Map(orderedIds.map((ordenId, index) => [ordenId, index + 1]))
  };
}

function applyPinnedPriorityToOrders(orders = [], pinnedMeta = buildPinnedMeta()) {
  const orderedRows = (orders || [])
    .map((order, index) => {
      const ordenId = Number(order?.orden_id || 0);
      const pinnedRank = pinnedMeta.rankMap.get(ordenId) || null;
      return {
        ...order,
        is_pinned: pinnedMeta.ids.has(ordenId),
        pinned_rank: pinnedRank,
        _board_index: index
      };
    })
    .sort((a, b) => {
      const aPinned = a.is_pinned ? 0 : 1;
      const bPinned = b.is_pinned ? 0 : 1;
      if (aPinned !== bPinned) return aPinned - bPinned;
      if (aPinned === 0 && bPinned === 0) {
        return (a.pinned_rank || Number.MAX_SAFE_INTEGER) - (b.pinned_rank || Number.MAX_SAFE_INTEGER);
      }
      return Number(a._board_index || 0) - Number(b._board_index || 0);
    });

  let visiblePinnedRank = 0;
  return orderedRows.map((order) => {
    if (!order?.is_pinned) {
      return {
        ...order,
        visible_pinned_rank: null
      };
    }
    visiblePinnedRank += 1;
    return {
      ...order,
      visible_pinned_rank: visiblePinnedRank
    };
  });
}

function getCurrentSelectionOptions() {
  return {
    keepOrderId: acabadosState.selectedOrderId,
    keepProcessId: acabadosState.selectedProcessId,
    openDetail: !!acabadosState.detailOpen
  };
}

function serializePinnedRows(pinnedRows = []) {
  return (pinnedRows || [])
    .map((row) => `${Number(row?.orden_id || row || 0)}`)
    .filter(Boolean)
    .join("|");
}

function buildVisibleOrders(orders = []) {
  return (orders || []).filter(
    (order) => (order.procesos || []).length > 0 || order.requires_handoff
  );
}

function updateCachedBoardSnapshot(orders = []) {
  boardSnapshotCache = Array.isArray(orders) ? orders : [];
  boardCacheReady = true;
}

function renderBoardFromSnapshot(orders = [], options = {}) {
  const pinnedMeta = buildPinnedMeta(pinnedRowsCache || []);
  const visibleOrders = buildVisibleOrders(orders);
  const prioritizedOrders = applyPinnedPriorityToOrders(visibleOrders, pinnedMeta);

  setOrders(prioritizedOrders);
  applyPostLoadSelection(prioritizedOrders, options);
  renderAll();
  return prioritizedOrders;
}

async function syncPinnedOrdersInBackground() {
  pinnedSyncScheduled = false;
  if (!boardCacheReady) return;
  let nextPinnedRows = [];
  try {
    nextPinnedRows = await fetchOrdenesAncladas();
  } catch (error) {
    console.warn("No pude sincronizar anclados para ACABADOS.", error);
    return;
  }

  const nextSignature = serializePinnedRows(nextPinnedRows);
  if (nextSignature === pinnedSignatureCache) return;
  pinnedRowsCache = nextPinnedRows;
  pinnedSignatureCache = nextSignature;

  const perfStart = performance.now();
  renderBoardFromSnapshot(boardSnapshotCache, getCurrentSelectionOptions());
  console.log("[AcabadosPerf] loadBoard", {
    reason: "pins-sync",
    cacheUsada: true,
    fetchSnapshotMs: 0,
    seedMs: 0,
    renderMs: Number((performance.now() - perfStart).toFixed(1)),
    totalMs: Number((performance.now() - perfStart).toFixed(1)),
    rowsBeforeFilters: boardSnapshotCache.length,
    rowsRendered: acabadosState.filteredOrders.length
  });
}

function requestPinnedSync() {
  if (pinnedSyncScheduled) return;
  pinnedSyncScheduled = true;
  setTimeout(() => {
    syncPinnedOrdersInBackground().catch((error) => {
      pinnedSyncScheduled = false;
      console.warn("No pude actualizar anclados en segundo plano para ACABADOS.", error);
    });
  }, 0);
}

function applyPostLoadSelection(orders, options = {}) {
  const {
    keepOrderId = null,
    keepProcessId = null,
    openDetail = false,
    advanceAfterFinish = false,
    excludeProcessId = null
  } = options;

  if (!keepOrderId) {
    if (!openDetail) closeDetail();
    return;
  }

  const order = (orders || []).find((item) => Number(item.orden_id) === Number(keepOrderId));
  if (!order) {
    closeDetail();
    return;
  }

  let nextProcess = null;
  if (advanceAfterFinish) {
    nextProcess = pickNextOpenProcess(order, excludeProcessId);
  }

  if (advanceAfterFinish && !nextProcess && !keepProcessId) {
    if (order.requires_handoff) {
      setSelection({
        orderId: order.orden_id,
        processId: null,
        detailOpen: true
      });
      return;
    }
    setSelection({
      orderId: order.orden_id,
      processId: null,
      detailOpen: false
    });
    return;
  }

  if (!nextProcess && keepProcessId) {
    nextProcess = (order.procesos || []).find((process) => Number(process.id) === Number(keepProcessId)) || null;
  }

  if (!nextProcess) {
    nextProcess = (order.procesos || [])[0] || null;
  }

  if (nextProcess) {
    setSelection({
      orderId: order.orden_id,
      processId: nextProcess.id,
      detailOpen: !!openDetail
    });
    return;
  }

  setSelection({
    orderId: order.orden_id,
    processId: null,
    detailOpen: false
  });
}

async function ensureMissingSeeds(orders = []) {
  const pendingSeed = (orders || []).filter((order) => {
    const routeCount = Array.isArray(order?.ruta_procesos) ? order.ruta_procesos.length : 0;
    const seededRouteCount = Array.isArray(order?.procesos_ruta) ? order.procesos_ruta.length : 0;
    if (routeCount > 0) {
      return seededRouteCount < routeCount;
    }
    return orderNeedsSeed(order) && seededRouteCount === 0;
  });

  if (!pendingSeed.length) {
    return { orders, seededOrders: 0, failures: [] };
  }

  let seededOrders = 0;
  let shouldRefresh = false;
  const failures = [];

  for (const order of pendingSeed) {
    try {
      const result = await rpcEnsureOrdenProcesosAcabados({ ordenId: order.orden_id });
      if (Number(result?.total_acabados || 0) > 0) seededOrders += 1;
      if (Number(result?.sembrados || 0) > 0) shouldRefresh = true;
    } catch (error) {
      console.error(`No pude sembrar procesos para la orden ${order.orden_id}.`, error);
      failures.push({
        ordenId: order.orden_id,
        numeroOrden: order.numero_orden_fisica || `#${order.orden_id}`,
        error
      });
    }
  }

  if (!shouldRefresh) {
    return { orders, seededOrders, failures };
  }

  const refreshed = await fetchAcabadosBoardSnapshot({ userId: acabadosState.currentUser?.id || null });
  return {
    orders: refreshed,
    seededOrders,
    failures
  };
}

async function loadBoard(options = {}) {
  const force = options.force !== false;
  const reason = String(options.reason || (force ? "force-refresh" : "cache-render"));
  const perfStart = performance.now();
  let fetchSnapshotMs = 0;
  let seedMs = 0;

  if (reason !== "pins-sync") {
    setMessage("Cargando tablero de ACABADOS...");
  }
  try {
    let orders = [];
    if (!force && boardCacheReady) {
      orders = boardSnapshotCache;
    } else {
      const fetchStart = performance.now();
      orders = await fetchAcabadosBoardSnapshot({ userId: acabadosState.currentUser?.id || null });
      fetchSnapshotMs = performance.now() - fetchStart;

      const seedStart = performance.now();
      const seedResult = await ensureMissingSeeds(orders);
      seedMs = performance.now() - seedStart;
      orders = seedResult.orders || orders;

      updateCachedBoardSnapshot(orders);

      if (seedResult.seededOrders > 0) {
        showToast(`Se prepararon procesos para ${seedResult.seededOrders} orden(es) de ACABADOS.`, "info");
      }

      if (seedResult.failures.length) {
        showToast(`No pude preparar ${seedResult.failures.length} orden(es) automaticamente.`, "warn");
      }
    }

    const renderStart = performance.now();
    const prioritizedOrders = renderBoardFromSnapshot(orders, options);
    const renderMs = performance.now() - renderStart;

    requestPinnedSync();

    if (!prioritizedOrders.length) {
      setMessage("No hay trabajos listos para ACABADOS por ahora.");
    } else {
      setMessage(`Trabajos listos para ACABADOS: ${prioritizedOrders.length}.`);
    }

    console.log("[AcabadosPerf] loadBoard", {
      reason,
      force,
      cacheUsada: !force && boardCacheReady,
      fetchSnapshotMs: Number(fetchSnapshotMs.toFixed(1)),
      seedMs: Number(seedMs.toFixed(1)),
      renderMs: Number(renderMs.toFixed(1)),
      pinnedDeferred: true,
      rowsBeforeFilters: Array.isArray(orders) ? orders.length : 0,
      rowsRendered: acabadosState.filteredOrders.length,
      totalMs: Number((performance.now() - perfStart).toFixed(1))
    });
  } catch (error) {
    console.error(error);
    setMessage(`No pude cargar ACABADOS:\n${formatDbError(error)}`, true);
  }
}

function getActionNote() {
  const el = document.getElementById("detailActionNote");
  return el?.value?.trim() || null;
}

async function runAction(actionName, runner) {
  setActionLoading(true, actionName);
  renderAll();
  try {
    await runner();
    return true;
  } catch (error) {
    console.error(error);
    const detail = formatDbError(error);
    const verbMap = {
      INICIAR: "iniciar",
      PAUSAR: "pausar",
      RETOMAR: "retomar",
      FINALIZAR: "finalizar",
      MANDAR_CORTE: "mandar la orden a corte",
      MANDAR_ACABADOS: "mandar la orden a acabados"
    };
    const verb = verbMap[String(actionName || "").toUpperCase()] || "procesar";
    setMessage(`No pude ${verb} el proceso:\n${detail}`, true);
    showToast(detail, "warn");
    return false;
  } finally {
    setActionLoading(false, "");
    renderAll();
  }
}

async function handleStart() {
  const process = getSelectedProcess();
  if (!process?.id) return;

  await runAction("INICIAR", async () => {
    const result = await rpcIniciarProcesoAcabado({ procesoId: process.id });
    clearActionNoteDraft();
    await loadBoard({
      force: true,
      reason: "start",
      keepOrderId: result?.orden_id || process.orden_id,
      keepProcessId: result?.proceso_id || process.id,
      openDetail: true
    });
    setMessage(result?.mensaje || `Proceso ${process.proceso_codigo} iniciado correctamente.`);
    showToast(result?.mensaje || `Proceso iniciado: ${process.proceso_codigo}.`, "success");
  });
}

async function handlePause() {
  const process = getSelectedProcess();
  if (!process?.id) return;
  const note = buildPauseNote();
  if (!note) {
    setPauseMessage("Selecciona un motivo de pausa.", true);
    return false;
  }

  const ok = await runAction("PAUSAR", async () => {
    const result = await rpcPausarProcesoAcabado({
      procesoId: process.id,
      observaciones: note
    });
    clearActionNoteDraft();
    await loadBoard({
      force: true,
      reason: "pause",
      keepOrderId: result?.orden_id || process.orden_id,
      keepProcessId: result?.proceso_id || process.id,
      openDetail: true
    });
    setMessage(result?.mensaje || `Proceso ${process.proceso_codigo} pausado correctamente.`);
    showToast(result?.mensaje || `Proceso pausado: ${process.proceso_codigo}.`, "warn");
  });
  if (ok) closePauseModal();
  return ok;
}

async function handleResume() {
  const process = getSelectedProcess();
  if (!process?.id) return;

  await runAction("RETOMAR", async () => {
    const result = await rpcRetomarProcesoAcabado({ procesoId: process.id });
    clearActionNoteDraft();
    await loadBoard({
      force: true,
      reason: "resume",
      keepOrderId: result?.orden_id || process.orden_id,
      keepProcessId: result?.proceso_id || process.id,
      openDetail: true
    });
    setMessage(result?.mensaje || `Proceso ${process.proceso_codigo} retomado correctamente.`);
    showToast(result?.mensaje || `Proceso retomado: ${process.proceso_codigo}.`, "success");
  });
}

async function handleFinish() {
  const process = getSelectedProcess();
  const order = getSelectedOrder();
  if (!process?.id || !order?.orden_id) return;
  const note = getActionNote();

  await runAction("FINALIZAR", async () => {
    const result = await rpcFinalizarProcesoAcabado({
      procesoId: process.id,
      observaciones: note
    });
    clearActionNoteDraft();
    await loadBoard({
      force: true,
      reason: "finish",
      keepOrderId: result?.orden_id || order.orden_id,
      keepProcessId: null,
      openDetail: true,
      advanceAfterFinish: true,
      excludeProcessId: process.id
    });
    setMessage(result?.mensaje || `Proceso ${process.proceso_codigo} finalizado correctamente.`);

    const refreshedOrder = acabadosState.filteredOrders.find((item) => Number(item.orden_id) === Number(order.orden_id)) || null;
    if (refreshedOrder?.requires_handoff) {
      showToast(
        String(refreshedOrder.handoff_target_module || "").toUpperCase() === "CORTADOR"
          ? "Proceso finalizado. La orden esta lista para mandar a corte."
          : "Proceso finalizado. La orden esta lista para mandar a acabados.",
        "success"
      );
      return;
    }
    const nextProcess = pickNextOpenProcess(refreshedOrder, process.id);
    if (!nextProcess) {
      closeDetail();
      renderAll();
      showToast(
        result?.nuevo_estado_orden === "TERMINADO"
          ? `Orden ${order.numero_orden_fisica || `#${order.orden_id}`} terminada en ACABADOS.`
          : `Proceso finalizado. No quedan mas procesos abiertos en esta orden.`,
        "success"
      );
      return;
    }

    showToast(`Proceso finalizado. Siguiente proceso: ${nextProcess.proceso_codigo}.`, "success");
  });
}

async function handleTransfer(targetModule) {
  const order = getSelectedOrder();
  if (!order?.orden_id || !order.requires_handoff) return;

  const target = String(targetModule || "").trim().toUpperCase();
  await runAction(target === "CORTADOR" ? "MANDAR_CORTE" : "MANDAR_ACABADOS", async () => {
    const result = await rpcTransferirOrdenRuta({
      ordenId: order.orden_id,
      moduloDestino: target
    });
    clearActionNoteDraft();
    await loadBoard({ force: true, reason: "handoff" });
    setMessage(result?.mensaje || `Orden ${order.numero_orden_fisica || `#${order.orden_id}`} transferida correctamente.`);
    showToast(
      result?.mensaje || (
        target === "CORTADOR"
          ? "Orden enviada a corte."
          : "Orden enviada a acabados."
      ),
      "success"
    );
  });
}

async function handleAction(action) {
  switch (String(action || "").toLowerCase()) {
    case "start":
      await handleStart();
      return;
    case "pause":
      openPauseModal();
      return;
    case "confirm-pause":
      await handlePause();
      return;
    case "resume":
      await handleResume();
      return;
    case "finish":
      await handleFinish();
      return;
    case "handoff-cortador":
      await handleTransfer("CORTADOR");
      return;
    case "handoff-acabados":
      await handleTransfer("ACABADOS");
      return;
    default:
      return;
  }
}

async function handleLogout() {
  await logout();
  window.location.href = "./login.html";
}

async function init() {
  const session = await requireRole(["ACABADOS", "CORTADOR"]);
  if (!session) return;

  setSession(session);
  syncUserPill();
  syncMainMenuButton();
  initFullscreenToggle({ containerSelector: ".top-right", insertBeforeSelector: "#btnLogout" });
  renderAll();

  bindAcabadosEvents({
    onStateChange: renderAll,
    onAction: handleAction,
    onPauseClose: closePauseModal,
    onLogout: handleLogout
  });

  await loadBoard({ force: true, reason: "initial" });
}

init();
