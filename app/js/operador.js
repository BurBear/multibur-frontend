// app/js/operador.js
import { requireOperador, logout, getProfileDisplayName } from "./auth.js";
import { setText, debounce } from "./ui.js";
import { supabase } from "./supabaseClient.js";
import {
  fetchMaquinas,
  fetchTrabajosPendientes,
  fetchMiRegistroActivo,
  rpcIniciarTrabajo,
  rpcPausarTrabajo,
  rpcReanudarTrabajo,
  rpcDevolverTrabajoAPlacas,
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
function msgInc(t){ setText("incidentMsg", t || ""); }

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

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
}

function playAlertBeep() {
  if (!audioUnlocked) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(880, ctx.currentTime);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.3);
  osc.onended = () => ctx.close().catch(() => {});
}

function scheduleLoadTrabajos(delay = 350) {
  clearTimeout(trabajoReloadTimer);
  trabajoReloadTimer = setTimeout(() => { loadTrabajos().catch((e) => console.error("REALTIME_LOADTRABAJOS_ERROR", e)); }, delay);
}

function scheduleLoadHoy(delay = 350) {
  clearTimeout(hoyReloadTimer);
  hoyReloadTimer = setTimeout(() => { loadHoy().catch((e) => console.error("REALTIME_LOADHOY_ERROR", e)); }, delay);
}

function fmtDatePE(x){
  if(!x) return "-";
  return new Date(x).toLocaleString("es-PE", { timeZone: "America/Lima" });
}
function fmtTimePE(x){
  if(!x) return "-";
  return new Date(x).toLocaleTimeString("es-PE", { timeZone: "America/Lima" });
}

function isPausedRegistro(reg){
  return String(reg?.estado_registro || "").toUpperCase() === "PAUSADO";
}

function getIncidenciaPayload(){
  const motivo = (getValue("incMotivo") || "").trim();
  const observacion = (getValue("incObs") || "").trim() || null;
  return { motivo, observacion };
}

function clearIncidenciaFields(){
  const m = el("incMotivo");
  const o = el("incObs");
  if(m) m.value = "";
  if(o) o.value = "";
}

function syncStatusBanner() {
  const banner = el("statusBanner");
  const incBanner = el("incidentBanner");
  if(!banner) return;
  banner.classList.toggle("is-paused", !!activeRegistro && isPausedRegistro(activeRegistro));
  if(incBanner) incBanner.classList.toggle("is-paused", !!activeRegistro && isPausedRegistro(activeRegistro));

  if(!activeRegistro){
    banner.innerHTML = "<strong>Trabajo listo para iniciar</strong>Completa la maquina y luego inicia. Si surge una incidencia, registrala antes de pausar o devolver.";
    if(incBanner) incBanner.innerHTML = "<strong>Registrar incidencia</strong>Primero registra el motivo. Luego decide si el trabajo debe pausarse, reanudarse o volver a PLACAS.";
    return;
  }

  if(isPausedRegistro(activeRegistro)){
    const motivo = activeRegistro.motivo_incidencia || "-";
    banner.innerHTML = `<strong>Trabajo pausado</strong>Motivo: ${esc(motivo)}. Resuelve la incidencia y presiona REANUDAR para continuar. Si no se puede seguir, devuelve a PLACAS.`;
    if(incBanner) incBanner.innerHTML = `<strong>Trabajo pausado</strong>Motivo: ${esc(motivo)}. Reanuda si ya resolviste el problema o devuelve a PLACAS si no se puede continuar.`;
    return;
  }

  banner.innerHTML = "<strong>Trabajo en curso</strong>La impresion esta activa. Si surge un problema, registra la incidencia y pausa. Cuando termine, finaliza con cantidades.";
  if(incBanner) incBanner.innerHTML = "<strong>Trabajo en curso</strong>Si aparece una incidencia, registrala y pausa. Si ya estaba pausado y se resolvio, reanuda antes de finalizar.";
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
let filteredPendientes = [];
let pendientesPage = 1;
let pendientesPageSize = 20;
let maquinasMap = new Map();
let operatorRealtimeBound = false;
let trabajoReloadTimer = null;
let hoyReloadTimer = null;
let toastWrap = null;
let audioUnlocked = false;
let lastAlertedOrderIds = new Set();

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
  closeIncidentModal();
}
function openIncidentModal(){
  const w = el("incidentWrap");
  if(!w) return;
  w.classList.remove("hide");
  w.setAttribute("aria-hidden", "false");
  msgInc("");
}
function closeIncidentModal(){
  const w = el("incidentWrap");
  if(!w) return;
  w.classList.add("hide");
  w.setAttribute("aria-hidden", "true");
}

