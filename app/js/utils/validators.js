export function isPositiveNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0;
}

export function hasRequiredValue(value) {
  return String(value ?? "").trim().length > 0;
}

export function hasRequiredValues(ids, getValue) {
  return ids.filter((id) => !hasRequiredValue(getValue(id)));
}
