// app/js/ui.js
export const $ = (id) => document.getElementById(id);

export function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text ?? "";
}

export function fmtDT(x) {
  return x ? new Date(x).toLocaleString() : "-";
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
