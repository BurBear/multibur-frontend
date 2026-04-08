export function bindAdminEvents(deps) {
  const {
    $, logout, msgJobs, loadJobs, loadRegistros, debounce,
    syncClienteSelectedText, syncOcFields, refreshFormState, syncMaterialSelectedText,
    syncExternalFlowUI, setOrdenModalMode, clearOrdenForm, onGuardarOrden,
    closeDetalleOrden, getDetailRowCtx, getDetailExtraCtx, printOrden,
    closeEntregaModal, confirmEntregaDesdeModal, syncEntregaGuiaFields,
    syncRouteDraftFromForm, openRouteModal, closeRouteModal, moveRouteItem, buildDefaultRouteDraft,
    toggleRouteProcess, setRouteProcessVariant,
    syncRegsPresetChips,
    setLivePanelMode,
    togglePinnedPendingOrder,
    openPendingEntregaModal,
    openPendingPanelDetail
  } = deps;
  const closeOrdenModal = () => {
    setOrdenModalMode("create");
    closeRouteModal?.();
    $("modalOrdenWrap")?.classList.add("hide");
  };

  $("btnLogout")?.addEventListener("click", async () => { await logout(); window.location.href = "./login.html"; });
  $("btnReloadJobs")?.addEventListener("click", loadJobs);
  $("btnPrintPendientes")?.addEventListener("click", () => window.print());
  $("btnReloadRegs")?.addEventListener("click", loadRegistros);
  $("btnRegsViewLive")?.addEventListener("click", () => setLivePanelMode?.("produccion"));
  $("btnRegsViewPending")?.addEventListener("click", () => setLivePanelMode?.("pendientes"));
  $("btnApplyRegs")?.addEventListener("click", loadRegistros);
  $("q")?.addEventListener("input", debounce(loadJobs, 250));
  $("fTipoCliente")?.addEventListener("change", loadJobs);
  $("fEstado")?.addEventListener("change", loadJobs);
  $("o_cliente")?.addEventListener("change", syncClienteSelectedText);
  $("o_tiene_oc")?.addEventListener("change", () => { syncOcFields(); refreshFormState(); });
  $("o_oc_numero")?.addEventListener("input", refreshFormState);
  $("d_material")?.addEventListener("change", syncMaterialSelectedText);
  $("o_externo")?.addEventListener("change", syncExternalFlowUI);
  $("routePickerTrigger")?.addEventListener("click", openRouteModal);
  $("btnCloseRoute")?.addEventListener("click", closeRouteModal);
  $("btnRouteSave")?.addEventListener("click", closeRouteModal);
  $("btnRouteReset")?.addEventListener("click", buildDefaultRouteDraft);
  $("routeWrap")?.addEventListener("click", (ev) => {
    if (ev.target && ev.target.id === "routeWrap") closeRouteModal?.();
  });
  $("routeList")?.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("[data-route-move]");
    if (!btn) return;
    moveRouteItem?.(btn.getAttribute("data-route-index"), btn.getAttribute("data-route-move"));
  });
  $("routeProcessPicker")?.addEventListener("change", (ev) => {
    const pick = ev.target?.closest?.("[data-route-pick]");
    if (pick) {
      toggleRouteProcess?.(pick.getAttribute("data-route-pick"));
      return;
    }
    const variantSelect = ev.target?.closest?.("[data-route-variant]");
    if (variantSelect) {
      setRouteProcessVariant?.(variantSelect.getAttribute("data-route-variant"), variantSelect.value || "");
    }
  });

  $("btnOpenOrden")?.addEventListener("click", () => {
    setOrdenModalMode("create");
    clearOrdenForm();
    $("modalOrdenWrap")?.classList.remove("hide");
    refreshFormState();
  });
  $("btnCloseOrden")?.addEventListener("click", closeOrdenModal);
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (!$("routeWrap")?.classList.contains("hide")) {
      closeRouteModal?.();
      return;
    }
    if ($("modalOrdenWrap")?.classList.contains("hide")) return;
    closeOrdenModal();
  });
  $("btnGuardarOrden")?.addEventListener("click", onGuardarOrden);

  $("btnCloseDetail")?.addEventListener("click", closeDetalleOrden);
  $("btnPrintDetail")?.addEventListener("click", () => {
    if (getDetailRowCtx()) printOrden(getDetailRowCtx(), getDetailExtraCtx());
  });
  $("jobDetailWrap")?.addEventListener("click", (ev) => {
    if (ev.target && ev.target.id === "jobDetailWrap") closeDetalleOrden();
  });
  $("btnCloseEntrega")?.addEventListener("click", closeEntregaModal);
  $("btnConfirmEntrega")?.addEventListener("click", confirmEntregaDesdeModal);
  $("e_tiene_guia")?.addEventListener("change", syncEntregaGuiaFields);
  $("entregaWrap")?.addEventListener("click", (ev) => {
    if (ev.target && ev.target.id === "entregaWrap") closeEntregaModal();
  });
  $("regsPendingList")?.addEventListener("click", async (ev) => {
    const btn = ev.target?.closest?.("[data-pending-action]");
    if (!btn) return;
    const action = String(btn.getAttribute("data-pending-action") || "").trim().toLowerCase();
    const oid = Number(btn.getAttribute("data-oid"));
    if (!oid) return;
    if (action === "pin") {
      await togglePinnedPendingOrder?.(oid);
      return;
    }
    if (action === "detail") {
      await openPendingPanelDetail?.(oid);
      return;
    }
    if (action === "deliver") {
      await openPendingEntregaModal?.(oid);
    }
  });

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
    syncRegsPresetChips($("rgPreset")?.value || "today");
  });
  $("rgPreset")?.dispatchEvent(new Event("change"));

  ["o_desc", "o_entrega", "d_cant", "d_maq", "d_tipoimp", "d_color_mode", "d_color_text", "d_formato"].forEach((id) => {
    $(id)?.addEventListener("input", refreshFormState);
    $(id)?.addEventListener("change", refreshFormState);
  });
  ["d_ancho", "d_alto"].forEach((id) => {
    $(id)?.addEventListener("input", refreshFormState);
    $(id)?.addEventListener("change", refreshFormState);
  });
  $("btnClearRepFilters")?.addEventListener("click", () => {
    if ($("repCliente")) $("repCliente").value = "";
    if ($("repDesde")) $("repDesde").value = "";
    if ($("repHasta")) $("repHasta").value = "";
    msgJobs("Filtros de reporte limpiados.");
  });
}
