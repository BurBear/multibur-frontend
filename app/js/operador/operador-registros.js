export function buildKpiSnapshot({ activeRegistro, maquinasMap, isPausedRegistro, fmtTimePE }) {
  const activeLabel = activeRegistro ? (isPausedRegistro(activeRegistro) ? "PAUSADO" : "ACTIVO") : "NO";
  const maqName = (activeRegistro?.maquina_id ?? null)
    ? (maquinasMap.get(Number(activeRegistro.maquina_id)) || String(activeRegistro.maquina_id))
    : "-";
  return {
    activeLabel,
    orderId: activeRegistro?.orden_id ? String(activeRegistro.orden_id) : "-",
    maquina: maqName,
    inicio: activeRegistro?.hora_inicio ? fmtTimePE(activeRegistro.hora_inicio) : "-"
  };
}
