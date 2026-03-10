export function createToastController() {
  let toastWrap = null;

  function ensureToastWrap() {
    if (toastWrap) return toastWrap;
    toastWrap = document.createElement("div");
    toastWrap.style.position = "fixed";
    toastWrap.style.top = "18px";
    toastWrap.style.right = "18px";
    toastWrap.style.zIndex = "120";
    toastWrap.style.display = "grid";
    toastWrap.style.gap = "10px";
    toastWrap.style.maxWidth = "320px";
    document.body.appendChild(toastWrap);
    return toastWrap;
  }

  function showToast(text, tone = "info") {
    const wrap = ensureToastWrap();
    const item = document.createElement("div");
    const palettes = {
      info: { bg: "#0f172a", bd: "#37558a", fg: "#e8eefc" },
      success: { bg: "#052e1a", bd: "#1f7a57", fg: "#dcfce7" },
      warn: { bg: "#3a2305", bd: "#f59e0b", fg: "#fde68a" }
    };
    const c = palettes[tone] || palettes.info;
    item.textContent = text;
    item.style.padding = "12px 14px";
    item.style.borderRadius = "12px";
    item.style.border = `1px solid ${c.bd}`;
    item.style.background = c.bg;
    item.style.color = c.fg;
    item.style.boxShadow = "0 18px 40px rgba(2,8,23,.35)";
    item.style.fontSize = "13px";
    item.style.lineHeight = "1.35";
    item.style.opacity = "0";
    item.style.transform = "translateY(-6px)";
    item.style.transition = "opacity .18s ease, transform .18s ease";
    wrap.appendChild(item);
    requestAnimationFrame(() => {
      item.style.opacity = "1";
      item.style.transform = "translateY(0)";
    });
    setTimeout(() => {
      item.style.opacity = "0";
      item.style.transform = "translateY(-6px)";
      setTimeout(() => item.remove(), 180);
    }, 4200);
  }

  return { showToast };
}
