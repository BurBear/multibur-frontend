import { escapeHtml, getClientBgColor, getClientColor } from "../utils/helpers.js";
import { fmtDateTimePE, fmtEntrega } from "../utils/formatters.js";
import { cortadorState, getSelectedOrder, getSelectedProcess } from "./cortador-state.js";

const PROCESS_LABELS = Object.freeze({
  CORTE: "Corte",
  EMPAQUETADO: "Empaquetado",
  DOBLEZ: "Doblez",
  COMPAGINADO: "Compaginado",
  TROQUELADO: "Troquelado",
  SECTORIZADO: "Sectorizado",
  BARNIZ: "Barniz",
  PLASTIFICADO: "Plastificado",
  ENCOLADO: "Encolado",
  MARCADO: "Marcado",
  ANILLADO: "Anillado",
  PERFORADO: "Perforado",
  PEGADO_SOLAPA: "Pegado solapa",
  SEMI_CORTE: "Semi corte",
  ENUMERADO: "Enumerado"
});

const ROUTE_KEY_BY_PROCESS_CODE = Object.freeze({
  CORTE: "corte",
  EMPAQUETADO: "empaquetado",
  DOBLEZ: "doblez",
  COMPAGINADO: "compaginado",
  TROQUELADO: "troquelado",
  SECTORIZADO: "sectorizado",
  BARNIZ: "barniz",
  PLASTIFICADO: "plastificado",
  ENCOLADO: "encolado",
  MARCADO: "marcado",
  ANILLADO: "anillado",
  PERFORADO: "perforado",
  PEGADO_SOLAPA: "pegado_solapa",
  SEMI_CORTE: "semi_corte",
  ENUMERADO: "enumerado"
});

function esc(value) {
  return escapeHtml(value);
}

function formatProcesoLabel(process) {
  const code = String(process?.proceso_codigo || "").trim().toUpperCase();
  const base = PROCESS_LABELS[code] || code || "-";
  const mode = String(process?.configuracion?.modo || "").trim();
  const perforadoTipo = String(process?.configuracion?.tipo || "").trim().toUpperCase();
  if (code === "PLASTIFICADO" && mode) return `${base} (${mode})`;
  if (code === "PERFORADO" && perforadoTipo === "PICADO_PERFORADO") return `${base} (Picado/Perforado)`;
  return base;
}

function formatCantidad(order) {
  return order?.cantidad_solicitada != null ? String(order.cantidad_solicitada) : "-";
}

function formatProductionQty(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? String(amount) : "0";
}

function formatObservacionOrden(order) {
  const observacionOrden = String(order?.observacion_orden || "").trim();
  if (observacionOrden) return observacionOrden;
  return "-";
}

