let operatorRealtimeBound = false;
let trabajoReloadTimer = null;
let hoyReloadTimer = null;
let operadorOrdenesChannel = null;
let operadorRegistroChannel = null;

function cleanupOperadorRealtimeChannels(supabase) {
  if (!supabase) return;
  if (operadorOrdenesChannel) {
    supabase.removeChannel(operadorOrdenesChannel);
    operadorOrdenesChannel = null;
  }
  if (operadorRegistroChannel) {
    supabase.removeChannel(operadorRegistroChannel);
    operadorRegistroChannel = null;
  }
}

export function unbindOperadorRealtime(supabase) {
  clearTimeout(trabajoReloadTimer);
  clearTimeout(hoyReloadTimer);
  trabajoReloadTimer = null;
  hoyReloadTimer = null;
  cleanupOperadorRealtimeChannels(supabase);
  operatorRealtimeBound = false;
}

export function bindOperadorRealtime({
  supabase,
  getCurrentUser,
  getLastAlertedOrderIds,
  showToast,
  playAlertBeep,
  loadTrabajos,
  loadHoy,
  resumeIfActive
}) {
  if (operatorRealtimeBound) {
    unbindOperadorRealtime(supabase);
  }
  operatorRealtimeBound = true;

  function scheduleLoadTrabajos(delay = 350) {
    clearTimeout(trabajoReloadTimer);
    trabajoReloadTimer = setTimeout(() => {
      loadTrabajos({ force: true, reason: "realtime" }).catch((e) => console.error("REALTIME_LOADTRABAJOS_ERROR", e));
    }, delay);
  }

  function scheduleLoadHoy(delay = 350) {
    clearTimeout(hoyReloadTimer);
    hoyReloadTimer = setTimeout(() => {
      loadHoy().catch((e) => console.error("REALTIME_LOADHOY_ERROR", e));
    }, delay);
  }

  operadorOrdenesChannel = supabase.channel("operador-ordenes-watch")
    .on("postgres_changes", { event: "*", schema: "public", table: "ordenes" }, (payload) => {
      const next = payload?.new || null;
      const prev = payload?.old || null;
      const nextEstado = String(next?.estado || "").toUpperCase();
      const prevEstado = String(prev?.estado || "").toUpperCase();
      const entersPlacas =
        (payload.eventType === "INSERT" && nextEstado === "PLACAS") ||
        (payload.eventType === "UPDATE" && nextEstado === "PLACAS" && prevEstado !== "PLACAS");

      if (entersPlacas && next?.id) {
        const alerted = getLastAlertedOrderIds();
        if (!alerted.has(next.id)) {
          alerted.add(next.id);
          const orden = next.numero_orden_fisica || `#${next.id}`;
          const trabajo = next.descripcion_trabajo || "Trabajo nuevo";
          showToast(`Nueva orden lista para imprimir: ${orden} - ${trabajo}`, "success");
          playAlertBeep();
        }
      }
      scheduleLoadTrabajos();
    })
    .subscribe();

  operadorRegistroChannel = supabase.channel("operador-registro-watch")
    .on("postgres_changes", { event: "*", schema: "public", table: "registro_produccion" }, (payload) => {
      const row = payload?.new || payload?.old;
      const currentUser = getCurrentUser();
      if (row?.user_id && currentUser?.id && row.user_id !== currentUser.id) return;
      scheduleLoadHoy();
      resumeIfActive().catch((e) => console.error("REALTIME_RESUME_ERROR", e));
    })
    .subscribe();
}
