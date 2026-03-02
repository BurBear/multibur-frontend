// app/js/operador.js
import { requireOperador, logout, getProfileDisplayName } from "./auth.js";
import { setText, debounce } from "./ui.js";
import {
  fetchMaquinas,
  fetchTrabajosPendientes,
  fetchMiRegistroActivo,
  rpcIniciarTrabajo,
  rpcFinalizarTrabajo,
  fetchMisRegistrosHoy,
  fetchOrdenById
} from "./api.js";

/* =========================
   HELPERS UI (null-safe)
========================= */
function el(id){ return document.getElementById(id); }
function setVal(id, v){ const x = el(id); if(x) x.textContent = v; }
function setDisabled(id, v){ const x = el(id); if(x) x.disabled = !!v; }
function getValue(id){ const x = el(id); return x ? x.value : ""; }
function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));
}

function msgL(t){ setText("msgLeft", t || ""); }
function msgR(t){ setText("msgRight", t || ""); }
function msgHoy(t){ setText("msgHoy", t || ""); }

function fmtDatePE(x){
  if(!x) return "-";
  return new Date(x).toLocaleString("es-PE", { timeZone: "America/Lima" });
}
function fmtTimePE(x){
  if(!x) return "-";
  return new Date(x).toLocaleTimeString("es-PE", { timeZone: "America/Lima" });
}

/* =========================
   STATE
========================= */
let currentUser = null;

let selectedOrderId = null;
let selectedOrderEstado = null;
let selectedRow = null;

let activeRegistro = null; // {id, orden_id, maquina_id, hora_inicio} o null

let allPendientes = [];
let maquinasMap = new Map();

/* =========================
   MODAL
========================= */
function openModal(){
  const w = el("modalWrap");
  if(!w) return;
  w.classList.remove("hide");
  w.setAttribute("aria-hidden", "false");
}
function closeModal(){
  const w = el("modalWrap");
  if(!w) return;
  w.classList.add("hide");
  w.setAttribute("aria-hidden", "true");
}

function setModalDetails(row){
  if(!row){
    setVal("mOrden", "-");
    setVal("mEstado", "-");
    setVal("mCliente", "-");
    setVal("mTrabajo", "-");
    setVal("mFormato", "-");
    setVal("mMaterial", "-");
    setVal("mImpresion", "-");
    setVal("mColor", "-");
    setVal("mEntrega", "-");
    setVal("mMaqSug", "-");
    setVal("mObs", "-");
    return;
  }

  const formato = (row.medida_ancho && row.medida_alto) ? `${row.medida_ancho} x ${row.medida_alto}` : "-";
  const entrega = row.fecha_entrega ? fmtDatePE(row.fecha_entrega) : "-";
  const mat = `${row.papel_material || "-"} ${row.gramaje ? (row.gramaje + "g") : ""}`.trim();

  setVal("mOrden", row.numero_orden_fisica || ("#" + row.orden_id));
  setVal("mEstado", row.estado || "-");
  setVal("mCliente", row.cliente_nombre || "-");
  setVal("mTrabajo", row.descripcion_trabajo || "-");
  setVal("mFormato", formato);
  setVal("mMaterial", mat);
  setVal("mImpresion", row.tipo_impresion || "-");
  setVal("mColor", row.color_text || "-");
  setVal("mEntrega", entrega);
  setVal("mMaqSug", row.maquina_sugerida_nombre || "-");
  setVal("mObs", row.observaciones_generales || row.observaciones || "-");
}

async function loadModalDetails(row){
  if(!row?.orden_id){
    setModalDetails(row);
    return;
  }

  try{
    const ord = await fetchOrdenById(row.orden_id);
    setModalDetails({
      ...row,
      descripcion_trabajo: ord?.descripcion_trabajo ?? row.descripcion_trabajo,
      observaciones_generales: ord?.observaciones_generales ?? row.observaciones_generales,
      fecha_entrega: ord?.fecha_entrega ?? row.fecha_entrega
    });
  }catch{
    setModalDetails(row);
  }
}

