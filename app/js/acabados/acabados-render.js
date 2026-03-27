import { escapeHtml, getClientBgColor, getClientColor } from "../utils/helpers.js";
import { fmtDateTimePE, fmtEntrega } from "../utils/formatters.js";
import { acabadosState, getSelectedOrder, getSelectedProcess } from "./acabados-state.js";

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

function formatObservacionOrden(order) {
  const observacionOrden = String(order?.observacion_orden || "").trim();
  if (observacionOrden) return observacionOrden;
  const observacionTecnica = String(order?.observacion_tecnica || "").trim();
  if (observacionTecnica) return observacionTecnica;
  return "-";
}

function hasProcessContext(process) {
  if (!process) return false;
  if (String(process?.assigned_user_nombre || "").trim() && String(process.assigned_user_nombre).trim() !== "-") return true;
  if (process?.started_at) return true;
  if (process?.finished_at) return true;
  if (String(process?.observaciones || "").trim()) return true;
  return false;
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
  const currentUserId = acabadosState.currentUser?.id || null;
  const isMineActive = process?.estado === "EN_PROCESO" && currentUserId && process?.assigned_user_id === currentUserId;
  const isActiveByOther = process?.estado === "EN_PROCESO" && process?.assigned_user_id && process?.assigned_user_id !== currentUserId;

  return {
    isMineActive,
    isActiveByOther,
    busy: !!acabadosState.actionLoading,
    busyAction: String(acabadosState.actionType || "").toUpperCase()
  };
}

function renderActionButtons(process) {
  const order = getSelectedOrder();
  const status = String(process?.estado || "").toUpperCase();
  const ctx = buildActionContext(process);

  if (!process && order?.requires_handoff) {
    const toCortador = String(order.handoff_target_module || "").toUpperCase() === "CORTADOR";
    const actionKey = toCortador ? "handoff-cortador" : "handoff-acabados";
    const actionText = toCortador ? "MANDAR A CORTE" : "MANDAR A ACABADOS";
    const loadingText = toCortador ? "ENVIANDO A CORTE..." : "ENVIANDO A ACABADOS...";
    return `
      <div class="detail-panel-callout">
        ${toCortador
          ? "Ya terminaste los procesos de ACABADOS previos. Esta orden debe pasar a CORTE para continuar su ruta."
          : "El siguiente paso de la ruta vuelve a ACABADOS. Envia la orden para que reaparezca en este panel."}
      </div>
      <div class="detail-actions">
        <button
          class="btn btn-transfer"
          type="button"
          data-acabados-action="${actionKey}"
          ${ctx.busy ? "disabled" : ""}
        >${ctx.busy ? loadingText : actionText}</button>
      </div>
    `;
  }

  if (!process) {
    return `
      <div class="detail-panel-callout">
        Selecciona un proceso para operar esta orden.
      </div>
      <div class="detail-actions">
        <button class="btn btn-primary" type="button" disabled>INICIAR</button>
      </div>
    `;
  }

  if (status === "PENDIENTE") {
    const disabled = ctx.busy;
    const text = ctx.busyAction === "INICIAR" ? "INICIANDO..." : "INICIAR";
    return `
      <div class="detail-actions">
        <button class="btn btn-primary" type="button" data-acabados-action="start" ${disabled ? "disabled" : ""}>${text}</button>
      </div>
    `;
  }

  if (status === "PAUSADO") {
    const disabled = ctx.busy;
    const text = ctx.busyAction === "RETOMAR" ? "RETOMANDO..." : "RETOMAR";
    return `
      <div class="detail-actions">
        <button class="btn btn-resume" type="button" data-acabados-action="resume" ${disabled ? "disabled" : ""}>${text}</button>
      </div>
    `;
  }

  if (status === "EN_PROCESO" && ctx.isActiveByOther) {
    return `
      <div class="detail-panel-callout">
        Este proceso esta en curso por otro operador.
      </div>
      <div class="detail-actions">
        <button class="btn btn-ghost" type="button" disabled>OCUPADO</button>
      </div>
    `;
  }

  if (status === "EN_PROCESO" && ctx.isMineActive) {
    return `
      <div class="detail-action-form">
        <label class="field-lb" for="detailActionNote">Observacion del proceso</label>
        <textarea
          id="detailActionNote"
          class="detail-textarea"
          placeholder="Opcional: deja una nota para la pausa o el cierre..."
        >${esc(acabadosState.actionNoteDraft || "")}</textarea>
      </div>
      <div class="detail-actions">
        <button class="btn btn-warn" type="button" data-acabados-action="pause" ${ctx.busy ? "disabled" : ""}>${ctx.busyAction === "PAUSAR" ? "PAUSANDO..." : "PAUSAR"}</button>
        <button class="btn btn-primary" type="button" data-acabados-action="finish" ${ctx.busy ? "disabled" : ""}>${ctx.busyAction === "FINALIZAR" ? "FINALIZANDO..." : "FINALIZAR"}</button>
      </div>
    `;
  }

  return `
    <div class="detail-actions">
      <button class="btn btn-ghost" type="button" disabled>PROCESO CERRADO</button>
    </div>
  `;
}

