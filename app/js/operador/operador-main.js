// app/js/operador.js
import { requireOperador, logout, getProfileDisplayName } from "../auth.js";
import { debounce } from "../ui.js";
import { supabase } from "../supabaseClient.js";
import { escapeHtml, getClientColor, getClientBgColor } from "../utils/helpers.js";
import { fmtDateTimePE, fmtTimePE } from "../utils/formatters.js";
import {
  el,
  setVal,
  setDisabled,
  getValue,
  msgL,
  msgR,
  msgHoy,
  msgInc,
  unlockAudio,
  showToast,
  playAlertBeep
} from "./operador-ui.js";
import { bindOperadorRealtime } from "./operador-realtime.js";
import { bindOperadorEvents } from "./operador-events.js";
import { isPausedRegistro, getIncidenciaPayload, clearIncidenciaFields } from "./operador-actions.js";
import { syncStatusBanner } from "./operador-render.js";
import { filterTrabajosByQuery } from "./operador-trabajos.js";
import { buildKpiSnapshot } from "./operador-registros.js";
import {
  fetchMaquinas,
  fetchTrabajosAdminBoard,
  fetchMiRegistroActivo,
  rpcIniciarTrabajo,
  rpcIniciarTrabajoJuego,
  rpcPausarTrabajo,
  rpcReanudarTrabajo,
  rpcDevolverTrabajoAPlacas,
  rpcFinalizarTrabajo,
  rpcFinalizarTrabajoJuego,
  fetchMisRegistrosHoy,
  fetchOrdenById,
  fetchOrdenJuegosTR,
  fetchOrdenJuegosActivos
} from "../api.js";

const esc = escapeHtml;
const fmtDatePE = fmtDateTimePE;

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
let lastAlertedOrderIds = new Set();
let selectedOrderRequiresJuegos = false;
let selectedOrderJuegos = [];

/* =========================
   MODAL
========================= */
function openModal() {
  const w = el("modalWrap");
  if (!w) return;
  w.classList.remove("hide");
  w.setAttribute("aria-hidden", "false");
}
function closeModal() {
  const w = el("modalWrap");
  if (!w) return;
  w.classList.add("hide");
  w.setAttribute("aria-hidden", "true");
  closeIncidentModal();
}
function openIncidentModal() {
  const w = el("incidentWrap");
  if (!w) return;
  w.classList.remove("hide");
  w.setAttribute("aria-hidden", "false");
  msgInc("");
}
function closeIncidentModal() {
  const w = el("incidentWrap");
  if (!w) return;
  w.classList.add("hide");
  w.setAttribute("aria-hidden", "true");
}

function bindRealtime() {
  bindOperadorRealtime({
    supabase,
    getCurrentUser: () => currentUser,
    getLastAlertedOrderIds: () => lastAlertedOrderIds,
    showToast,
    playAlertBeep,
    loadTrabajos,
    loadHoy,
    resumeIfActive
  });
}

function buildJuegoCaraLabel(item) {
  const cara = String(item?.cara || "-");
  const juegoNum = Number(item?.juego_num || 0) || "-";
  const nombre = String(item?.nombre || "").trim();
  const nombreBase = nombre || `${cara} ${juegoNum}`;
  return nombreBase;
}

function parseJuegoCaraValue(v) {
  const raw = String(v || "");
  const [juegoPart, caraPart] = raw.split("|");
  const juegoNum = Number(juegoPart || 0);
  const cara = String(caraPart || "").toUpperCase();
  if (!juegoNum || !cara) return null;
  return { juegoNum, cara };
}

function formatSelJob(ordenId, juegoNum = null, cara = null) {
  if (!ordenId) return "Ninguno";
  if (juegoNum && cara) return `Orden ID: ${ordenId} | Juego ${juegoNum} ${cara}`;
  return `Orden ID: ${ordenId}`;
}

function normalizeJuegoEstado(v) {
  return String(v || "").trim().toUpperCase();
}

function isTipoImpresionTR(value) {
  const raw = String(value || "").trim().toUpperCase();
  return raw === "T+R" || raw === "TIRA+RETIRA";
}