function bindRealtime() {
  if (operatorRealtimeBound) return;
  operatorRealtimeBound = true;

  supabase.channel("operador-ordenes-watch")
    .on("postgres_changes", { event: "*", schema: "public", table: "ordenes" }, (payload) => {
      const next = payload?.new || null;
      const prev = payload?.old || null;
      const nextEstado = String(next?.estado || "").toUpperCase();
      const prevEstado = String(prev?.estado || "").toUpperCase();
      const entersPlacas =
        (payload.eventType === "INSERT" && nextEstado === "PLACAS") ||
        (payload.eventType === "UPDATE" && nextEstado === "PLACAS" && prevEstado !== "PLACAS");
      if (entersPlacas && next?.id && !lastAlertedOrderIds.has(next.id)) {
        lastAlertedOrderIds.add(next.id);
        const orden = next.numero_orden_fisica || `#${next.id}`;
        const trabajo = next.descripcion_trabajo || "Trabajo nuevo";
        showToast(`Nueva orden lista para imprimir: ${orden} - ${trabajo}`, "success");
        playAlertBeep();
      }
      scheduleLoadTrabajos();
    })
    .subscribe();

  supabase.channel("operador-registro-watch")
    .on("postgres_changes", { event: "*", schema: "public", table: "registro_produccion" }, (payload) => {
      const row = payload?.new || payload?.old;
      if (row?.user_id && currentUser?.id && row.user_id !== currentUser.id) return;
      scheduleLoadHoy();
      resumeIfActive().catch((e) => console.error("REALTIME_RESUME_ERROR", e));
    })
    .subscribe();
}

function setModalDetails(row){
  if(!row){
    setVal("mCantidad", "-");
    setVal("mDemasia", "-");
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
  const cantidad = row.cantidad_solicitada ?? row.cantidad ?? "-";
  const demasia = row.demasia ?? "-";

  setVal("mCantidad", String(cantidad));
  setVal("mDemasia", String(demasia));
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
    const detRaw = Array.isArray(ord?.detalles_orden) ? ord.detalles_orden[0] : ord?.detalles_orden;
    const det = detRaw || {};
    setModalDetails({
      ...row,
      orden_id: row?.orden_id ?? ord?.id,
      numero_orden_fisica: row?.numero_orden_fisica ?? (ord?.id ? "#" + ord.id : "-"),
      estado: row?.estado ?? ord?.estado,
      cliente_nombre: row?.cliente_nombre ?? ord?.cliente?.nombre,
      descripcion_trabajo: ord?.descripcion_trabajo ?? row.descripcion_trabajo,
      observaciones_generales: ord?.observaciones_generales ?? row.observaciones_generales,
      fecha_entrega: ord?.fecha_entrega ?? row.fecha_entrega,
      papel_material: row?.papel_material ?? det?.papel_material,
      gramaje: row?.gramaje ?? det?.gramaje,
      medida_ancho: row?.medida_ancho ?? det?.medida_ancho,
      medida_alto: row?.medida_alto ?? det?.medida_alto,
      tipo_impresion: row?.tipo_impresion ?? det?.tipo_impresion,
      color_text: row?.color_text ?? det?.color_text,
      maquina_sugerida_nombre: row?.maquina_sugerida_nombre ?? det?.maquina?.nombre,
      cantidad_solicitada: det?.cantidad_solicitada ?? row.cantidad_solicitada,
      demasia: det?.demasia ?? row.demasia
    });
  }catch{
    setModalDetails(row);
  }
}

