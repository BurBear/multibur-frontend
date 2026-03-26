const FULLSCREEN_CHANGE_EVENTS = [
  "fullscreenchange",
  "webkitfullscreenchange",
  "MSFullscreenChange"
];

const FULLSCREEN_ERROR_EVENTS = [
  "fullscreenerror",
  "webkitfullscreenerror",
  "MSFullscreenError"
];

function getFullscreenElement() {
  return (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.msFullscreenElement ||
    null
  );
}

function ensureFullscreenShell() {
  let shell = document.getElementById("appFullscreenShell");
  if (shell) return shell;

  const body = document.body;
  if (!body) return document.documentElement;

  shell = document.createElement("div");
  shell.id = "appFullscreenShell";
  shell.className = "fullscreen-shell";

  const children = Array.from(body.children);
  for (const child of children) {
    if (child.id === "loader") continue;
    if (child.tagName === "SCRIPT") continue;
    shell.appendChild(child);
  }

  const firstScript = Array.from(body.children).find((node) => node.tagName === "SCRIPT") || null;
  if (firstScript) body.insertBefore(shell, firstScript);
  else body.appendChild(shell);

  return shell;
}

function canUseFullscreen(target) {
  if (!target) return false;

  const hasRequestMethod = [
    target.requestFullscreen,
    target.webkitRequestFullscreen,
    target.msRequestFullscreen
  ].some((fn) => typeof fn === "function");

  if (!hasRequestMethod) return false;

  const enabledFlags = [
    document.fullscreenEnabled,
    document.webkitFullscreenEnabled,
    document.msFullscreenEnabled
  ].filter((flag) => typeof flag === "boolean");

  return enabledFlags.length ? enabledFlags.some(Boolean) : true;
}

async function requestFullscreen(target) {
  if (!target) throw new Error("No hay objetivo para pantalla completa.");

  if (typeof target.requestFullscreen === "function") {
    try {
      await target.requestFullscreen({ navigationUI: "hide" });
      return;
    } catch (error) {
      if (error?.name !== "TypeError") throw error;
      await target.requestFullscreen();
      return;
    }
  }

  if (typeof target.webkitRequestFullscreen === "function") {
    target.webkitRequestFullscreen();
    return;
  }

  if (typeof target.msRequestFullscreen === "function") {
    target.msRequestFullscreen();
    return;
  }

  throw new Error("Pantalla completa no soportada.");
}

async function exitFullscreen() {
  if (typeof document.exitFullscreen === "function") {
    await document.exitFullscreen();
    return;
  }

  if (typeof document.webkitExitFullscreen === "function") {
    document.webkitExitFullscreen();
    return;
  }

  if (typeof document.msExitFullscreen === "function") {
    document.msExitFullscreen();
    return;
  }

  throw new Error("No se pudo salir de pantalla completa.");
}

export async function exitFullscreenIfActive() {
  if (!getFullscreenElement()) return;
  try {
    await exitFullscreen();
  } catch (error) {
    console.error("FULLSCREEN_EXIT_ERROR", error);
  }
}

export function initFullscreenToggle({
  containerSelector = ".top-right",
  target = null,
  insertBeforeSelector = "#btnLogout",
  buttonId = "btnFullscreenToggle"
} = {}) {
  const container = document.querySelector(containerSelector);
  if (!container) return null;

  const fullscreenTarget = target || ensureFullscreenShell();

  const existing = document.getElementById(buttonId);
  if (existing) return existing;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = buttonId;
  btn.className = "btn btn-ghost btn-fullscreen";
  btn.innerHTML = `
    <span class="fullscreen-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" role="presentation">
        <path d="M8 3H4v4M16 3h4v4M8 21H4v-4M20 21h-4v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    </span>
  `;
  const insertBefore = container.querySelector(insertBeforeSelector);
  if (insertBefore) container.insertBefore(btn, insertBefore);
  else container.appendChild(btn);

  const updateUi = () => {
    const supported = canUseFullscreen(fullscreenTarget);
    const active = getFullscreenElement() === fullscreenTarget;

    btn.disabled = !supported;
    btn.classList.toggle("is-active", active);
    btn.classList.toggle("is-unsupported", !supported);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    btn.setAttribute(
      "aria-label",
      supported
        ? (active ? "Salir de pantalla completa" : "Activar pantalla completa")
        : "Pantalla completa no disponible en este navegador"
    );
    btn.title = supported
      ? (active ? "Salir de pantalla completa" : "Ver sistema en pantalla completa")
      : "Este navegador no permite pantalla completa para toda la pagina.";

    document.documentElement.classList.toggle("is-fullscreen-mode", active);
    document.body?.classList.toggle("is-fullscreen-mode", active);
  };

  btn.addEventListener("click", async () => {
    if (!canUseFullscreen(fullscreenTarget)) return;

    btn.disabled = true;
    try {
      if (getFullscreenElement() === fullscreenTarget) await exitFullscreen();
      else await requestFullscreen(fullscreenTarget);
    } catch (error) {
      console.error("FULLSCREEN_TOGGLE_ERROR", error);
    } finally {
      updateUi();
    }
  });

  FULLSCREEN_CHANGE_EVENTS.forEach((eventName) => {
    document.addEventListener(eventName, updateUi);
  });

  FULLSCREEN_ERROR_EVENTS.forEach((eventName) => {
    document.addEventListener(eventName, () => {
      console.error("FULLSCREEN_CHANGE_ERROR", eventName);
      updateUi();
    });
  });

  updateUi();
  return btn;
}
