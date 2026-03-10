export function isPausedRegistro(registro) {
  return String(registro?.estado_registro || "").toUpperCase() === "PAUSADO";
}

export function getIncidenciaPayload(getValue) {
  const motivo = (getValue("incMotivo") || "").trim();
  const observacion = (getValue("incObs") || "").trim() || null;
  return { motivo, observacion };
}

export function clearIncidenciaFields(el) {
  const m = el("incMotivo");
  const o = el("incObs");
  if (m) m.value = "";
  if (o) o.value = "";
}