/* =========================
   KPIs
========================= */
function setKPIs(){
  setVal("kAct", activeRegistro ? "SI" : "NO");
  setVal("kOrd", activeRegistro?.orden_id ? String(activeRegistro.orden_id) : "-");
  setVal("kMaq", (activeRegistro?.maquina_id ?? null) ? String(activeRegistro.maquina_id) : "-");
  setVal("kIni", activeRegistro?.hora_inicio ? fmtTimePE(activeRegistro.hora_inicio) : "-");

  setDisabled("btnStart", !!activeRegistro);
  setDisabled("btnStop", !activeRegistro);

  setDisabled("good", !activeRegistro);
  setDisabled("bad", !activeRegistro);
  setDisabled("obs", !activeRegistro);
}

/* =========================
   DATA LOADS
========================= */
async function loadMaquinas(){
  const maquinas = await fetchMaquinas();
  const sel = el("maquina");
  if(sel){
    sel.innerHTML = (maquinas || [])
      .map(m => `<option value="${m.id}">${esc(m.nombre)} (${esc(m.tipo)})</option>`)
      .join("");
  }
  maquinasMap = new Map((maquinas || []).map(m => [Number(m.id), m.nombre]));
}

function renderPendientes(rows){
  const tb = el("tb");
  if(!tb) return;

  tb.innerHTML = (rows || []).map(r => {
    const formato = (r.medida_ancho && r.medida_alto) ? `${r.medida_ancho} x ${r.medida_alto}` : "-";
    const entrega = r.fecha_entrega ? fmtDatePE(r.fecha_entrega) : "-";

    const title = `title="Ver detalle y acciones"`;

    return `
      <tr>
        <td>
          <div><b>${esc(r.numero_orden_fisica || ("#" + r.orden_id))}</b></div>
          <div class="muted">${esc(r.estado)} - ${esc(r.prioridad)}</div>
          <div class="muted">Ent: ${entrega}</div>
        </td>
        <td>${esc(r.cliente_nombre || "-")}</td>
        <td>${esc(r.descripcion_trabajo || "-")}</td>
        <td><b>${esc(formato)}</b><div class="muted">${esc(r.papel_material || "")} ${esc(r.gramaje ? (r.gramaje + "g") : "")}</div></td>
        <td>${esc(r.tipo_impresion || "-")}</td>
        <td>${esc(r.color_text || "-")}</td>
        <td>${esc(r.maquina_sugerida_nombre || "-")}</td>
        <td>
          <button class="btn btn-ghost" data-oid="${r.orden_id}" data-est="${esc(r.estado)}" ${title}>Elegir</button>
        </td>
      </tr>
    `;
  }).join("");

  tb.querySelectorAll("button[data-oid]").forEach(btn => {
    btn.addEventListener("click", async () => {
      selectedOrderId = Number(btn.getAttribute("data-oid"));
      selectedOrderEstado = String(btn.getAttribute("data-est") || "");
      selectedRow = allPendientes.find(x => Number(x.orden_id) === selectedOrderId) || null;

      setVal("selJob", selectedOrderId ? ("Orden ID: " + selectedOrderId) : "Ninguno");
      setVal("selEstado", selectedOrderEstado || "-");

      await loadModalDetails(selectedRow);
      openModal();

      if(activeRegistro){
        msgR(`AVISO: Ya tienes un registro activo (Orden ${activeRegistro.orden_id}). Finalizalo primero.`);
        return;
      }

      if(selectedOrderEstado !== "PLACAS"){
        msgR("AVISO: Trabajo seleccionado, pero no puedes iniciar todavia.\nSolo se puede INICIAR cuando el estado es PLACAS.");
      } else {
        msgR("OK Trabajo seleccionado (PLACAS). Elige maquina y presiona INICIAR.");
      }
    });
  });

  msgL(`Cargados: ${(rows || []).length} trabajo(s).`);
}

