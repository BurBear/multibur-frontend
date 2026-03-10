export function fmtDateTimePE(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("es-PE", { timeZone: "America/Lima" });
}

export function fmtTimePE(value) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString("es-PE", { timeZone: "America/Lima" });
}

export function fmtEntrega(value) {
  if (!value) return "-";
  const source = String(value).trim();
  const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/i.test(source);
  if (hasOffset) return new Date(source).toLocaleString("es-PE", { timeZone: "America/Lima" });

  const match = source.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    const [, y, mo, d, hh, mm, ss = "00"] = match;
    return `${d}/${mo}/${y}, ${hh}:${mm}:${ss}`;
  }

  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) return source;
  return parsed.toLocaleString("es-PE");
}
