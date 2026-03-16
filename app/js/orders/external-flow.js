export const EXTERNAL_TAG = "[EXTERNO]";

export function hasLegacyExternalTag(observacionesGenerales) {
  return String(observacionesGenerales || "").toUpperCase().includes(EXTERNAL_TAG);
}

export function resolveExternalFlag({ esExterno = null, observacionesGenerales = null } = {}) {
  return Boolean(esExterno) || hasLegacyExternalTag(observacionesGenerales);
}

export function stripLegacyExternalTag(value) {
  return String(value || "").replace(EXTERNAL_TAG, "").trim();
}

export function buildExternalObservaciones({ isExternal = false, observaciones = "" } = {}) {
  const clean = stripLegacyExternalTag(observaciones);
  if (!isExternal) return clean || null;
  return `${EXTERNAL_TAG}${clean ? ` ${clean}` : ""}`.trim();
}