function renderImpresionDetalle(order) {
  const detail = Array.isArray(order?.impresion_totales_detalle)
    ? order.impresion_totales_detalle
    : [];
  if (!detail.length) return "";

  const plates = detail.flatMap((item) => {
    if (!item || typeof item !== "object") return [];

    if (Array.isArray(item.placas)) {
      return item.placas
        .map((plate) => ({
          nombre: String(plate?.nombre || "").trim(),
          buena: plate?.buena,
          mala: plate?.mala
        }))
        .filter((plate) => plate.nombre);
    }

    if (item.nombre) {
      return [{
        nombre: String(item.nombre || "").trim(),
        buena: item?.buena,
        mala: item?.mala
      }].filter((plate) => plate.nombre);
    }

    return [
      item?.nombre_tira
        ? { nombre: String(item.nombre_tira || "").trim(), buena: item?.buena_tira, mala: item?.mala_tira }
        : null,
      item?.nombre_retira
        ? { nombre: String(item.nombre_retira || "").trim(), buena: item?.buena_retira, mala: item?.mala_retira }
        : null
    ].filter((plate) => plate?.nombre);
  });

  if (!plates.length) return "";

  return `
    <details class="detail-print-breakdown">
      <summary class="detail-print-breakdown-summary">
        <span class="detail-print-breakdown-summary-copy">
          <span class="k">Detalle impresion T+R</span>
          <strong>Desplegar cantidades por placa</strong>
        </span>
        <span class="detail-print-breakdown-toggle" aria-hidden="true">⌄</span>
      </summary>
      <div class="detail-print-breakdown-list">
        ${plates.map((plate) => `
          <div class="detail-print-breakdown-side">
            <span class="detail-print-breakdown-side-name">${esc(plate.nombre || "-")}</span>
            <div class="detail-print-breakdown-side-qty">
              <div>
                <span>Buena</span>
                <strong>${esc(formatProductionQty(plate.buena))}</strong>
              </div>
              <div>
                <span>Mala</span>
                <strong>${esc(formatProductionQty(plate.mala))}</strong>
              </div>
            </div>
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

function processCodeToRouteKey(code) {
  return ROUTE_KEY_BY_PROCESS_CODE[String(code || "").trim().toUpperCase()] || "";
}

function routeEntryMatchesProcess(order, entry, process) {
  if (!entry || !process) return false;
  const routeKey = String(entry.key || "").trim();
  const processKey = processCodeToRouteKey(process.proceso_codigo);
  if (!routeKey || routeKey !== processKey) return false;

  if (routeKey === "plastificado") {
    const routeVariant = String(entry?.variant || order?.plastificado || "").trim().toUpperCase();
    const processVariant = String(process?.configuracion?.modo || order?.plastificado || "").trim().toUpperCase();
    return !routeVariant || !processVariant || routeVariant === processVariant;
  }

  if (routeKey === "perforado") {
    const routeVariant = String(entry?.variant || order?.perforado_tipo || "").trim().toUpperCase();
    const processVariant = String(process?.configuracion?.tipo || order?.perforado_tipo || "").trim().toUpperCase();
    return !routeVariant || !processVariant || routeVariant === processVariant;
  }

  return true;
}

function getRouteEntryLabel(order, entry) {
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
      const mode = String(entry?.variant || order?.plastificado || "").trim().toUpperCase();
      return mode ? `Plastificado (${mode})` : "Plastificado";
    }
    case "encolado": return "Encolado";
    case "marcado": return "Marcado";
    case "anillado": return "Anillado";
    case "perforado": {
      const tipo = String(entry?.variant || order?.perforado_tipo || "").trim().toUpperCase();
      return tipo === "PICADO_PERFORADO" ? "Perforado (Picado/Perforado)" : "Perforado";
    }
    case "pegado_solapa": return "Pegado solapa";
    case "semi_corte": return "Semi corte";
    case "enumerado": return "Enumerado";
    default: return "-";
  }
}

function buildRouteDisplayItems(order, selectedProcessId) {
  const allProcesses = Array.isArray(order?.procesos_ruta) && order.procesos_ruta.length
    ? order.procesos_ruta
    : (order?.procesos || []);
  const visibleIds = new Set((order?.procesos || []).map((item) => Number(item.id)));
  const route = Array.isArray(order?.ruta_procesos) && order.ruta_procesos.length
    ? [...order.ruta_procesos].sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0))
    : [];

  if (!route.length) {
    return [...allProcesses]
      .sort((a, b) => Number(a?.secuencia || 0) - Number(b?.secuencia || 0) || Number(a?.id) - Number(b?.id))
      .map((process, index) => ({
        step: index + 1,
        label: formatProcesoLabel(process),
        status: String(process?.estado || "PENDIENTE"),
        isCurrent: Number(process?.id) === Number(selectedProcessId),
        clickable: visibleIds.has(Number(process?.id)),
        processId: Number(process?.id),
        orderId: Number(order?.orden_id)
      }));
  }

  const usedProcessIds = new Set();

  return route.map((entry, index) => {
    const process = allProcesses.find((candidate) => {
      const candidateId = Number(candidate?.id);
      if (usedProcessIds.has(candidateId)) return false;
      return routeEntryMatchesProcess(order, entry, candidate);
    }) || null;
    if (process?.id != null) usedProcessIds.add(Number(process.id));
    return {
      step: Number(entry?.order || index + 1),
      label: process ? formatProcesoLabel(process) : getRouteEntryLabel(order, entry),
      status: String(process?.estado || "PENDIENTE"),
      isCurrent: process ? Number(process.id) === Number(selectedProcessId) : false,
      clickable: process ? visibleIds.has(Number(process.id)) : false,
      processId: process ? Number(process.id) : null,
      orderId: Number(order?.orden_id)
    };
  });
}

function statusPillClass(status) {
  switch (String(status || "").toUpperCase()) {
    case "EN_PROCESO":
      return "is-active";
    case "PAUSADO":
      return "is-paused";
    case "FINALIZADO":
      return "is-done";
    case "CANCELADO":
      return "is-cancelled";
    default:
      return "is-pending";
  }
}

