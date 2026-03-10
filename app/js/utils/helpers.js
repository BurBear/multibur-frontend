export const byId = (id) => document.getElementById(id);

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

export function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function toNumOrNull(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const num = Number(raw.replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

export function formatDbError(err) {
  if (!err) return "Error desconocido.";
  const parts = [];
  if (err.message) parts.push(`Mensaje: ${err.message}`);
  if (err.code) parts.push(`Code: ${err.code}`);
  if (err.details) parts.push(`Detalle: ${err.details}`);
  if (err.hint) parts.push(`Hint: ${err.hint}`);
  return parts.length ? parts.join("\n") : String(err);
}

export function getClientColor(textRaw) {
  const text = String(textRaw || "Default").trim();
  let hash1 = 0;
  let hash2 = 0;
  for (let i = 0; i < text.length; i++) {
    hash1 = text.charCodeAt(i) + ((hash1 << 5) - hash1);
    hash2 = text.charCodeAt(i) + ((hash2 << 7) - hash2);
  }

  // Hue entre 0 y 359
  const hue = Math.abs(hash1) % 360;
  // Saturación entre 65% y 95% para colores vivos
  const sat = 65 + (Math.abs(hash2) % 31);
  // Brillo entre 55% y 75% para que resalte sobre el fondo oscuro sin volverse pastel
  const lit = 55 + (Math.abs(hash1 ^ hash2) % 21);

  return `hsl(${hue}, ${sat}%, ${lit}%)`;
}

export function getClientBgColor(textRaw) {
  const text = String(textRaw || "Default").trim();
  let hash1 = 0;
  let hash2 = 0;
  for (let i = 0; i < text.length; i++) {
    hash1 = text.charCodeAt(i) + ((hash1 << 5) - hash1);
    hash2 = text.charCodeAt(i) + ((hash2 << 7) - hash2);
  }
  const hue = Math.abs(hash1) % 360;
  const sat = 65 + (Math.abs(hash2) % 31);
  // Brillo bajado y con un canal alfa de 0.08 (15% opacidad) para el background
  return `hsla(${hue}, ${sat}%, 50%, 0.12)`;
}
