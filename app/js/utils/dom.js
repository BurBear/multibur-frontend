export const byId = (id) => document.getElementById(id);

export function setTextById(id, value = "") {
  const node = byId(id);
  if (node) node.textContent = value;
}

export function setDisabledById(id, value) {
  const node = byId(id);
  if (node) node.disabled = !!value;
}

export function getValueById(id) {
  const node = byId(id);
  return node ? node.value : "";
}

export function setDisplayById(id, display) {
  const node = byId(id);
  if (node) node.style.display = display;
}
