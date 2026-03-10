export function isEditableEstado(estado) {
  const e = String(estado || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  return e === "DISENO" || e === "PLACAS";
}

export function toDbTipoImpresion(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return null;
  if (raw === "TIRA/RETIRA") return "TIRA_RETIRA";
  if (raw === "T+R") return "TIRA+RETIRA";
  if (raw === "DOBLE PINZA") return "DOBLE_PINZA";
  return raw;
}

export function toDbColorMode(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "FC";
  if (raw === "FC" || raw === "F/C") return "FC";
  if (raw === "BN" || raw === "1 COLOR" || raw === "1_COLOR" || raw === "ONE_COLOR") return "ONE_COLOR";
  if (raw === "2 COLORES" || raw === "DOS COLORES" || raw === "TWO_COLORS") return "TWO_COLORS";
  if (raw === "MIXTO" || raw === "PERSONALIZADO" || raw === "CUSTOM") return "CUSTOM";
  return raw;
}

export function fmtTipoImpresion(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "TIRA_RETIRA") return "TIRA/RETIRA";
  if (raw === "TIRA+RETIRA") return "T+R";
  if (raw === "DOBLE_PINZA") return "DOBLE PINZA";
  return String(value || "-");
}