function buildActionContext(process) {
  const currentUserId = cortadorState.currentUser?.id || null;
  const isMineActive = process?.estado === "EN_PROCESO" && currentUserId && process?.assigned_user_id === currentUserId;
  const isActiveByOther = process?.estado === "EN_PROCESO" && process?.assigned_user_id && process?.assigned_user_id !== currentUserId;

  return {
    isMineActive,
    isActiveByOther,
    busy: !!cortadorState.actionLoading,
    busyAction: String(cortadorState.actionType || "").toUpperCase()
  };
}

function renderActionButtons(process) {
  const order = getSelectedOrder();
  const status = String(process?.estado || "").toUpperCase();
  const ctx = buildActionContext(process);

  if (!process && order?.requires_handoff) {
    const toCortador = String(order.handoff_target_module || "").toUpperCase() === "CORTADOR";
    const actionKey = toCortador ? "handoff-cortador" : "handoff-acabados";
    const actionText = toCortador ? "Mandar a corte" : "Mandar a acabados";
    const loadingText = toCortador ? "Enviando a corte..." : "Enviando a acabados...";
    return `
      <div class="detail-panel-callout">
        ${toCortador
          ? "Ya terminaste los procesos previos. Esta orden debe pasar a CORTE para continuar su ruta."
          : "El siguiente paso de la ruta vuelve a ACABADOS. Envia la orden para que reaparezca en ese panel."}
      </div>
      <div class="detail-actions">
        <button
          class="btn btn-transfer detail-btn"
          type="button"
          data-cortador-action="${actionKey}"
          ${ctx.busy ? "disabled" : ""}
        ><span class="detail-action-icon" aria-hidden="true">↗</span><span>${ctx.busy ? loadingText : actionText}</span></button>
      </div>
    `;
  }

  if (!process) {
    return `
      <div class="detail-panel-callout">
        Selecciona un proceso para operar esta orden.
      </div>
      <div class="detail-actions">
        <button class="btn btn-primary detail-btn" type="button" disabled><span class="detail-action-icon" aria-hidden="true">▶</span><span>Iniciar</span></button>
      </div>
    `;
  }

  if (status === "PENDIENTE") {
    const disabled = ctx.busy;
    const text = ctx.busyAction === "INICIAR" ? "Iniciando..." : "Iniciar";
    return `
      <div class="detail-actions">
        <button class="btn btn-primary detail-btn" type="button" data-cortador-action="start" ${disabled ? "disabled" : ""}><span class="detail-action-icon" aria-hidden="true">▶</span><span>${text}</span></button>
      </div>
    `;
  }

  if (status === "PAUSADO") {
    const disabled = ctx.busy;
    const text = ctx.busyAction === "RETOMAR" ? "Retomando..." : "Retomar";
    return `
      <div class="detail-actions">
        <button class="btn btn-resume detail-btn" type="button" data-cortador-action="resume" ${disabled ? "disabled" : ""}><span class="detail-action-icon" aria-hidden="true">↻</span><span>${text}</span></button>
      </div>
    `;
  }

  if (status === "EN_PROCESO" && ctx.isActiveByOther) {
    return `
      <div class="detail-panel-callout">
        Este proceso esta en curso por otro operador.
      </div>
      <div class="detail-actions">
        <button class="btn btn-ghost detail-btn" type="button" disabled><span class="detail-action-icon" aria-hidden="true">•</span><span>Ocupado</span></button>
      </div>
    `;
  }

  if (status === "EN_PROCESO" && ctx.isMineActive) {
    return `
      <div class="detail-actions">
        <button class="btn btn-warn detail-btn" type="button" data-cortador-action="pause" ${ctx.busy ? "disabled" : ""}><span class="detail-action-icon" aria-hidden="true">❚❚</span><span>${ctx.busyAction === "PAUSAR" ? "Pausando..." : "Pausar"}</span></button>
        <button class="btn btn-primary detail-btn detail-btn-finish" type="button" data-cortador-action="finish" ${ctx.busy ? "disabled" : ""}><span class="detail-action-icon" aria-hidden="true">✓</span><span>${ctx.busyAction === "FINALIZAR" ? "Finalizando..." : "Finalizar"}</span></button>
      </div>
    `;
  }

  return `
    <div class="detail-actions">
      <button class="btn btn-ghost detail-btn" type="button" disabled><span class="detail-action-icon" aria-hidden="true">✓</span><span>Proceso cerrado</span></button>
    </div>
  `;
}

