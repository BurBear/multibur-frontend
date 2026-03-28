import { debounce } from "../ui.js";
import {
  closeDetail,
  selectOrder,
  selectProcess,
  setActionNoteDraft,
  setQuery
} from "./cortador-state.js";

export function bindCortadorEvents({ onStateChange, onAction, onLogout }) {
  const q = document.getElementById("qCortador");
  const board = document.getElementById("boardOrders");
  const mine = document.getElementById("myProcesses");
  const detail = document.getElementById("detailPane");
  const detailClose = document.getElementById("btnCloseCortadorDetail");
  const btnLogout = document.getElementById("btnLogout");

  q?.addEventListener("input", debounce((event) => {
    setQuery(event.target.value || "");
    onStateChange?.();
  }, 180));

  const selectFromTarget = (target) => {
    const processButton = target.closest("[data-process-id]");
    if (processButton) {
      const orderId = Number(processButton.getAttribute("data-order-id"));
      const processId = Number(processButton.getAttribute("data-process-id"));
      selectProcess(orderId, processId);
      onStateChange?.();
      return true;
    }

    const orderButton = target.closest("[data-order-id]");
    if (orderButton) {
      const orderId = Number(orderButton.getAttribute("data-order-id"));
      selectOrder(orderId);
      onStateChange?.();
      return true;
    }

    return false;
  };

  board?.addEventListener("click", (event) => {
    selectFromTarget(event.target);
  });

  mine?.addEventListener("click", (event) => {
    selectFromTarget(event.target);
  });

  detail?.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-cortador-action]");
    if (actionButton) {
      const action = actionButton.getAttribute("data-cortador-action");
      onAction?.(action);
      return;
    }

    selectFromTarget(event.target);
  });

  detail?.addEventListener("input", (event) => {
    if (event.target?.id !== "detailActionNote") return;
    setActionNoteDraft(event.target.value || "");
  });

  detailClose?.addEventListener("click", () => {
    closeDetail();
    onStateChange?.();
  });

  btnLogout?.addEventListener("click", () => onLogout?.());
}

