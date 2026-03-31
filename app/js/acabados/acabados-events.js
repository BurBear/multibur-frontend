import { debounce } from "../ui.js";
import {
  closeDetail,
  selectOrder,
  selectProcess,
  setQuery
} from "./acabados-state.js";

export function bindAcabadosEvents({ onStateChange, onAction, onLogout }) {
  const q = document.getElementById("qAcabados");
  const board = document.getElementById("boardOrders");
  const mine = document.getElementById("myProcesses");
  const detail = document.getElementById("detailPane");
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

  detailClose?.addEventListener("click", () => {
    closeDetail();
    onStateChange?.();
  });

  btnLogout?.addEventListener("click", () => onLogout?.());
}