function renderMyProcesses() {
  const mount = document.getElementById("myProcesses");
  if (!mount) return;

  const rows = cortadorState.myProcesses || [];
  if (!rows.length) {
    mount.innerHTML = '<div class="empty-inline">No tienes trabajos en curso por ahora.</div>';
    return;
  }

  mount.innerHTML = rows.map((process) => `
    <button
      type="button"
      class="mini-process-card ${statusPillClass(process.estado)}"
      data-order-id="${process.orden_id}"
      data-process-id="${process.id}"
    >
      <div class="mini-process-head">
        <strong>${esc(process.numero_orden_fisica || `#${process.orden_id}`)}</strong>
        <span class="status-pill ${statusPillClass(process.estado)}">${esc(process.estado)}</span>
      </div>
      <div class="mini-process-title">${esc(formatProcesoLabel(process))}</div>
      <div class="mini-process-meta">${esc(process.cliente_nombre || "-")} | ${esc(process.descripcion_trabajo || "-")}</div>
    </button>
  `).join("");
}

function renderOrderCard(order) {
  const clientColor = getClientColor(order.cliente_nombre);
  const clientBg = getClientBgColor(order.cliente_nombre);
  const isSelected = Number(order.orden_id) === Number(cortadorState.selectedOrderId);
  const progress = order.progreso || {};
  const orderButtonLabel = order.numero_orden_fisica || `#${order.orden_id}`;
  const orderObservation = formatObservacionOrden(order);

  return `
    <article
      class="order-card ${isSelected ? "is-selected" : ""}"
      data-order-id="${order.orden_id}"
      style="--client-color:${clientColor};--client-bg:${clientBg}"
    >
      <div class="order-head">
        <button class="order-anchor" type="button" data-order-id="${order.orden_id}">
          ${esc(orderButtonLabel)}
        </button>
        <div class="order-head-right">
          <span class="macro-pill">CORTADOR</span>
          <span class="progress-pill">${progress.completados || 0}/${progress.total || 0}</span>
        </div>
      </div>

      <div class="order-meta">
        <div><span class="k">Cliente</span><span class="v">${esc(order.cliente_nombre || "-")}</span></div>
        <div><span class="k">Trabajo</span><span class="v">${esc(order.descripcion_trabajo || "-")}</span></div>
        <div><span class="k">Entrega</span><span class="v">${esc(fmtEntrega(order.fecha_entrega))}</span></div>
        <div><span class="k">Cantidad</span><span class="v">${esc(formatCantidad(order))}</span></div>
      </div>

      <div class="order-highlight">
        <span class="k">Observacion</span>
        <span class="v">${esc(orderObservation)}</span>
      </div>

      <div class="order-progress">
        <div class="progress-track">
          <span class="progress-fill" style="width:${progress.porcentaje || 0}%"></span>
        </div>
        <div class="progress-text">
          Pendientes: ${progress.pendientes || 0} | En proceso: ${progress.enProceso || 0} | Pausados: ${progress.pausados || 0}
        </div>
      </div>

      ${
        order.hasSeed
          ? `
            <div class="process-list">
              ${(order.procesos || []).map((process) => `
                <button
                  type="button"
                  class="process-chip ${statusPillClass(process.estado)} ${Number(process.id) === Number(cortadorState.selectedProcessId) ? "is-current" : ""}"
                  data-order-id="${order.orden_id}"
                  data-process-id="${process.id}"
                >
                  <span class="process-label">${esc(formatProcesoLabel(process))}</span>
                  ${Number(process.id) === Number(cortadorState.selectedProcessId) ? '<span class="selected-badge">Seleccionado</span>' : ""}
                  <span class="process-status">${esc(process.estado)}</span>
                  <span class="process-owner">${esc(process.assigned_user_nombre || "-")}</span>
                </button>
              `).join("")}
            </div>
          `
          : order.requires_handoff
          ? `
            <div class="seed-warning">
              ${String(order.handoff_target_module || "").toUpperCase() === "CORTADOR"
                ? "Ruta lista para mandar a corte."
                : "Ruta lista para mandar a acabados."}
            </div>
          `
          : `
            <div class="seed-warning">
              Esta orden aun no tiene procesos sembrados.
            </div>
          `
      }
    </article>
  `;
}

function renderBoard() {
  const mount = document.getElementById("boardOrders");
  if (!mount) return;

  const rows = cortadorState.filteredOrders || [];

  if (!rows.length) {
    mount.innerHTML = '<div class="empty-board">No hay trabajos listos para CORTADOR con ese filtro.</div>';
    return;
  }

  mount.innerHTML = rows.map(renderOrderCard).join("");
}

function renderDetail() {
  const mount = document.getElementById("detailPane");
  const modal = document.getElementById("detailModal");
  if (!mount) return;

  const order = getSelectedOrder();
  const process = getSelectedProcess();
  const isOpen = !!cortadorState.detailOpen && !!order;

  if (modal) {
    modal.hidden = !isOpen;
    modal.classList.toggle("is-open", isOpen);
  }
  document.body.classList.toggle("is-modal-open", isOpen);

  if (!order || !isOpen) {
    mount.innerHTML = "";
    return;
  }

  const processTitle = process ? formatProcesoLabel(process) : "Sin proceso seleccionado";
  const processStatus = process?.estado || "-";
  const progress = order.progreso || {};
  const orderObservation = formatObservacionOrden(order);
  const routeItems = buildRouteDisplayItems(order, cortadorState.selectedProcessId);
  mount.innerHTML = `
    <div class="detail-layout">
      <section class="detail-panel detail-panel-data">
        <div class="detail-block">
          <div class="detail-topline">
            <span class="detail-order">${esc(order.numero_orden_fisica || `#${order.orden_id}`)}</span>
            <span class="status-pill ${statusPillClass(processStatus)}">${esc(processStatus)}</span>
          </div>
          <h3 class="detail-title">${esc(order.descripcion_trabajo || "-")}</h3>
          <div class="detail-client">${esc(order.cliente_nombre || "-")}</div>
        </div>

        <div class="detail-grid">
          <div class="detail-stat">
            <span class="k">Entrega</span>
            <span class="v">${esc(fmtEntrega(order.fecha_entrega))}</span>
          </div>
          <div class="detail-stat">
            <span class="k">Progreso</span>
            <span class="v">${progress.completados || 0}/${progress.total || 0}</span>
          </div>
          <div class="detail-stat">
            <span class="k">Cantidad solicitada</span>
            <span class="v">${esc(formatCantidad(order))}</span>
          </div>
          <div class="detail-stat detail-stat-split">
            <div>
              <span class="k">Cantidad buena</span>
              <span class="v">${esc(formatProductionQty(order.cantidad_buena_total))}</span>
            </div>
            <div>
              <span class="k">Cantidad mala</span>
              <span class="v">${esc(formatProductionQty(order.cantidad_mala_total))}</span>
            </div>
          </div>
          <div class="detail-stat detail-stat-split">
            <div>
              <span class="k">Material</span>
              <span class="v">${esc(order.papel_material || "-")}</span>
            </div>
            <div>
              <span class="k">Gramaje</span>
              <span class="v">${esc(order.gramaje != null && order.gramaje !== "" ? `${order.gramaje}g` : "-")}</span>
            </div>
          </div>
          <div class="detail-stat">
            <span class="k">Prioridad</span>
            <span class="v">${esc(order.prioridad || "-")}</span>
          </div>
        </div>

        ${renderImpresionDetalle(order)}

        <div class="detail-order-note">
          <span class="k">Observacion de orden</span>
          <span class="v">${esc(orderObservation)}</span>
        </div>
      </section>

      <aside class="detail-panel detail-panel-actions">
        <div class="detail-processes detail-processes-side">
          <h4>Ruta de procesos</h4>
          <div class="detail-route-list">
            ${
              routeItems.length
                ? routeItems.map((item) => `
                    <${item.clickable ? "button" : "div"}
                      ${item.clickable ? 'type="button"' : ""}
                      class="detail-route-step ${statusPillClass(item.status)} ${item.isCurrent ? "is-current" : ""} ${item.clickable ? "" : "is-static"}"
                      ${item.clickable ? `data-order-id="${item.orderId}" data-process-id="${item.processId}"` : ""}
                    >
                      <span class="detail-route-index">${item.step}</span>
                      <span class="detail-route-body">
                        <span class="detail-route-label">${esc(item.label)}</span>
                        <small>${esc(item.status)}</small>
                      </span>
                      ${item.isCurrent ? '<span class="detail-route-current">Actual</span>' : ""}
                    </${item.clickable ? "button" : "div"}>
                  `).join("")
                : '<div class="seed-warning">No hay procesos sembrados para esta orden.</div>'
            }
          </div>
        </div>

        ${renderActionButtons(process)}
      </aside>
    </div>
  `;
}

export function renderCortadorApp() {
  renderMyProcesses();
  renderBoard();
  renderDetail();
}

