import { setTextById } from "./dom.js";

export function createMessageSetters(map) {
  const out = {};
  Object.entries(map || {}).forEach(([name, id]) => {
    out[name] = (text) => setTextById(id, text || "");
  });
  return out;
}