function renderMyProcesses() {
  const mount = document.getElementById("myProcesses");
  if (!mount) return;

  const rows = acabadosState.myProcesses || [];
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
  const isSelected = Number(order.orden_id) === Number(acabadosState.selectedOrderId);
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
          <span class="macro-pill">ACABADOS</span>
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
                  class="process-chip ${statusPillClass(process.estado)} ${Number(process.id) === Number(acabadosState.selectedProcessId) ? "is-current" : ""}"
                  data-order-id="${order.orden_id}"
                  data-process-id="${process.id}"
                >
                  <span class="process-label">${esc(formatProcesoLabel(process))}</span>
                  ${Number(process.id) === Number(acabadosState.selectedProcessId) ? '<span class="selected-badge">Seleccionado</span>' : ""}
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

  const rows = acabadosState.filteredOrders || [];

  if (!rows.length) {
    mount.innerHTML = '<div class="empty-board">No hay trabajos listos para ACABADOS con ese filtro.</div>';
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
  const isOpen = !!acabadosState.detailOpen && !!order;

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
  const showProcessContext = hasProcessContext(process);

  mount.innerHTML = `
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
        <span class="k">Proceso</span>
        <span class="v">${esc(processTitle)}</span>
      </div>
      <div class="detail-stat">
        <span class="k">Progreso</span>
        <span class="v">${progress.completados || 0}/${progress.total || 0}</span>
      </div>
      <div class="detail-stat">
        <span class="k">Entrega</span>
        <span class="v">${esc(fmtEntrega(order.fecha_entrega))}</span>
      </div>
      <div class="detail-stat detail-stat-split">
        <div>
          <span class="k">Cantidad</span>
          <span class="v">${esc(formatCantidad(order))}</span>
        </div>
        <div>
          <span class="k">Demasia</span>
          <span class="v">${esc(String(order.demasia ?? "-"))}</span>
        </div>
      </div>
      <div class="detail-stat">
        <span class="k">Prioridad</span>
        <span class="v">${esc(order.prioridad || "-")}</span>
      </div>
    </div>

    <div class="detail-order-note">
      <span class="k">Observacion de orden</span>
      <span class="v">${esc(orderObservation)}</span>
    </div>

    ${
      order?.requires_handoff
        ? `
          <div class="detail-note">
            <div><b>Siguiente paso de ruta:</b> ${esc(formatProcesoLabel({ proceso_codigo: order.next_process_codigo }))}</div>
            <div><b>Destino:</b> ${esc(String(order.handoff_target_module || "").toUpperCase() === "CORTADOR" ? "CORTADOR" : "ACABADOS")}</div>
          </div>
        `
        : ""
    }

    ${
      process && showProcessContext
        ? `
          <div class="detail-note">
            <div><b>Responsable actual:</b> ${esc(process.assigned_user_nombre || "-")}</div>
            <div><b>Inicio:</b> ${esc(fmtDateTimePE(process.started_at))}</div>
            <div><b>Fin:</b> ${esc(fmtDateTimePE(process.finished_at))}</div>
            <div><b>Observaciones:</b> ${esc(process.observaciones || "-")}</div>
          </div>
        `
        : !process
        ? `
          <div class="detail-note">
            Esta orden esta seleccionada, pero aun no elegiste un proceso.
          </div>
        `
        : ""
    }

    <div class="detail-processes">
      <h4>Procesos requeridos</h4>
      <div class="detail-process-list">
        ${
          order.hasSeed
            ? (order.procesos || []).map((item) => `
                <button
                  type="button"
                  class="detail-process-item ${statusPillClass(item.estado)} ${Number(item.id) === Number(acabadosState.selectedProcessId) ? "is-current" : ""}"
                  data-order-id="${order.orden_id}"
                  data-process-id="${item.id}"
                >
                  <span>${esc(formatProcesoLabel(item))}</span>
                  ${Number(item.id) === Number(acabadosState.selectedProcessId) ? '<span class="selected-badge">Seleccionado</span>' : ""}
                  <small>${esc(item.estado)}</small>
                </button>
              `).join("")
            : '<div class="seed-warning">No hay procesos sembrados para esta orden.</div>'
        }
      </div>
    </div>

    ${renderActionButtons(process)}
  `;
}

export function renderAcabadosApp() {
  renderMyProcesses();
  renderBoard();
  renderDetail();
}