async function loadTrabajos(){
  msgL("");

  const q = (getValue("q") || "").trim().toLowerCase();
  const fEstado = getValue("fEstado") || "";

  let rows = await fetchTrabajosPendientes({ estado: fEstado });

  if(q){
    rows = (rows || []).filter(r => {
      const s = [
        r.numero_orden_fisica,
        r.cliente_nombre,
        r.descripcion_trabajo,
        r.estado,
        r.tipo_impresion,
        r.color_text,
        r.maquina_sugerida_nombre
      ].join(" ").toLowerCase();
      return s.includes(q);
    });
  }

  allPendientes = rows || [];
  renderPendientes(allPendientes);
}

async function loadActiveRegistro(){
  activeRegistro = await fetchMiRegistroActivo(currentUser.id);
  setKPIs();

  if(activeRegistro){
    selectedOrderId = Number(activeRegistro.orden_id);
    setVal("selJob", "Orden ID: " + selectedOrderId);
    setVal("selEstado", "EN CURSO");

    openModal();
    msgR("INFO: Tienes un trabajo activo. Registra cantidades y presiona FINALIZAR.");
  }
}


async function loadHoy(){
  const tb = el("tbHoy");
  if(!tb) return;

  msgHoy("");
  const rows = await fetchMisRegistrosHoy(currentUser.id);

  tb.innerHTML = (rows || []).map(r => {
    const maq = r.maquina_id ? (maquinasMap.get(Number(r.maquina_id)) || r.maquina_id) : "-";
    return `
      <tr>
        <td><b>#${esc(r.id)}</b></td>
        <td>${esc(r.orden_id)}</td>
        <td>${esc(maq)}</td>
        <td>${esc(r.hora_inicio ? fmtTimePE(r.hora_inicio) : "-")}</td>
        <td>${esc(r.hora_fin ? fmtTimePE(r.hora_fin) : "-")}</td>
        <td>${esc(r.cantidad_buena ?? "-")}</td>
        <td>${esc(r.cantidad_mala ?? "-")}</td>
      </tr>
    `;
  }).join("");

  msgHoy(`Registros de hoy: ${(rows || []).length}`);
}

/* =========================
   RETOMAR TRABAJO ACTIVO
========================= */
async function resumeIfActive(){
  await loadActiveRegistro();
  if(!activeRegistro) return;

  openModal();

  setVal("selJob", "Orden ID: " + activeRegistro.orden_id);
  setVal("selEstado", "EN PROCESO");

  const row = allPendientes.find(x => Number(x.orden_id) === Number(activeRegistro.orden_id)) || null;
  await loadModalDetails(row);

  const sel = el("maquina");
  if(sel && activeRegistro.maquina_id){
    sel.value = String(activeRegistro.maquina_id);
  }

  msgR(
    "INFO: Se detecto un trabajo activo.\n" +
    `Orden: ${activeRegistro.orden_id}\n` +
    "Puedes registrar cantidades y presionar FINALIZAR."
  );

  setKPIs();
}

/* =========================
   ACTIONS
========================= */
async function startRegistro(){
  msgR("");

  await loadActiveRegistro();
  if(activeRegistro){
    msgR(`AVISO: Ya tienes un registro activo (Orden ${activeRegistro.orden_id}). Finalizalo antes de iniciar otro.`);
    openModal();
    return;
  }

  if(!selectedOrderId){
    msgR("Selecciona un trabajo primero (boton 'Elegir').");
    return;
  }
  if(selectedOrderEstado !== "PLACAS"){
    msgR("No se puede iniciar.\nEste trabajo no esta en PLACAS.");
    return;
  }

  const maquinaId = Number(getValue("maquina"));

  try {
  const res = await rpcIniciarTrabajo({ ordenId: selectedOrderId, maquinaId });

  activeRegistro = {
    id: res?.registro_id,
    orden_id: selectedOrderId,
    maquina_id: maquinaId,
    hora_inicio: new Date().toISOString(),
    hora_fin: null
  };
  setKPIs();

  msgR(
    "OK Registro iniciado.\n" +
    `Registro ID: ${res?.registro_id ?? "-"}\n` +
    `Nuevo estado: ${res?.nuevo_estado ?? "IMPRESION"}`
  );

  await loadTrabajos();
  await loadHoy();
  await loadActiveRegistro();
  if(!activeRegistro?.id){
    throw new Error("No se pudo confirmar el registro activo. Recarga e intenta nuevamente.");
  }
  setKPIs();
} catch (e) {
  msgR("Error al iniciar: " + (e?.message || e));
}

}

