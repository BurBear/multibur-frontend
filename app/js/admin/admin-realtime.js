let adminRealtimeBound = false;
let jobsReloadTimer = null;
let regsReloadTimer = null;

export function bindAdminRealtime({
  supabase,
  fetchOrdenResumenByIds,
  fetchProfilesByIds,
  getProfileDisplayName,
  showToast,
  loadJobs,
  loadRegistros
}) {
  if (adminRealtimeBound) return;
  adminRealtimeBound = true;

  function scheduleLoadJobs(delay = 400) {
    clearTimeout(jobsReloadTimer);
    jobsReloadTimer = setTimeout(() => {
      loadJobs().catch((e) => console.error("REALTIME_LOADJOBS_ERROR", e));
    }, delay);
  }

  function scheduleLoadRegistros(delay = 400) {
    clearTimeout(regsReloadTimer);
    regsReloadTimer = setTimeout(() => {
      loadRegistros().catch((e) => console.error("REALTIME_LOADREGS_ERROR", e));
    }, delay);
  }

  async function notifyRegistroRealtime(payload) {
    const row = payload?.new || payload?.old;
    if (!row?.orden_id) return;
    const [orders, users] = await Promise.all([
      fetchOrdenResumenByIds([row.orden_id]).catch(() => []),
      row.user_id ? fetchProfilesByIds([row.user_id]).catch(() => []) : Promise.resolve([])
    ]);
    const orden = orders?.[0]?.numero_orden_fisica || `#${row.orden_id}`;
    const operador = users?.[0] ? (getProfileDisplayName(users[0]) || users[0].username || row.user_id) : "Operador";

    if (payload.eventType === "INSERT") {
      showToast(`${operador} inicio ${orden}.`, "success");
      return;
    }

    const before = String(payload?.old?.estado_registro || "").toUpperCase();
    const after = String(payload?.new?.estado_registro || "").toUpperCase();
    if (!after || before === after) return;

    if (after === "FINALIZADO") showToast(`${operador} finalizo ${orden}.`, "success");
    else if (after === "PAUSADO") showToast(`${operador} pauso ${orden}.`, "warn");
    else if (after === "DEVUELTO") showToast(`${operador} devolvio ${orden} a PLACAS.`, "warn");
    else if (after === "ACTIVO" && before === "PAUSADO") showToast(`${operador} reanudo ${orden}.`, "info");
  }

  supabase.channel("admin-registro-watch")
    .on("postgres_changes", { event: "*", schema: "public", table: "registro_produccion" }, async (payload) => {
      try {
        await notifyRegistroRealtime(payload);
      } catch (e) {
        console.error("REALTIME_NOTIFY_REG_ERROR", e);
      }
      scheduleLoadRegistros();
      scheduleLoadJobs();
    })
    .subscribe();

  supabase.channel("admin-ordenes-watch")
    .on("postgres_changes", { event: "*", schema: "public", table: "ordenes" }, () => {
      scheduleLoadJobs();
    })
    .subscribe();
}
