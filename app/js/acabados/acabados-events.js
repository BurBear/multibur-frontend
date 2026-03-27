import { debounce } from "../ui.js";
import {
  closeDetail,
  selectOrder,
  selectProcess,
  setActionNoteDraft,
  setQuery
} from "./acabados-state.js";

export function bindAcabadosEvents({ onStateChange, onAction, onLogout }) {
  const q = document.getElementById("qAcabados");
  const board = document.getElementById("boardOrders");
  const mine = document.getElementById("myProcesses");
  const detail = document.getElementById("detailPane");
  const detailModal = document.getElementById("detailModal");
  const detailClose = document.getElementById("btnCloseAcabadosDetail");
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
    const actionButton = event.target.closest("[data-acabados-action]");
    if (actionButton) {
      const action = actionButton.getAttribute("data-acabados-action");
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

  detailModal?.addEventListener("click", (event) => {
    if (event.target === detailModal) {
      closeDetail();
      onStateChange?.();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeDetail();
    onStateChange?.();
  });

  btnLogout?.addEventListener("click", () => onLogout?.());
}