function isVisibleForOperador(row) {
  const estado = String(row?.estado || "").trim().toUpperCase();
  if (estado === "PLACAS") return true;
  if (estado !== "IMPRESION") return false;
  return !!row?.requiere_juegos_placa && isTipoImpresionTR(row?.tipo_impresion);
}

async function syncJuegoCaraUI({ ordenId, requiereJuegos }) {
  const wrap = el("juegoCaraWrap");
  const sel = el("juegoCara");
  selectedOrderRequiresJuegos = !!requiereJuegos;
  selectedOrderJuegos = [];

  if (!wrap || !sel || !ordenId || !selectedOrderRequiresJuegos) {
    if (wrap) wrap.classList.add("hide");
    if (sel) sel.innerHTML = "";
    return;
  }

  const [juegos, juegosActivos] = await Promise.all([
    fetchOrdenJuegosTR(ordenId).catch(() => []),
    fetchOrdenJuegosActivos(ordenId).catch(() => [])
  ]);
  const juegosBloqueadosPorRegActivos = new Set(
    (juegosActivos || [])
      .map((x) => Number(x?.juego_num || 0))
      .filter((n) => n > 0)
  );
  const juegosOrdenados = (juegos || []).slice().sort((a, b) => {
    const jDiff = Number(a?.juego_num || 0) - Number(b?.juego_num || 0);
    if (jDiff !== 0) return jDiff;
    const rank = (v) => (String(v || "").toUpperCase() === "TIRA" ? 0 : 1);
    return rank(a?.cara) - rank(b?.cara);
  });

  // No mostrar FINALIZADO. Mostrar EN_PROCESO pero bloqueado para que el operador lo vea ocupado.
  selectedOrderJuegos = juegosOrdenados.filter((j) => normalizeJuegoEstado(j?.estado) !== "FINALIZADO");
  // Si una cara del juego esta EN_PROCESO, bloquea ambas caras del mismo juego en el combo.
  const juegosBloqueadosPorEstado = new Set(
    selectedOrderJuegos
      .filter((j) => normalizeJuegoEstado(j?.estado) === "EN_PROCESO")
      .map((j) => Number(j?.juego_num || 0))
      .filter((n) => n > 0)
  );

  const opciones = (selectedOrderJuegos || []).map((j) => {
    const value = `${j.juego_num}|${j.cara}`;
    const estado = normalizeJuegoEstado(j?.estado);
    const juegoNum = Number(j?.juego_num || 0);
    const bloqueado = estado === "EN_PROCESO"
      || juegosBloqueadosPorRegActivos.has(juegoNum)
      || juegosBloqueadosPorEstado.has(juegoNum);
    const baseLabel = buildJuegoCaraLabel(j);
    const label = bloqueado ? `${baseLabel} [BLOQUEADO]` : baseLabel;
    return `<option value="${esc(value)}" ${bloqueado ? "disabled" : ""}>${esc(label)}</option>`;
  }).join("");

  sel.innerHTML = opciones || `<option value="">Sin juegos disponibles</option>`;
  const primeraDisponible = selectedOrderJuegos.find((j) => normalizeJuegoEstado(j?.estado) !== "EN_PROCESO");
  sel.value = primeraDisponible ? `${primeraDisponible.juego_num}|${primeraDisponible.cara}` : "";
  wrap.classList.remove("hide");
}