/* =========================
   KPIs
========================= */
function setKPIs(){
  const activeLabel = activeRegistro ? (isPausedRegistro(activeRegistro) ? "PAUSADO" : "ACTIVO") : "NO";
  const maqName = (activeRegistro?.maquina_id ?? null) ? (maquinasMap.get(Number(activeRegistro.maquina_id)) || String(activeRegistro.maquina_id)) : "-";

  setVal("kAct", activeLabel);
  setVal("kOrd", activeRegistro?.orden_id ? String(activeRegistro.orden_id) : "-");
  setVal("kMaq", maqName);
  setVal("kIni", activeRegistro?.hora_inicio ? fmtTimePE(activeRegistro.hora_inicio) : "-");

  setDisabled("btnStart", !!activeRegistro);
  setDisabled("btnPause", !activeRegistro || isPausedRegistro(activeRegistro));
  setDisabled("btnResume", !activeRegistro || !isPausedRegistro(activeRegistro));
  setDisabled("btnStop", !activeRegistro || isPausedRegistro(activeRegistro));
  setDisabled("btnReturnPlacas", !activeRegistro);

  setDisabled("good", !activeRegistro);
  setDisabled("bad", !activeRegistro);
  setDisabled("obs", !activeRegistro);
  setDisabled("incMotivo", !activeRegistro);
  setDisabled("incObs", !activeRegistro);
  syncStatusBanner();
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

function renderPendientesPage() {
  const total = filteredPendientes.length;
  const totalPages = Math.max(1, Math.ceil(total / pendientesPageSize));
  pendientesPage = Math.min(pendientesPage, totalPages);
  const start = (pendientesPage - 1) * pendientesPageSize;
  const end = start + pendientesPageSize;
  const pageRows = filteredPendientes.slice(start, end);
  renderPendientes(pageRows);

  const from = total ? start + 1 : 0;
  const to = Math.min(end, total);
  setVal("pendStats", `Mostrando ${from}-${to} de ${total}`);
  setVal("pendPageInfo", `${pendientesPage} / ${totalPages}`);
  setDisabled("btnPendPrev", pendientesPage <= 1);
  setDisabled("btnPendNext", pendientesPage >= totalPages);
}

async function loadTrabajos(){
  msgL("");

  const q = (getValue("q") || "").trim().toLowerCase();
  let rows = await fetchTrabajosPendientes({ estado: "PLACAS" });

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
  filteredPendientes = allPendientes.slice();
  pendientesPage = 1;
  renderPendientesPage();
}

async function loadActiveRegistro(){
  activeRegistro = await fetchMiRegistroActivo(currentUser.id);
  setKPIs();

  if(activeRegistro){
    selectedOrderId = Number(activeRegistro.orden_id);
    setVal("selJob", "Orden ID: " + selectedOrderId);
    setVal("selEstado", activeRegistro.estado_registro || "ACTIVO");

    openModal();
    if(isPausedRegistro(activeRegistro)){
      msgR(
        "INFO: Tienes un trabajo pausado.\n" +
        `Motivo: ${activeRegistro.motivo_incidencia || "-"}\n` +
        "Puedes finalizarlo si ya resolviste el problema o devolverlo a PLACAS."
      );
    } else {
      msgR("INFO: Tienes un trabajo activo. Registra cantidades, pausa si hay incidencia o presiona FINALIZAR.");
    }
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
        <td>${esc(r.hora_fin ? fmtTimePE(r.hora_fin) : (r.estado_registro || "-"))}</td>
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
  setVal("selEstado", activeRegistro.estado_registro || "ACTIVO");

  const row = allPendientes.find(x => Number(x.orden_id) === Number(activeRegistro.orden_id)) || { orden_id: activeRegistro.orden_id };
  await loadModalDetails(row);

  const sel = el("maquina");
  if(sel && activeRegistro.maquina_id){
    sel.value = String(activeRegistro.maquina_id);
  }

  if(isPausedRegistro(activeRegistro)){
    const inc = el("incMotivo");
    const obs = el("incObs");
    if(inc) inc.value = activeRegistro.motivo_incidencia || "";
    if(obs) obs.value = activeRegistro.obs_incidencia || "";
    msgR(
      "INFO: Se detecto un trabajo pausado.\n" +
      `Orden: ${activeRegistro.orden_id}\n` +
      "Puedes registrar la resolucion y finalizar, o devolverlo a PLACAS."
    );
  } else {
    msgR(
      "INFO: Se detecto un trabajo activo.\n" +
      `Orden: ${activeRegistro.orden_id}\n` +
      "Puedes continuar la impresion, pausar por incidencia o finalizar."
    );
  }

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
    hora_fin: null,
    estado_registro: "ACTIVO",
    motivo_incidencia: null,
    obs_incidencia: null
  };
  setKPIs();
  clearIncidenciaFields();

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

async function pauseRegistro(){
  msgR("");

  await loadActiveRegistro();
  if(!activeRegistro){
    msgR("No tienes un registro activo para pausar.");
    return;
  }
  if(isPausedRegistro(activeRegistro)){
    msgR("Este trabajo ya esta pausado.");
    return;
  }

  const { motivo, observacion } = getIncidenciaPayload();
  if(!motivo){
    msgR("Selecciona un motivo de incidencia antes de pausar.");
    return;
  }

  try {
    await rpcPausarTrabajo({
      registroId: activeRegistro.id,
      motivoIncidencia: motivo,
      obsIncidencia: observacion
    });

    await loadActiveRegistro();
    const obs = el("incObs");
    if(obs) obs.value = activeRegistro?.obs_incidencia || observacion || "";
    setVal("selEstado", activeRegistro?.estado_registro || "PAUSADO");
    msgR(
      "OK Trabajo pausado.\n" +
      `Motivo: ${motivo}\n` +
      "Resuelve la incidencia y presiona REANUDAR para continuar, o devuelve a PLACAS."
    );
    msgInc("Trabajo pausado correctamente.");
    closeIncidentModal();
  } catch (e) {
    const text = "Error al pausar: " + (e?.message || e);
    msgR(text);
    msgInc(text);
  }
}

async function resumeRegistro(){
  msgR("");

  await loadActiveRegistro();
  if(!activeRegistro){
    msgR("No tienes un registro pausado para reanudar.");
    return;
  }
  if(!isPausedRegistro(activeRegistro)){
    msgR("El trabajo actual no esta pausado.");
    return;
  }

  try {
    await rpcReanudarTrabajo({ registroId: activeRegistro.id });
    await loadActiveRegistro();
    setVal("selEstado", activeRegistro?.estado_registro || "ACTIVO");
    msgR(
      "OK Trabajo reanudado.\n" +
      `Orden: ${activeRegistro?.orden_id ?? "-"}\n` +
      "Puedes continuar la impresion y luego finalizar."
    );
    msgInc("Trabajo reanudado correctamente.");
    closeIncidentModal();
  } catch (e) {
    const text = "Error al reanudar: " + (e?.message || e);
    msgR(text);
    msgInc(text);
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
    clearIncidenciaFields();

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

async function returnTrabajoAPlacas(){
  msgR("");

  await loadActiveRegistro();
  if(!activeRegistro){
    msgR("No tienes un registro activo para devolver.");
    return;
  }

  const { motivo, observacion } = getIncidenciaPayload();
  if(!motivo){
    msgR("Selecciona un motivo de incidencia antes de devolver a PLACAS.");
    return;
  }

  try {
    await rpcDevolverTrabajoAPlacas({
      registroId: activeRegistro.id,
      motivoIncidencia: motivo,
      obsIncidencia: observacion
    });

    const g = el("good"); if(g) g.value = "";
    const b = el("bad");  if(b) b.value = "";
    const o = el("obs");  if(o) o.value = "";
    clearIncidenciaFields();

    activeRegistro = null;
    selectedOrderId = null;
    selectedOrderEstado = null;
    selectedRow = null;
    setVal("selJob", "Ninguno");
    setVal("selEstado", "-");
    setKPIs();

    msgR(
      "OK Trabajo devuelto a PLACAS.\n" +
      `Motivo: ${motivo}`
    );
    msgInc("Trabajo devuelto a PLACAS.");

    await loadTrabajos();
    await loadHoy();
    closeIncidentModal();
    closeModal();
  } catch (e) {
    const text = "Error al devolver a PLACAS: " + (e?.message || e);
    msgR(text);
    msgInc(text);
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
  ["click", "keydown", "pointerdown"].forEach((evt) => {
    document.addEventListener(evt, unlockAudio, { once: true, passive: true });
  });

  el("btnReload")?.addEventListener("click", loadTrabajos);
  el("q")?.addEventListener("input", debounce(loadTrabajos, 250));
  el("pendLimit")?.addEventListener("change", () => {
    pendientesPageSize = Number(getValue("pendLimit") || 20);
    pendientesPage = 1;
    renderPendientesPage();
  });
  el("btnPendPrev")?.addEventListener("click", () => {
    if (pendientesPage <= 1) return;
    pendientesPage -= 1;
    renderPendientesPage();
  });
  el("btnPendNext")?.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(filteredPendientes.length / pendientesPageSize));
    if (pendientesPage >= totalPages) return;
    pendientesPage += 1;
    renderPendientesPage();
  });

  el("btnStart")?.addEventListener("click", startRegistro);
  el("btnOpenIncident")?.addEventListener("click", openIncidentModal);
  el("btnPause")?.addEventListener("click", pauseRegistro);
  el("btnResume")?.addEventListener("click", resumeRegistro);
  el("btnStop")?.addEventListener("click", stopRegistro);
  el("btnReturnPlacas")?.addEventListener("click", returnTrabajoAPlacas);

  el("tabPend")?.addEventListener("click", () => setTab("pend"));
  el("tabHoy")?.addEventListener("click", async () => {
    setTab("hoy");
    await loadHoy();
  });
  el("btnReloadHoy")?.addEventListener("click", loadHoy);

  el("btnModalClose")?.addEventListener("click", closeModal);
  el("btnIncidentClose")?.addEventListener("click", closeIncidentModal);
  el("modalWrap")?.addEventListener("click", (ev) => {
    if(ev.target && ev.target.id === "modalWrap") closeModal();
  });
  el("incidentWrap")?.addEventListener("click", (ev) => {
    if(ev.target && ev.target.id === "incidentWrap") closeIncidentModal();
  });
  document.addEventListener("keydown", (e) => {
    if(e.key === "Escape") closeModal();
  });

  await loadMaquinas();
  bindRealtime();
  await loadTrabajos();
  await loadHoy();

  await resumeIfActive();

  setKPIs();
})();
