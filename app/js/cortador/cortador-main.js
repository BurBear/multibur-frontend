import { requireRole, logout, getProfileDisplayName } from "../auth.js";
import {
  fetchCortadorBoardSnapshot,
  rpcEnsureOrdenProcesosAcabados,
  rpcFinalizarProcesoAcabado,
  rpcFinalizarProcesoCortador,
  rpcIniciarProcesoAcabado,
  rpcIniciarProcesoCortador,
  rpcPausarProcesoAcabado,
  rpcPausarProcesoCortador,
  rpcRetomarProcesoAcabado,
  rpcRetomarProcesoCortador,
  rpcTransferirOrdenRuta
} from "../api.js";
import { initFullscreenToggle } from "../fullscreen.js";
import { formatDbError } from "../utils/helpers.js";
import { createToastController } from "../utils/toast.js";
import { bindCortadorEvents } from "./cortador-events.js";
import { renderCortadorApp } from "./cortador-render.js";
import {
  cortadorState,
  clearActionNoteDraft,
  closeDetail,
  getSelectedOrder,
  getSelectedProcess,
  setActionLoading,
  setOrders,
  setSelection,
  setSession
} from "./cortador-state.js";

const { showToast } = createToastController();

function setMessage(text, isError = false) {
  const el = document.getElementById("msgCortador");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("is-error", !!isError);
}

function syncUserPill() {
  const el = document.getElementById("userPill");
  if (!el) return;
  const display = getProfileDisplayName(cortadorState.currentProfile) || cortadorState.currentProfile?.rol || "-";
  el.textContent = display;
}

function syncMainMenuButton() {
  const el = document.getElementById("btnMainMenu");
  if (!el) return;

  el.hidden = false;
  el.onclick = () => {
    window.location.href = "./cortador_hub.html";
  };
}

function renderAll() {
  renderCortadorApp();
}

function orderNeedsSeed(order = null) {
  if (!order) return false;
  return !!(
    order.corte ||
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
      if (Number(result?.sembrados || 0) > 0 || Number(result?.total_acabados || 0) > 0) seededOrders += 1;
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

  const refreshed = await fetchCortadorBoardSnapshot({ userId: cortadorState.currentUser?.id || null });
  return {
    orders: refreshed,
    seededOrders,
    failures
  };
}

async function loadBoard(options = {}) {
  setMessage("Cargando tablero de CORTADOR...");
  try {
    let orders = await fetchCortadorBoardSnapshot({ userId: cortadorState.currentUser?.id || null });
    const seedResult = await ensureMissingSeeds(orders);
    orders = seedResult.orders || orders;
    const visibleOrders = (orders || []).filter(
      (order) => (order.procesos || []).length > 0 || order.requires_handoff
    );

    setOrders(visibleOrders);
    applyPostLoadSelection(visibleOrders, options);
    renderAll();

    if (seedResult.seededOrders > 0) {
      showToast(`Se prepararon procesos para ${seedResult.seededOrders} orden(es) de CORTADOR.`, "info");
    }

    if (seedResult.failures.length) {
      showToast(`No pude preparar ${seedResult.failures.length} orden(es) automaticamente.`, "warn");
    }

    if (!visibleOrders.length) {
      setMessage("No hay trabajos listos para CORTADOR por ahora.");
      return;
    }

    setMessage(`Trabajos listos para CORTADOR: ${visibleOrders.length}.`);
  } catch (error) {
    console.error(error);
    setMessage(`No pude cargar CORTADOR:\n${formatDbError(error)}`, true);
  }
}

function getActionNote() {
  const el = document.getElementById("detailActionNote");
  return el?.value?.trim() || null;
}

function isAcabadosProcess(process = null) {
  return String(process?.modulo_responsable || "").trim().toUpperCase() === "ACABADOS";
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
  const order = getSelectedOrder();
  if (!process?.id || !order?.orden_id) return;

  await runAction("INICIAR", async () => {
    let result = null;
    if (isAcabadosProcess(process)) {
      await rpcTransferirOrdenRuta({
        ordenId: order.orden_id,
        moduloDestino: "ACABADOS"
      });
      result = await rpcIniciarProcesoAcabado({ procesoId: process.id });
    } else {
      result = await rpcIniciarProcesoCortador({ procesoId: process.id });
    }
    clearActionNoteDraft();
    await loadBoard({
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
  const note = getActionNote();

  await runAction("PAUSAR", async () => {
    const result = isAcabadosProcess(process)
      ? await rpcPausarProcesoAcabado({
        procesoId: process.id,
        observaciones: note
      })
      : await rpcPausarProcesoCortador({
        procesoId: process.id,
        observaciones: note
      });
    clearActionNoteDraft();
    await loadBoard({
      keepOrderId: result?.orden_id || process.orden_id,
      keepProcessId: result?.proceso_id || process.id,
      openDetail: true
    });
    setMessage(result?.mensaje || `Proceso ${process.proceso_codigo} pausado correctamente.`);
    showToast(result?.mensaje || `Proceso pausado: ${process.proceso_codigo}.`, "warn");
  });
}

async function handleResume() {
  const process = getSelectedProcess();
  const order = getSelectedOrder();
  if (!process?.id || !order?.orden_id) return;

  await runAction("RETOMAR", async () => {
    let result = null;
    if (isAcabadosProcess(process)) {
      await rpcTransferirOrdenRuta({
        ordenId: order.orden_id,
        moduloDestino: "ACABADOS"
      });
      result = await rpcRetomarProcesoAcabado({ procesoId: process.id });
    } else {
      result = await rpcRetomarProcesoCortador({ procesoId: process.id });
    }
    clearActionNoteDraft();
    await loadBoard({
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
    const result = isAcabadosProcess(process)
      ? await rpcFinalizarProcesoAcabado({
        procesoId: process.id,
        observaciones: note
      })
      : await rpcFinalizarProcesoCortador({
        procesoId: process.id,
        observaciones: note
      });
    clearActionNoteDraft();
    await loadBoard({
      keepOrderId: result?.orden_id || order.orden_id,
      keepProcessId: null,
      openDetail: true,
      advanceAfterFinish: true,
      excludeProcessId: process.id
    });
    setMessage(result?.mensaje || `Proceso ${process.proceso_codigo} finalizado correctamente.`);

    const refreshedOrder = cortadorState.filteredOrders.find((item) => Number(item.orden_id) === Number(order.orden_id)) || null;
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
    if (refreshedOrder?.same_operator_tail_empaquetado && String(nextProcess?.proceso_codigo || "").trim().toUpperCase() === "EMPAQUETADO") {
      showToast("Proceso finalizado. Puedes continuar con Empaquetado aqui mismo.", "success");
      return;
    }
    if (!nextProcess) {
      closeDetail();
      renderAll();
      showToast(
        result?.nuevo_estado_orden === "TERMINADO"
          ? `Orden ${order.numero_orden_fisica || `#${order.orden_id}`} terminada en CORTADOR.`
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
    await loadBoard();
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
  const session = await requireRole("CORTADOR");
  if (!session) return;

  setSession(session);
  syncUserPill();
  syncMainMenuButton();
  initFullscreenToggle({ containerSelector: ".top-right", insertBeforeSelector: "#btnLogout" });
  renderAll();

  bindCortadorEvents({
    onStateChange: renderAll,
    onAction: handleAction,
    onLogout: handleLogout
  });

  await loadBoard();
}

init();