function setModalDetails(row) {
  if (!row) {
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

async function loadModalDetails(row) {
  if (!row?.orden_id) {
    setModalDetails(row);
    await syncJuegoCaraUI({ ordenId: null, requiereJuegos: false });
    return;
  }

  try {
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
    await syncJuegoCaraUI({
      ordenId: Number((row?.orden_id ?? ord?.id) || 0),
      requiereJuegos: !!det?.requiere_juegos_placa
    });
  } catch {
    setModalDetails(row);
    await syncJuegoCaraUI({ ordenId: null, requiereJuegos: false });
  }
}

/* =========================
   KPIs
========================= */
function setKPIs() {
  const kpi = buildKpiSnapshot({ activeRegistro, maquinasMap, isPausedRegistro, fmtTimePE });

  setVal("kAct", kpi.activeLabel);
  setVal("kOrd", kpi.orderId);
  setVal("kMaq", kpi.maquina);
  setVal("kIni", kpi.inicio);

  setDisabled("btnStart", !!activeRegistro);
  setDisabled("btnPause", !activeRegistro || isPausedRegistro(activeRegistro));
  setDisabled("btnResume", !activeRegistro || !isPausedRegistro(activeRegistro));
  setDisabled("btnStop", !activeRegistro || isPausedRegistro(activeRegistro));
  setDisabled("btnReturnPlacas", !activeRegistro);

  // Si hay un trabajo activo, no se permite cambiar juego/cara hasta finalizar/devolver.
  setDisabled("juegoCara", !!activeRegistro);

  setDisabled("good", !activeRegistro);
  setDisabled("bad", !activeRegistro);
  setDisabled("obs", !activeRegistro);
  setDisabled("incMotivo", !activeRegistro);
  setDisabled("incObs", !activeRegistro);
  syncStatusBanner({ el, activeRegistro, isPausedRegistro, esc });
}

/* =========================
   DATA LOADS
========================= */
async function loadMaquinas() {
  const maquinas = await fetchMaquinas();
  const sel = el("maquina");
  if (sel) {
    sel.innerHTML = (maquinas || [])
      .map(m => `<option value="${m.id}">${esc(m.nombre)} (${esc(m.tipo)})</option>`)
      .join("");
  }
  maquinasMap = new Map((maquinas || []).map(m => [Number(m.id), m.nombre]));
}

function renderPendientes(rows) {
  const tb = el("tb");
  if (!tb) return;

  tb.innerHTML = (rows || []).map(r => {
    const formato = (r.medida_ancho && r.medida_alto) ? `${r.medida_ancho} x ${r.medida_alto}` : "-";
    const entrega = r.fecha_entrega ? fmtDatePE(r.fecha_entrega) : "-";

    const title = `title="Ver detalle y acciones"`;

    return `
      <tr style="border-left: 5px solid ${getClientColor(r.cliente_nombre)}; background-color: ${getClientBgColor(r.cliente_nombre)};">
        <td>
          <div><b>${esc(r.numero_orden_fisica || ("#" + r.orden_id))}</b></div>
          <div class="muted">
            ${esc(r.estado)} - 
            <span class="${r.prioridad === 'URGENTE' ? 'badge is-urgente' : ''}" style="${r.prioridad === 'URGENTE' ? 'color: #ef4444; font-weight: bold;' : ''}">${esc(r.prioridad)}</span>
          </div>
        </td>
        <td>${entrega}</td>
        <td>${esc(r.cliente_nombre || "-")}</td>
        <td>${esc(r.descripcion_trabajo || "-")}</td>
        <td><b>${esc(r.cantidad_solicitada || "-")}</b>${r.demasia ? `<div class="muted">+${esc(r.demasia)} demasía</div>` : ''}</td>
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

      setVal("selJob", formatSelJob(selectedOrderId));
      setVal("selEstado", selectedOrderEstado || "-");

      await loadModalDetails(selectedRow);
      openModal();

      if (activeRegistro) {
        msgR(`AVISO: Ya tienes un registro activo (Orden ${activeRegistro.orden_id}). Finalizalo primero.`);
        return;
      }

      const est = String(selectedOrderEstado || "").toUpperCase();
      const canStart = selectedOrderRequiresJuegos
        ? (est === "PLACAS" || est === "IMPRESION")
        : est === "PLACAS";
      if (!canStart) {
        msgR(selectedOrderRequiresJuegos
          ? "AVISO: Trabajo seleccionado, pero no puedes iniciar todavia.\nPara T+R solo se permite iniciar en PLACAS o IMPRESION."
          : "AVISO: Trabajo seleccionado, pero no puedes iniciar todavia.\nSolo se puede INICIAR cuando el estado es PLACAS.");
      } else {
        msgR(selectedOrderRequiresJuegos
          ? "OK Trabajo seleccionado.\nElige maquina, Juego/Cara y luego INICIAR."
          : "OK Trabajo seleccionado (PLACAS). Elige maquina y presiona INICIAR.");
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

async function loadTrabajos() {
  msgL("");

  const q = getValue("q");
  const allRows = await fetchTrabajosAdminBoard({});
  const rows = filterTrabajosByQuery(
    (allRows || []).filter((r) => isVisibleForOperador(r)),
    q
  );

  allPendientes = rows || [];
  filteredPendientes = allPendientes.slice();
  pendientesPage = 1;
  renderPendientesPage();
}

async function loadActiveRegistro() {
  activeRegistro = await fetchMiRegistroActivo(currentUser.id);
  setKPIs();

  if (activeRegistro) {
    selectedOrderId = Number(activeRegistro.orden_id);
    setVal("selJob", formatSelJob(selectedOrderId, activeRegistro?.juego_num, activeRegistro?.cara_impresion));
    setVal("selEstado", activeRegistro.estado_registro || "ACTIVO");

    openModal();
    if (isPausedRegistro(activeRegistro)) {
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


async function loadHoy() {
  const tb = el("tbHoy");
  if (!tb) return;

  msgHoy("");
  const rows = await fetchMisRegistrosHoy(currentUser.id);

  tb.innerHTML = (rows || []).map(r => {
    const maq = r.maquina_id ? (maquinasMap.get(Number(r.maquina_id)) || r.maquina_id) : "-";
    const juegoCara = r.juego_num && r.cara_impresion ? `${r.juego_num} ${r.cara_impresion}` : "-";
    return `
      <tr>
        <td><b>#${esc(r.id)}</b></td>
        <td>${esc(r.orden_id)}</td>
        <td>${esc(juegoCara)}</td>
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
async function resumeIfActive() {
  await loadActiveRegistro();
  if (!activeRegistro) return;

  openModal();

  setVal("selJob", formatSelJob(activeRegistro.orden_id, activeRegistro?.juego_num, activeRegistro?.cara_impresion));
  setVal("selEstado", activeRegistro.estado_registro || "ACTIVO");

  const row = allPendientes.find(x => Number(x.orden_id) === Number(activeRegistro.orden_id)) || { orden_id: activeRegistro.orden_id };
  await loadModalDetails(row);
  if (activeRegistro?.juego_num && activeRegistro?.cara_impresion) {
    const jc = el("juegoCara");
    if (jc) jc.value = `${activeRegistro.juego_num}|${activeRegistro.cara_impresion}`;
  }

  const sel = el("maquina");
  if (sel && activeRegistro.maquina_id) {
    sel.value = String(activeRegistro.maquina_id);
  }

  if (isPausedRegistro(activeRegistro)) {
    const inc = el("incMotivo");
    const obs = el("incObs");
    if (inc) inc.value = activeRegistro.motivo_incidencia || "";
    if (obs) obs.value = activeRegistro.obs_incidencia || "";
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
async function startRegistro() {
  msgR("");

  await loadActiveRegistro();
  if (activeRegistro) {
    msgR(`AVISO: Ya tienes un registro activo (Orden ${activeRegistro.orden_id}). Finalizalo antes de iniciar otro.`);
    openModal();
    return;
  }

  if (!selectedOrderId) {
    msgR("Selecciona un trabajo primero (boton 'Elegir').");
    return;
  }
  const estado = String(selectedOrderEstado || "").toUpperCase();
  const canStart = selectedOrderRequiresJuegos
    ? (estado === "PLACAS" || estado === "IMPRESION")
    : estado === "PLACAS";
  if (!canStart) {
    msgR(selectedOrderRequiresJuegos
      ? "No se puede iniciar.\nPara T+R este trabajo debe estar en PLACAS o IMPRESION."
      : "No se puede iniciar.\nEste trabajo no esta en PLACAS.");
    return;
  }

  const maquinaId = Number(getValue("maquina"));
  const juegoCaraSelected = parseJuegoCaraValue(getValue("juegoCara"));
  if (selectedOrderRequiresJuegos && !juegoCaraSelected) {
    msgR("Selecciona Juego y Cara antes de iniciar.");
    return;
  }

  try {
    const res = selectedOrderRequiresJuegos
      ? await rpcIniciarTrabajoJuego({
        ordenId: selectedOrderId,
        juegoNum: juegoCaraSelected?.juegoNum,
        cara: juegoCaraSelected?.cara,
        maquinaId
      })
      : await rpcIniciarTrabajo({ ordenId: selectedOrderId, maquinaId });

    activeRegistro = {
      id: res?.registro_id || res?.id,
      orden_id: selectedOrderId,
      maquina_id: maquinaId,
      hora_inicio: new Date().toISOString(),
      hora_fin: null,
      estado_registro: "ACTIVO",
      orden_juego_id: res?.orden_juego_id || null,
      juego_num: juegoCaraSelected?.juegoNum || null,
      cara_impresion: juegoCaraSelected?.cara || null,
      motivo_incidencia: null,
      obs_incidencia: null
    };
    setKPIs();
    clearIncidenciaFields(el);

    msgR(
      "OK Registro iniciado.\n" +
      `Registro ID: ${res?.registro_id ?? res?.id ?? "-"}\n` +
      `${activeRegistro?.juego_num && activeRegistro?.cara_impresion ? `Juego: ${activeRegistro.juego_num} ${activeRegistro.cara_impresion}\n` : ""}` +
      `Nuevo estado: ${res?.nuevo_estado ?? "IMPRESION"}`
    );

    await loadTrabajos();
    await loadHoy();
    await loadActiveRegistro();
    if (!activeRegistro?.id) {
      throw new Error("No se pudo confirmar el registro activo. Recarga e intenta nuevamente.");
    }
    setKPIs();
  } catch (e) {
    msgR("Error al iniciar: " + (e?.message || e));
  }

}

async function pauseRegistro() {
  msgR("");

  await loadActiveRegistro();
  if (!activeRegistro) {
    msgR("No tienes un registro activo para pausar.");
    return;
  }
  if (isPausedRegistro(activeRegistro)) {
    msgR("Este trabajo ya esta pausado.");
    return;
  }

  const { motivo, observacion } = getIncidenciaPayload(getValue);
  if (!motivo) {
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
    if (obs) obs.value = activeRegistro?.obs_incidencia || observacion || "";
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

async function resumeRegistro() {
  msgR("");

  await loadActiveRegistro();
  if (!activeRegistro) {
    msgR("No tienes un registro pausado para reanudar.");
    return;
  }
  if (!isPausedRegistro(activeRegistro)) {
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

async function stopRegistro() {
  msgR("");

  await loadActiveRegistro();
  if (!activeRegistro) {
    msgR("No tienes un registro activo para finalizar.");
    return;
  }
  if (!activeRegistro.id) {
    msgR("No se encontro el ID del registro activo. Recarga e intenta de nuevo.");
    return;
  }

  const buena = getValue("good") === "" ? null : Number(getValue("good"));
  const mala = getValue("bad") === "" ? 0 : Number(getValue("bad"));
  const obs = (getValue("obs") || "").trim() || null;

  if (buena !== null && (Number.isNaN(buena) || buena < 0)) {
    msgR("Cantidad buena invalida.");
    return;
  }
  if (Number.isNaN(mala) || mala < 0) {
    msgR("Cantidad mala invalida.");
    return;
  }

  try {
    const finishedOrderId = Number(activeRegistro?.orden_id || selectedOrderId || 0);
    const res = activeRegistro?.juego_num && activeRegistro?.cara_impresion
      ? await rpcFinalizarTrabajoJuego({
        registroId: activeRegistro.id,
        buena,
        mala,
        observaciones: obs
      })
      : await rpcFinalizarTrabajo({
        registroId: activeRegistro.id,
        buena,
        mala,
        observaciones: obs
      });

    msgR(
      "OK Registro finalizado.\n" +
      `Orden: ${res?.orden_id ?? activeRegistro?.orden_id ?? "-"}\n` +
      `${res?.juego_num && res?.cara ? `Juego: ${res.juego_num} ${res.cara}\n` : ""}` +
      `Nuevo estado: ${res?.nuevo_estado ?? "-"}`
    );

    const g = el("good"); if (g) g.value = "";
    const b = el("bad"); if (b) b.value = "";
    const o = el("obs"); if (o) o.value = "";
    clearIncidenciaFields(el);

    activeRegistro = null;
    setKPIs();

    await loadTrabajos();
    await loadHoy();
    selectedOrderId = finishedOrderId || selectedOrderId;
    selectedRow = allPendientes.find((x) => Number(x.orden_id) === Number(selectedOrderId)) || selectedRow;
    selectedOrderEstado = String(selectedRow?.estado || res?.nuevo_estado || selectedOrderEstado || "-");
    setVal("selJob", formatSelJob(selectedOrderId));
    setVal("selEstado", selectedOrderEstado);
    await loadModalDetails(selectedRow || { orden_id: selectedOrderId, estado: selectedOrderEstado });
    if (!selectedOrderRequiresJuegos) {
      selectedOrderId = null;
      selectedOrderEstado = null;
      selectedRow = null;
      setVal("selJob", "Ninguno");
      setVal("selEstado", "-");
      closeModal();
      return;
    }
    if (selectedOrderRequiresJuegos && selectedOrderJuegos.length === 0) {
      selectedOrderId = null;
      selectedOrderEstado = null;
      selectedRow = null;
      setVal("selJob", "Ninguno");
      setVal("selEstado", "-");
      closeModal();
      msgL("Orden finalizada: no hay juegos/caras disponibles.");
      return;
    }
    openModal();
  } catch (e) {
    msgR("Error al finalizar: " + (e?.message || e));
  }
}

async function returnTrabajoAPlacas() {
  msgR("");

  await loadActiveRegistro();
  if (!activeRegistro) {
    msgR("No tienes un registro activo para devolver.");
    return;
  }

  const { motivo, observacion } = getIncidenciaPayload(getValue);
  if (!motivo) {
    msgR("Selecciona un motivo de incidencia antes de devolver a PLACAS.");
    return;
  }

  try {
    await rpcDevolverTrabajoAPlacas({
      registroId: activeRegistro.id,
      motivoIncidencia: motivo,
      obsIncidencia: observacion
    });

    const g = el("good"); if (g) g.value = "";
    const b = el("bad"); if (b) b.value = "";
    const o = el("obs"); if (o) o.value = "";
    clearIncidenciaFields(el);

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
function setTab(which) {
  const secPend = el("secPend");
  const secHoy = el("secHoy");
  const tabPend = el("tabPend");
  const tabHoy = el("tabHoy");

  if (!secPend || !secHoy || !tabPend || !tabHoy) return;

  if (which === "hoy") {
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
(async function init() {
  const session = await requireOperador();
  if (!session) return;

  currentUser = session.user;
  const rawName = String(getProfileDisplayName(session.prof) || "").trim();
  const displayName = rawName && !rawName.includes("@")
    ? rawName
    : (session.prof?.rol === "ADMIN" ? "Administrador" : "Operador");
  setVal("userPill", `${displayName} | ${session.prof.rol}`);

  bindOperadorEvents({
    el,
    debounce,
    unlockAudio,
    loadTrabajos,
    getPendientesState: () => ({ filteredPendientes, pendientesPage, pendientesPageSize }),
    setPendientesState: (state) => {
      filteredPendientes = state.filteredPendientes;
      pendientesPage = state.pendientesPage;
      pendientesPageSize = state.pendientesPageSize;
    },
    renderPendientesPage,
    startRegistro,
    openIncidentModal,
    pauseRegistro,
    resumeRegistro,
    stopRegistro,
    returnTrabajoAPlacas,
    setTab,
    loadHoy,
    closeModal,
    closeIncidentModal,
    logout
  });

  await loadMaquinas();
  bindRealtime();
  await loadTrabajos();
  await loadHoy();

  await resumeIfActive();

  setKPIs();
})();


