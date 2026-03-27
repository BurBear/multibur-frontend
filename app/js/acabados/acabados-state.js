import { normalizeText } from "../utils/helpers.js";

export const acabadosState = {
  currentUser: null,
  currentProfile: null,
  orders: [],
  filteredOrders: [],
  summary: {
    pendientes: 0,
    enProceso: 0,
    pausados: 0,
    finalizadosHoy: 0
  },
  myProcesses: [],
  query: "",
  selectedOrderId: null,
  selectedProcessId: null,
  detailOpen: false,
  actionLoading: false,
  actionType: "",
  actionNoteDraft: ""
};

function processLabelForSearch(process) {
  const code = String(process?.proceso_codigo || "").trim().toUpperCase();
  const mode = String(process?.configuracion?.modo || "").trim();
  const perforadoTipo = String(process?.configuracion?.tipo || "").trim();
  if (code === "PLASTIFICADO" && mode) return `plastificado ${mode}`;
  if (code === "PERFORADO" && perforadoTipo) return `perforado ${perforadoTipo}`;
  return code.toLowerCase().replace(/_/g, " ");
}

function isSamePeruDay(value, now = new Date()) {
  if (!value) return false;
  const options = { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" };
  const target = new Date(value).toLocaleDateString("en-CA", options);
  const today = new Date(now).toLocaleDateString("en-CA", options);
  return target === today;
}

function buildProgress(procesos = []) {
  const total = procesos.length;
  const pendientes = procesos.filter((p) => p.estado === "PENDIENTE").length;
  const enProceso = procesos.filter((p) => p.estado === "EN_PROCESO").length;
  const pausados = procesos.filter((p) => p.estado === "PAUSADO").length;
  const finalizados = procesos.filter((p) => p.estado === "FINALIZADO").length;
  const cancelados = procesos.filter((p) => p.estado === "CANCELADO").length;
  const completados = finalizados + cancelados;
  const porcentaje = total > 0 ? Math.round((completados / total) * 100) : 0;

  return {
    total,
    pendientes,
    enProceso,
    pausados,
    finalizados,
    cancelados,
    completados,
    porcentaje
  };
}

function decorateOrder(order) {
  const procesos = Array.isArray(order?.procesos) ? order.procesos.map((p) => ({ ...p })) : [];
  const procesosTodos = Array.isArray(order?.procesos_todos) ? order.procesos_todos.map((p) => ({ ...p })) : procesos;
  return {
    ...order,
    procesos,
    procesos_todos: procesosTodos,
    hasSeed: procesos.length > 0,
    progreso: buildProgress(procesosTodos)
  };
}

function buildSummary(orders = []) {
  const allProcesses = orders.flatMap((order) => order.procesos || []);
  return {
    pendientes: allProcesses.filter((p) => p.estado === "PENDIENTE").length,
    enProceso: allProcesses.filter((p) => p.estado === "EN_PROCESO").length,
    pausados: allProcesses.filter((p) => p.estado === "PAUSADO").length,
    finalizadosHoy: allProcesses.filter((p) => p.estado === "FINALIZADO" && isSamePeruDay(p.finished_at)).length
  };
}

function buildMyProcesses(orders = [], userId = null) {
  if (!userId) return [];
  const output = [];
  for (const order of orders) {
    for (const process of order.procesos || []) {
      if (process.assigned_user_id !== userId) continue;
      if (!["EN_PROCESO", "PAUSADO"].includes(process.estado)) continue;
      output.push({
        ...process,
        orden_id: order.orden_id,
        numero_orden_fisica: order.numero_orden_fisica,
        cliente_nombre: order.cliente_nombre,
        descripcion_trabajo: order.descripcion_trabajo
      });
    }
  }
  return output.sort((a, b) => {
    const aTime = new Date(a.updated_at || a.started_at || 0).getTime();
    const bTime = new Date(b.updated_at || b.started_at || 0).getTime();
    return bTime - aTime;
  });
}

function orderMatchesQuery(order, query) {
  if (!query) return true;
  const haystack = normalizeText([
    order.numero_orden_fisica,
    order.cliente_nombre,
    order.descripcion_trabajo,
    order.observacion_orden,
    order.observacion_tecnica,
    order.tipo_impresion,
    order.color_text,
    order.formato_text,
    ...(order.procesos || []).map((p) => processLabelForSearch(p))
  ].join(" "));
  return haystack.includes(query);
}

function ensureSelection() {
  const filtered = acabadosState.filteredOrders || [];
  const selectedExists = filtered.some((order) => Number(order.orden_id) === Number(acabadosState.selectedOrderId));

  if (!selectedExists) {
    acabadosState.selectedOrderId = null;
    acabadosState.selectedProcessId = null;
    acabadosState.detailOpen = false;
    return;
  }

  const selectedOrder = filtered.find((order) => Number(order.orden_id) === Number(acabadosState.selectedOrderId));
  if (!selectedOrder) {
    acabadosState.selectedProcessId = null;
    acabadosState.detailOpen = false;
    return;
  }

  const selectedProcessExists = (selectedOrder.procesos || []).some(
    (process) => Number(process.id) === Number(acabadosState.selectedProcessId)
  );

  if (!selectedProcessExists) {
    acabadosState.selectedProcessId = selectedOrder.procesos?.[0]?.id ?? null;
  }
}

function recompute() {
  acabadosState.summary = buildSummary(acabadosState.orders);
  acabadosState.myProcesses = buildMyProcesses(acabadosState.orders, acabadosState.currentUser?.id || null);

  const query = normalizeText(acabadosState.query);
  acabadosState.filteredOrders = acabadosState.orders.filter((order) => orderMatchesQuery(order, query));

  ensureSelection();
}

export function setSession({ user, prof }) {
  acabadosState.currentUser = user || null;
  acabadosState.currentProfile = prof || null;
  recompute();
}

export function setOrders(orders = []) {
  acabadosState.orders = (orders || []).map(decorateOrder);
  recompute();
}

export function setQuery(query = "") {
  acabadosState.query = String(query || "");
  recompute();
}

export function selectOrder(orderId) {
  acabadosState.selectedOrderId = orderId ?? null;
  const order = getSelectedOrder();
  acabadosState.selectedProcessId = order?.procesos?.[0]?.id ?? null;
  acabadosState.detailOpen = !!order;
  acabadosState.actionNoteDraft = "";
}

export function selectProcess(orderId, processId) {
  acabadosState.selectedOrderId = orderId ?? null;
  acabadosState.selectedProcessId = processId ?? null;
  acabadosState.detailOpen = true;
  acabadosState.actionNoteDraft = "";
}

export function closeDetail() {
  acabadosState.detailOpen = false;
  acabadosState.actionNoteDraft = "";
}

export function setSelection({ orderId = null, processId = null, detailOpen = false } = {}) {
  acabadosState.selectedOrderId = orderId ?? null;
  acabadosState.selectedProcessId = processId ?? null;
  acabadosState.detailOpen = !!detailOpen;
}

export function setActionLoading(loading = false, actionType = "") {
  acabadosState.actionLoading = !!loading;
  acabadosState.actionType = loading ? String(actionType || "") : "";
}

export function setActionNoteDraft(value = "") {
  acabadosState.actionNoteDraft = String(value || "");
}

export function clearActionNoteDraft() {
  acabadosState.actionNoteDraft = "";
}

export function getSelectedOrder() {
  return (acabadosState.filteredOrders || []).find(
    (order) => Number(order.orden_id) === Number(acabadosState.selectedOrderId)
  ) || null;
}

export function getSelectedProcess() {
  const order = getSelectedOrder();
  if (!order) return null;
  return (order.procesos || []).find(
    (process) => Number(process.id) === Number(acabadosState.selectedProcessId)
  ) || null;
}