async function stopRegistro(){
  msgR("");

  await loadActiveRegistro();
  if(!activeRegistro){
    msgR("No tienes un registro activo para finalizar.");
    return;
  }
  if(!activeRegistro.id){
    msgR("No se encontro el ID del registro activo. Recarga e intenta de nuevo.");
    return;
  }

  const buena = getValue("good") === "" ? null : Number(getValue("good"));
  const mala  = getValue("bad") === "" ? 0 : Number(getValue("bad"));
  const obs   = (getValue("obs") || "").trim() || null;

  if(buena !== null && (Number.isNaN(buena) || buena < 0)){
    msgR("Cantidad buena invalida.");
    return;
  }
  if(Number.isNaN(mala) || mala < 0){
    msgR("Cantidad mala invalida.");
    return;
  }

  try {
    const res = await rpcFinalizarTrabajo({
      registroId: activeRegistro.id,
      buena,
      mala,
      observaciones: obs
    });

    msgR(
      "OK Registro finalizado.\n" +
      `Orden: ${res?.orden_id ?? "-"}\n` +
      `Nuevo estado: ${res?.nuevo_estado ?? "-"}`
    );

    const g = el("good"); if(g) g.value = "";
    const b = el("bad");  if(b) b.value = "";
    const o = el("obs");  if(o) o.value = "";

    activeRegistro = null;
    selectedOrderId = null;
    selectedOrderEstado = null;
    selectedRow = null;
    setVal("selJob", "Ninguno");
    setVal("selEstado", "-");

    setKPIs();

    await loadTrabajos();
    await loadHoy();

    closeModal();
  } catch (e) {
    msgR("Error al finalizar: " + (e?.message || e));
  }
}

/* =========================
   TABS
========================= */
function setTab(which){
  const secPend = el("secPend");
  const secHoy  = el("secHoy");
  const tabPend = el("tabPend");
  const tabHoy  = el("tabHoy");

  if(!secPend || !secHoy || !tabPend || !tabHoy) return;

  if(which === "hoy"){
    secPend.classList.add("hide");
    secHoy.classList.remove("hide");
    tabPend.classList.remove("active");
    tabHoy.classList.add("active");
  } else {
    secHoy.classList.add("hide");
    secPend.classList.remove("hide");
    tabHoy.classList.remove("active");
    tabPend.classList.add("active");
  }
}

/* =========================
   INIT
========================= */
(async function init(){
  const session = await requireOperador();
  if(!session) return;

  currentUser = session.user;
  const rawName = String(getProfileDisplayName(session.prof) || "").trim();
  const displayName = rawName && !rawName.includes("@")
    ? rawName
    : (session.prof?.rol === "ADMIN" ? "Administrador" : "Operador");
  setVal("userPill", `${displayName} | ${session.prof.rol}`);

  el("btnLogout")?.addEventListener("click", async () => {
    await logout();
    window.location.href = "./login.html";
  });

  el("btnReload")?.addEventListener("click", loadTrabajos);
  el("q")?.addEventListener("input", debounce(loadTrabajos, 250));
  el("fEstado")?.addEventListener("change", loadTrabajos);

  el("btnStart")?.addEventListener("click", startRegistro);
  el("btnStop")?.addEventListener("click", stopRegistro);

  el("tabPend")?.addEventListener("click", () => setTab("pend"));
  el("tabHoy")?.addEventListener("click", async () => {
    setTab("hoy");
    await loadHoy();
  });
  el("btnReloadHoy")?.addEventListener("click", loadHoy);

  el("btnModalClose")?.addEventListener("click", closeModal);
  el("modalWrap")?.addEventListener("click", (ev) => {
    if(ev.target && ev.target.id === "modalWrap") closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if(e.key === "Escape") closeModal();
  });

  await loadMaquinas();
  await loadTrabajos();
  await loadHoy();

  await resumeIfActive();

  setKPIs();
})();
