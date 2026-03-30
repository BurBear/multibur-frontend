// app/js/api.js
import { supabase } from "../supabaseClient.js";

function isMissingRpc(err) {
  const code = String(err?.code || "");
  const msg = String(err?.message || "").toLowerCase();
  return code === "42883" || code === "PGRST202" || (msg.includes("function") && msg.includes("not found"));
}

function isRpcCompatFallbackError(err) {
  const code = String(err?.code || "");
  const msg = String(err?.message || "").toLowerCase();
  return code === "42804"
    || code === "22P02"
    || code === "42703"
    || (msg.includes("is of type") && msg.includes("expression is of type"))
    || msg.includes("invalid input value for enum");
}

function parseMissingColumn(err) {
  const msg = String(err?.message || "");
  let m = msg.match(/Could not find the '([^']+)' column of '([^']+)'/i);
  if (m) return { column: m[1], table: m[2] };
  m = msg.match(/column \"([^\"]+)\" of relation \"([^\"]+)\"/i);
  if (m) return { column: m[1], table: m[2] };
  return null;
}

export async function fetchMaquinas() {
  const { data, error } = await supabase.from("maquinas").select("id,nombre,tipo").order("id");
  if (error) throw error;
  return data || [];
}

export async function fetchClientes() {
  const { data, error } = await supabase
    .from("clientes")
    .select("id,nombre,tipo_cliente,doc_fiscal_tipo,doc_fiscal_numero,requiere_oc_default")
    .order("nombre");
  if (error) throw error;
  return data || [];
}

export async function fetchTrabajosPendientes({ estado = "" } = {}) {
  let q = supabase
    .from("v_trabajos_pendientes")
    .select("*")
    .order("prioridad_rank", { ascending: true })
    .order("fecha_entrega", { ascending: true, nullsLast: true })
    .order("orden_id", { ascending: false });

  if (estado) q = q.eq("estado", estado);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function fetchTrabajosAdminBoard({ estado = "" } = {}) {
  const runQuery = async (
    withObsTecnica,
    withJuegosPlaca,
    withExternalFlag,
    withExtendedAcabados,
    withRouteConfig,
    withRouteOwner
  ) => {
    let q = supabase
      .from("ordenes")
      .select(`
        id,
        numero_orden_fisica,
        descripcion_trabajo,
        observaciones_generales,
        fecha_entrega,
        prioridad,
        estado,
        ${withExternalFlag ? "es_externo," : ""}
        cliente:clientes(nombre,tipo_cliente),
        detalles_orden(
          orden_id,
          papel_material,
          gramaje,
          medida_ancho,
          medida_alto,
          tipo_impresion,
          color_text,
          cantidad_solicitada,
          demasia,
          ${withJuegosPlaca ? "requiere_juegos_placa,juegos_placa_total," : ""}
          corte,
          empaquetado,
          doblez,
          compaginado,
          troquelado,
          sectorizado,
          barniz,
          plastificado,
          ${withExtendedAcabados ? "encolado,marcado,anillado,perforado,perforado_tipo,pegado_solapa,semi_corte,enumerado," : ""}
          ${withRouteConfig ? "ruta_procesos," : ""}
          ${withRouteOwner ? "modulo_ruta_actual," : ""}
          ${withObsTecnica ? "observacion_tecnica," : ""}
          maquina_sugerida_id,
          maquina:maquinas(nombre)
        )
      `)
      .order("id", { ascending: false });

    if (estado) q = q.eq("estado", estado);
    else q = q.neq("estado", "ENTREGADO");

    return q;
  };

  let data = null;
  let error = null;
  let withObsTecnica = true;
  let withJuegosPlaca = true;
  let withExternalFlag = true;
  let withExtendedAcabados = true;
  let withRouteConfig = true;
  let withRouteOwner = true;

  for (let i = 0; i < 10; i += 1) {
    ({ data, error } = await runQuery(
      withObsTecnica,
      withJuegosPlaca,
      withExternalFlag,
      withExtendedAcabados,
      withRouteConfig,
      withRouteOwner
    ));
    if (!error) break;
    const miss = parseMissingColumn(error);
    if (!miss) break;
    if (miss.table === "ordenes" && miss.column === "es_externo" && withExternalFlag) {
      withExternalFlag = false;
      continue;
    }
    if (miss.table === "detalles_orden" && miss.column === "observacion_tecnica" && withObsTecnica) {
      withObsTecnica = false;
      continue;
    }
    if (miss.table === "detalles_orden" && ["requiere_juegos_placa", "juegos_placa_total", "juegos_placa_detalle"].includes(miss.column) && withJuegosPlaca) {
      withJuegosPlaca = false;
      continue;
    }
    if (miss.table === "detalles_orden" && [
      "encolado",
      "marcado",
      "anillado",
      "perforado",
      "perforado_tipo",
      "pegado_solapa",
      "semi_corte",
      "enumerado"
    ].includes(miss.column) && withExtendedAcabados) {
      withExtendedAcabados = false;
      continue;
    }
    if (miss.table === "detalles_orden" && miss.column === "ruta_procesos" && withRouteConfig) {
      withRouteConfig = false;
      continue;
    }
    if (miss.table === "detalles_orden" && miss.column === "modulo_ruta_actual" && withRouteOwner) {
      withRouteOwner = false;
      continue;
    }
    break;
  }
  if (error) throw error;

  return (data || []).map((o) => {
    const detRaw = Array.isArray(o.detalles_orden) ? o.detalles_orden[0] : o.detalles_orden;
    const det = detRaw || {};
    return {
      orden_id: o.id,
      numero_orden_fisica: o.numero_orden_fisica || `#${o.id}`,
      cliente_nombre: o.cliente?.nombre || "-",
      descripcion_trabajo: o.descripcion_trabajo || "-",
      observacion_orden: o.observaciones_generales || null,
      fecha_entrega: o.fecha_entrega || null,
      prioridad: o.prioridad || "NORMAL",
      estado: o.estado || "-",
      es_externo: !!o.es_externo,
      papel_material: det.papel_material || "",
      gramaje: det.gramaje ?? null,
      medida_ancho: det.medida_ancho ?? null,
      medida_alto: det.medida_alto ?? null,
      tipo_impresion: det.tipo_impresion || "-",
      color_text: det.color_text || "-",
      cantidad_solicitada: det.cantidad_solicitada ?? null,
      demasia: det.demasia ?? null,
      requiere_juegos_placa: !!det.requiere_juegos_placa,
      juegos_placa_total: det.juegos_placa_total ?? null,
      corte: !!det.corte,
      empaquetado: !!det.empaquetado,
      doblez: !!det.doblez,
      compaginado: !!det.compaginado,
      troquelado: !!det.troquelado,
      sectorizado: !!det.sectorizado,
      barniz: !!det.barniz,
      plastificado: det.plastificado || null,
      ruta_procesos: parseRouteProcesos(det.ruta_procesos),
      modulo_ruta_actual: det.modulo_ruta_actual || null,
      encolado: !!det.encolado,
      marcado: !!det.marcado,
      anillado: !!det.anillado,
      perforado: !!det.perforado,
      perforado_tipo: det.perforado_tipo || null,
      pegado_solapa: !!det.pegado_solapa,
      semi_corte: !!det.semi_corte,
      enumerado: !!det.enumerado,
      observacion_tecnica: det.observacion_tecnica || null,
      maquina_sugerida_nombre: det.maquina?.nombre || "-"
    };
  });
}

function processCodeToRouteKey(code) {
  switch (String(code || "").trim().toUpperCase()) {
    case "CORTE": return "corte";
    case "EMPAQUETADO": return "empaquetado";
    case "DOBLEZ": return "doblez";
    case "COMPAGINADO": return "compaginado";
    case "TROQUELADO": return "troquelado";
    case "SECTORIZADO": return "sectorizado";
    case "BARNIZ": return "barniz";
    case "PLASTIFICADO": return "plastificado";
    case "ENCOLADO": return "encolado";
    case "MARCADO": return "marcado";
    case "ANILLADO": return "anillado";
    case "PERFORADO": return "perforado";
    case "PEGADO_SOLAPA": return "pegado_solapa";
    case "SEMI_CORTE": return "semi_corte";
    case "ENUMERADO": return "enumerado";
    default: return "";
  }
}

function processCodeToDisplayLabel(code, config = {}, order = null) {
  const processCode = String(code || "").trim().toUpperCase();
  const cfg = config && typeof config === "object" ? config : {};

  switch (processCode) {
    case "CORTE": return "Corte";
    case "EMPAQUETADO": return "Empaquetado";
    case "DOBLEZ": return "Doblez";
    case "COMPAGINADO": return "Compaginado";
    case "TROQUELADO": return "Troquelado";
    case "SECTORIZADO": return "Sectorizado";
    case "BARNIZ": return "Barniz";
    case "PLASTIFICADO": {
      const modo = String(cfg.modo || order?.plastificado || "").trim().toUpperCase();
      return modo ? `Plastificado (${modo})` : "Plastificado";
    }
    case "ENCOLADO": return "Encolado";
    case "MARCADO": return "Marcado";
    case "ANILLADO": return "Anillado";
    case "PERFORADO": {
      const tipo = String(cfg.tipo || order?.perforado_tipo || "").trim().toUpperCase();
      return tipo === "PICADO_PERFORADO"
        ? "Perforado (Picado/Perforado)"
        : "Perforado";
    }
    case "PEGADO_SOLAPA": return "Pegado solapa";
    case "SEMI_CORTE": return "Semi corte";
    case "ENUMERADO": return "Enumerado";
    default: return processCode || "-";
  }
}

function routeEntryToDisplayLabel(entry, order = null) {
  const key = String(entry?.key || "").trim();
  switch (key) {
    case "corte": return "Corte";
    case "empaquetado": return "Empaquetado";
    case "doblez": return "Doblez";
    case "compaginado": return "Compaginado";
    case "troquelado": return "Troquelado";
    case "sectorizado": return "Sectorizado";
    case "barniz": return "Barniz";
    case "plastificado": {
      const mode = String(entry?.variant || order?.plastificado || "").trim().toUpperCase();
      return mode ? `Plastificado (${mode})` : "Plastificado";
    }
    case "encolado": return "Encolado";
    case "marcado": return "Marcado";
    case "anillado": return "Anillado";
    case "perforado": {
      const tipo = String(entry?.variant || order?.perforado_tipo || "").trim().toUpperCase();
      return tipo === "PICADO_PERFORADO"
        ? "Perforado (Picado/Perforado)"
        : "Perforado";
    }
    case "pegado_solapa": return "Pegado solapa";
    case "semi_corte": return "Semi corte";
    case "enumerado": return "Enumerado";
    default: return "";
  }
}

function parseRouteProcesos(raw) {
  let data = raw;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      data = null;
    }
  }
  return Array.isArray(data) ? data : [];
}

function getEffectiveSequence(order, process) {
  const routeItems = parseRouteProcesos(order?.ruta_procesos);
  const routeKey = processCodeToRouteKey(process?.proceso_codigo);
  const routeMatch = routeItems.find((item) => String(item?.key || "").trim() === routeKey);
  if (routeMatch) {
    const seq = Number(routeMatch?.order || 0);
    if (Number.isFinite(seq) && seq > 0) return seq;
  }
  const fallback = Number(process?.secuencia || 0);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 1;
}

function isClosedProcessState(status) {
  return ["FINALIZADO", "CANCELADO"].includes(String(status || "").trim().toUpperCase());
}

function getNextOpenRouteProcess(order, allProcesses = []) {
  const abiertos = (allProcesses || [])
    .filter((candidate) => !isClosedProcessState(candidate?.estado))
    .map((candidate) => ({
      ...candidate,
      __seq: getEffectiveSequence(order, candidate),
      __rank: (() => {
        const status = String(candidate?.estado || "").trim().toUpperCase();
        if (status === "EN_PROCESO") return 0;
        if (status === "PAUSADO") return 1;
        return 2;
      })()
    }))
    .sort((a, b) => (a.__seq - b.__seq) || (a.__rank - b.__rank) || (Number(a.id) - Number(b.id)));
  return abiertos[0] || null;
}

function getStoredOrDerivedRouteModule(order, allProcesses = []) {
  const explicit = String(order?.modulo_ruta_actual || "").trim().toUpperCase();
  if (["ACABADOS", "CORTADOR"].includes(explicit)) return explicit;

  const nextOpen = getNextOpenRouteProcess(order, allProcesses);
  const nextModule = String(nextOpen?.modulo_responsable || "").trim().toUpperCase();
  if (["ACABADOS", "CORTADOR"].includes(nextModule)) return nextModule;

  const routeItems = parseRouteProcesos(order?.ruta_procesos);
  const firstRouteModule = String(routeItems?.[0]?.module || "").trim().toUpperCase();
  if (["ACABADOS", "CORTADOR"].includes(firstRouteModule)) return firstRouteModule;

  return "";
}

function shouldKeepTailEmpaquetadoInCortador(order, allProcesses = [], currentModule = "", nextOpenProcess = null) {
  const routeItems = parseRouteProcesos(order?.ruta_procesos)
    .sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0));
  if (!routeItems.length) return false;

  const firstRouteItem = routeItems[0] || null;
  const lastRouteItem = routeItems[routeItems.length - 1] || null;
  if (String(firstRouteItem?.key || "").trim() !== "corte") return false;
  if (String(lastRouteItem?.key || "").trim() !== "empaquetado") return false;

  const nextOpen = nextOpenProcess || getNextOpenRouteProcess(order, allProcesses);
  if (!nextOpen) return false;
  if (String(nextOpen?.proceso_codigo || "").trim().toUpperCase() !== "EMPAQUETADO") return false;

  const current = String(currentModule || "").trim().toUpperCase();
  if (current && !["CORTADOR", "ACABADOS"].includes(current)) return false;

  return true;
}

function getCurrentRouteModule(order, allProcesses = []) {
  const currentModule = getStoredOrDerivedRouteModule(order, allProcesses);
  const nextOpenProcess = getNextOpenRouteProcess(order, allProcesses);

  if (shouldKeepTailEmpaquetadoInCortador(order, allProcesses, currentModule, nextOpenProcess)) {
    return "CORTADOR";
  }

  return currentModule;
}

function isReadyProcessBySequence(order, process, allProcesses = []) {
  const status = String(process?.estado || "").trim().toUpperCase();
  if (["EN_PROCESO", "PAUSADO"].includes(status)) return true;
  if (status !== "PENDIENTE") return false;
  const currentSeq = getEffectiveSequence(order, process);
  return !(allProcesses || []).some((candidate) => {
    if (Number(candidate?.id) === Number(process?.id)) return false;
    if (isClosedProcessState(candidate?.estado)) return false;
    return getEffectiveSequence(order, candidate) < currentSeq;
  });
}

function isVisibleProcessForModule(order, process, allProcesses = [], moduleName, currentModule, nextOpenProcess) {
  const targetModule = String(moduleName || "").trim().toUpperCase();
  const processModule = String(process?.modulo_responsable || "").trim().toUpperCase();
  const current = String(currentModule || "").trim().toUpperCase();
  const status = String(process?.estado || "").trim().toUpperCase();

  if (processModule !== targetModule) return false;
  if (current !== targetModule) return false;

  if (["EN_PROCESO", "PAUSADO"].includes(status)) return true;
  if (status !== "PENDIENTE") return false;

  if (!isReadyProcessBySequence(order, process, allProcesses)) return false;

  const nextSeq = nextOpenProcess ? getEffectiveSequence(order, nextOpenProcess) : null;
  const currentSeq = getEffectiveSequence(order, process);
  if (nextSeq == null) return true;
  return currentSeq === nextSeq;
}

function buildVisibleProcessesForModule(order, allProcesses = [], moduleName, currentModule, nextOpenProcess) {
  const targetModule = String(moduleName || "").trim().toUpperCase();
  const current = String(currentModule || "").trim().toUpperCase();
  const moduleProcesos = (allProcesses || []).filter(
    (process) => String(process?.modulo_responsable || "").trim().toUpperCase() === targetModule
  );
  const sameOperatorTailEmpaquetado = targetModule === "CORTADOR"
    && shouldKeepTailEmpaquetadoInCortador(order, allProcesses, current, nextOpenProcess);

  const visibleMap = new Map();

  for (const process of moduleProcesos) {
    const status = String(process?.estado || "").trim().toUpperCase();
    if (["EN_PROCESO", "PAUSADO"].includes(status)) {
      visibleMap.set(Number(process.id), process);
    }
  }

  if (
    current === targetModule
    && nextOpenProcess
    && String(nextOpenProcess?.modulo_responsable || "").trim().toUpperCase() === targetModule
  ) {
    const forced = moduleProcesos.find((process) => Number(process.id) === Number(nextOpenProcess.id));
    if (forced) {
      visibleMap.set(Number(forced.id), forced);
    }
  }

  if (sameOperatorTailEmpaquetado && nextOpenProcess?.id != null) {
    visibleMap.set(Number(nextOpenProcess.id), nextOpenProcess);
  }

  for (const process of moduleProcesos) {
    if (isVisibleProcessForModule(order, process, allProcesses, targetModule, currentModule, nextOpenProcess)) {
      visibleMap.set(Number(process.id), process);
    }
  }

  return Array.from(visibleMap.values()).sort((a, b) => {
    const seqDiff = getEffectiveSequence(order, a) - getEffectiveSequence(order, b);
    if (seqDiff !== 0) return seqDiff;
    return Number(a.id) - Number(b.id);
  });
}

function buildAdminRouteStatus(order, allProcesses = []) {
  const routeItems = parseRouteProcesos(order?.ruta_procesos)
    .sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0));
  const firstRouteItem = routeItems[0] || null;
  const currentRouteModule = getCurrentRouteModule(order, allProcesses);
  const nextOpenProcess = getNextOpenRouteProcess(order, allProcesses);
  const nextModule = String(nextOpenProcess?.modulo_responsable || "").trim().toUpperCase();
  const nextStatus = String(nextOpenProcess?.estado || "").trim().toUpperCase();
  const sameOperatorTailEmpaquetado = shouldKeepTailEmpaquetadoInCortador(
    order,
    allProcesses,
    currentRouteModule,
    nextOpenProcess
  );
  const nextProcessLabel = nextOpenProcess
    ? processCodeToDisplayLabel(nextOpenProcess.proceso_codigo, nextOpenProcess.configuracion, order)
    : (firstRouteItem ? routeEntryToDisplayLabel(firstRouteItem, order) : null);
  const nextProcessLabelUpper = String(nextProcessLabel || "").trim().toUpperCase();
  const requiresHandoff = !!currentRouteModule
    && !!nextOpenProcess
    && !!nextModule
    && currentRouteModule !== nextModule
    && !sameOperatorTailEmpaquetado;
  const routeAllClosed = allProcesses.length > 0 && !nextOpenProcess;
  const pendingModule = String(
    (sameOperatorTailEmpaquetado ? "CORTADOR" : nextModule)
    || firstRouteItem?.module
    || currentRouteModule
    || "ACABADOS"
  ).trim().toUpperCase();

  let routeStagePrimary = null;
  let routeStageSecondary = null;
  let routeBadgeLabel = null;
  let routeBadgeTone = "ready";

  if (routeAllClosed) {
    routeStagePrimary = "Terminado";
    routeStageSecondary = "Listo para entregar";
    routeBadgeLabel = "Listo para entregar";
    routeBadgeTone = "done";
  } else if (sameOperatorTailEmpaquetado && nextStatus === "PENDIENTE") {
    routeStagePrimary = nextProcessLabel || "Empaquetado";
    routeStageSecondary = "Pendiente en CORTADOR";
    routeBadgeLabel = "Listo para empaquetado";
    routeBadgeTone = "cut-ready";
  } else if (requiresHandoff) {
    routeStagePrimary = nextProcessLabel || (nextModule === "CORTADOR" ? "Corte" : "Acabado");
    routeStageSecondary = nextModule === "CORTADOR"
      ? "Listo para mandar a corte"
      : "Listo para mandar a acabados";
    routeBadgeLabel = nextModule === "CORTADOR"
      ? "Listo para corte"
      : "Listo para acabados";
    routeBadgeTone = nextModule === "CORTADOR" ? "cut-ready" : "route-ready";
  } else if (nextStatus === "PAUSADO") {
    routeStagePrimary = nextProcessLabel || (currentRouteModule === "CORTADOR" ? "Corte" : "Acabado");
    routeStageSecondary = currentRouteModule === "CORTADOR"
      ? "Pausado en CORTADOR"
      : "Pausado en ACABADOS";
    routeBadgeLabel = nextProcessLabelUpper
      ? `PAUSADO: ${nextProcessLabelUpper}`
      : (currentRouteModule === "CORTADOR" ? "Corte pausado" : "Acabado pausado");
    routeBadgeTone = "paused";
  } else if (nextStatus === "EN_PROCESO") {
    routeStagePrimary = nextProcessLabel || (currentRouteModule === "CORTADOR" ? "Corte" : "Acabado");
    routeStageSecondary = currentRouteModule === "CORTADOR"
      ? "Trabajando en CORTADOR"
      : "Trabajando en ACABADOS";
    routeBadgeLabel = nextProcessLabelUpper
      ? `EN: ${nextProcessLabelUpper}`
      : (currentRouteModule === "CORTADOR" ? "EN: CORTE" : "EN: ACABADOS");
    routeBadgeTone = currentRouteModule === "CORTADOR" ? "cutting" : "route-active";
  } else if (pendingModule === "CORTADOR") {
    routeStagePrimary = nextProcessLabel || "Corte";
    routeStageSecondary = "Pendiente en CORTADOR";
    routeBadgeLabel = "Listo para corte";
    routeBadgeTone = "cut-ready";
  } else {
    routeStagePrimary = nextProcessLabel || "Acabado";
    routeStageSecondary = "Pendiente en ACABADOS";
    routeBadgeLabel = "Listo para acabados";
    routeBadgeTone = "route-ready";
  }

  return {
    route_current_module: currentRouteModule || null,
    route_next_process_id: nextOpenProcess?.id ?? null,
    route_next_process_codigo: nextOpenProcess?.proceso_codigo ?? null,
    route_next_process_label: nextProcessLabel,
    route_next_process_modulo: nextModule || null,
    route_next_process_estado: nextStatus || null,
    route_all_closed: routeAllClosed,
    route_requires_handoff: requiresHandoff,
    route_stage_primary: routeStagePrimary,
    route_stage_secondary: routeStageSecondary,
    route_badge_label: routeBadgeLabel,
    route_badge_tone: routeBadgeTone
  };
}

export async function fetchOrdenProcesosAcabadosByOrdenIds(orderIds = []) {
  if (!orderIds.length) return [];
  const { data, error } = await supabase
    .from("orden_procesos")
    .select("id,orden_id,proceso_codigo,modulo_responsable,estado,secuencia,configuracion,observaciones,assigned_user_id,started_at,finished_at,created_at,updated_at")
    .in("orden_id", orderIds)
    .order("orden_id", { ascending: true })
    .order("secuencia", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchRouteBoardSnapshot(moduleName, { userId = null } = {}) {
  const targetModule = String(moduleName || "").trim().toUpperCase();
  const orders = await fetchTrabajosAdminBoard({ estado: "ACABADOS" });
  if (!orders.length) return [];

  const orderIds = [...new Set(orders.map((o) => Number(o.orden_id)).filter(Boolean))];
  const procesos = await fetchOrdenProcesosAcabadosByOrdenIds(orderIds);
  const assignedIds = [...new Set((procesos || []).map((p) => p.assigned_user_id).filter(Boolean))];
  const profiles = await fetchProfilesByIds(assignedIds);
  const profileMap = new Map(
    (profiles || []).map((p) => [
      p.id,
      String(p.nombre_completo || p.username || "").trim() || "-"
    ])
  );

  const procesosByOrden = new Map();
  for (const proceso of procesos || []) {
    const oid = Number(proceso.orden_id);
    const bucket = procesosByOrden.get(oid) || [];
    bucket.push({
      ...proceso,
      assigned_user_nombre: proceso.assigned_user_id
        ? (profileMap.get(proceso.assigned_user_id) || "-")
        : "-"
    });
    procesosByOrden.set(oid, bucket);
  }

  return orders.map((order) => {
    const allProcesos = procesosByOrden.get(Number(order.orden_id)) || [];
    const currentRouteModule = getCurrentRouteModule(order, allProcesos);
    const nextOpenProcess = getNextOpenRouteProcess(order, allProcesos);
    const sameOperatorTailEmpaquetado = shouldKeepTailEmpaquetadoInCortador(
      order,
      allProcesos,
      currentRouteModule,
      nextOpenProcess
    );
    const moduleProcesos = allProcesos.filter((p) => String(p.modulo_responsable || "").toUpperCase() === targetModule);
    const visibleProcesos = buildVisibleProcessesForModule(
      order,
      allProcesos,
      targetModule,
      currentRouteModule,
      nextOpenProcess
    );
    const handoffTargetModule = nextOpenProcess
      ? String(nextOpenProcess.modulo_responsable || "").trim().toUpperCase()
      : "";
    const requiresHandoff = currentRouteModule === targetModule
      && !!nextOpenProcess
      && handoffTargetModule
      && handoffTargetModule !== targetModule
      && !sameOperatorTailEmpaquetado;

    return {
      ...order,
      modulo_ruta_actual: currentRouteModule || order.modulo_ruta_actual || null,
      procesos: visibleProcesos,
      procesos_todos: moduleProcesos,
      procesos_ruta: allProcesos,
      next_process_id: nextOpenProcess?.id ?? null,
      next_process_codigo: nextOpenProcess?.proceso_codigo ?? null,
      next_process_modulo: handoffTargetModule || null,
      same_operator_tail_empaquetado: sameOperatorTailEmpaquetado,
      requires_handoff: !!requiresHandoff,
      handoff_target_module: requiresHandoff ? handoffTargetModule : null,
      handoff_target_label: requiresHandoff
        ? (handoffTargetModule === "CORTADOR" ? "Mandar a corte" : "Mandar a acabados")
        : null,
      is_my_order: !!userId && visibleProcesos.some(
        (p) => p.assigned_user_id && p.assigned_user_id === userId
      )
    };
  });
}

export async function fetchAcabadosBoardSnapshot({ userId = null } = {}) {
  return fetchRouteBoardSnapshot("ACABADOS", { userId });
}

export async function fetchCortadorBoardSnapshot({ userId = null } = {}) {
  return fetchRouteBoardSnapshot("CORTADOR", { userId });
}

export async function fetchTrabajosAdminBoardSnapshot({ estado = "" } = {}) {
  const orders = await fetchTrabajosAdminBoard({ estado });
  if (!orders.length) return [];

  const orderIds = [...new Set(orders.map((o) => Number(o.orden_id)).filter(Boolean))];
  const procesos = await fetchOrdenProcesosAcabadosByOrdenIds(orderIds);
  const procesosByOrden = new Map();

  for (const proceso of procesos || []) {
    const oid = Number(proceso.orden_id);
    const bucket = procesosByOrden.get(oid) || [];
    bucket.push(proceso);
    procesosByOrden.set(oid, bucket);
  }

  return orders.map((order) => {
    const allProcesos = procesosByOrden.get(Number(order.orden_id)) || [];
    return {
      ...order,
      ...buildAdminRouteStatus(order, allProcesos)
    };
  });
}

function peruDayWindowUtc(daysFromToday = 0) {
  const peruOffsetMs = -5 * 60 * 60 * 1000;
  const pseudoPeruNow = new Date(Date.now() + peruOffsetMs);

  const y = pseudoPeruNow.getUTCFullYear();
  const m = pseudoPeruNow.getUTCMonth();
  const d = pseudoPeruNow.getUTCDate() + daysFromToday;

  const startUtc = new Date(Date.UTC(y, m, d, 5, 0, 0, 0));
  const endUtc = new Date(Date.UTC(y, m, d + 1, 5, 0, 0, 0));
  return { startIso: startUtc.toISOString(), endIso: endUtc.toISOString() };
}

function peruDateInputToUtcStart(dateStr) {
  const [y, m, d] = String(dateStr || "").split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d, 5, 0, 0, 0)).toISOString();
}

function peruDateInputToUtcEndExclusive(dateStr) {
  const [y, m, d] = String(dateStr || "").split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d + 1, 5, 0, 0, 0)).toISOString();
}

export async function fetchRegistros({
  preset = "today",
  fromDate = "",
  toDate = "",
  ordenId = null,
  userId = "",
  limit = 200
} = {}) {
  let startIso = null;
  let endIso = null;

  if (preset === "today") {
    ({ startIso, endIso } = peruDayWindowUtc(0));
  } else if (preset === "yesterday") {
    ({ startIso, endIso } = peruDayWindowUtc(-1));
  } else if (preset === "custom") {
    startIso = peruDateInputToUtcStart(fromDate);
    endIso = peruDateInputToUtcEndExclusive(toDate || fromDate);
  }

  let q = supabase
    .from("registro_produccion")
    .select("id, orden_id, user_id, maquina_id, hora_inicio, hora_fin, cantidad_buena, cantidad_mala, orden_juego_id, juego_num, cara_impresion")
    .order("hora_inicio", { ascending: false })
    .limit(limit);

  if (startIso && endIso) {
    q = q.or(`and(hora_inicio.gte.${startIso},hora_inicio.lt.${endIso}),hora_fin.is.null`);
  } else if (startIso) {
    q = q.or(`hora_inicio.gte.${startIso},hora_fin.is.null`);
  } else if (endIso) {
    q = q.or(`hora_inicio.lt.${endIso},hora_fin.is.null`);
  }

  if (ordenId) q = q.eq("orden_id", ordenId);
  if (userId) q = q.eq("user_id", userId);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function fetchUltimasIncidenciasByOrdenIds(orderIds = []) {
  if (!orderIds.length) return [];
  const { data, error } = await supabase
    .from("registro_produccion")
    .select("id, orden_id, user_id, estado_registro, motivo_incidencia, obs_incidencia, hora_pausa, hora_inicio, hora_fin")
    .in("orden_id", orderIds)
    .in("estado_registro", ["PAUSADO", "DEVUELTO"])
    .order("hora_fin", { ascending: false, nullsFirst: false })
    .order("hora_pausa", { ascending: false, nullsFirst: false })
    .order("hora_inicio", { ascending: false });
  if (error) throw error;

  const latest = new Map();
  for (const row of data || []) {
    if (!latest.has(row.orden_id)) latest.set(row.orden_id, row);
  }
  return Array.from(latest.values());
}

export async function fetchUltimosEstadosProduccionByOrdenIds(orderIds = []) {
  if (!orderIds.length) return [];
  const { data, error } = await supabase
    .from("registro_produccion")
    .select("id, orden_id, estado_registro, hora_inicio, hora_fin, pausado_en")
    .in("orden_id", orderIds)
    .in("estado_registro", ["ACTIVO", "PAUSADO", "DEVUELTO"])
    .order("hora_fin", { ascending: false, nullsFirst: true })
    .order("pausado_en", { ascending: false, nullsFirst: false })
    .order("hora_inicio", { ascending: false });
  if (error) throw error;

  const latest = new Map();
  for (const row of data || []) {
    if (!latest.has(row.orden_id)) latest.set(row.orden_id, row);
  }
  return Array.from(latest.values());
}

export async function fetchProfilesByIds(ids = []) {
  if (!ids.length) return [];
  const { data, error } = await supabase.from("profiles").select("id,username,nombre_completo").in("id", ids);
  if (error) throw error;
  return data || [];
}

export async function fetchMaquinasByIds(ids = []) {
  if (!ids.length) return [];
  const { data, error } = await supabase.from("maquinas").select("id,nombre").in("id", ids);
  if (error) throw error;
  return data || [];
}

export async function fetchMisRegistrosHoy(userId) {
  const now = new Date();
  const peNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Lima" }));
  const peStart = new Date(peNow);
  peStart.setHours(0, 0, 0, 0);
  const peEnd = new Date(peStart);
  peEnd.setDate(peEnd.getDate() + 1);

  const { data, error } = await supabase
    .from("registro_produccion")
    .select("id, orden_id, maquina_id, hora_inicio, hora_fin, cantidad_buena, cantidad_mala, estado_registro, motivo_incidencia, juego_num, cara_impresion")
    .eq("user_id", userId)
    .gte("hora_inicio", peStart.toISOString())
    .lt("hora_inicio", peEnd.toISOString())
    .order("hora_inicio", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function fetchOrdenResumenByIds(orderIds = []) {
  if (!orderIds.length) return [];
  const { data, error } = await supabase.from("v_trabajos_pendientes").select("*").in("orden_id", orderIds);
  if (error) throw error;
  return data || [];
}

export async function fetchOrdenesProduccionByIds(orderIds = []) {
  if (!orderIds.length) return [];
  const { data, error } = await supabase
    .from("ordenes")
    .select(`
      id,
      numero_orden_fisica,
      descripcion_trabajo,
      cliente:clientes(nombre),
      detalles_orden(tipo_impresion,cantidad_solicitada,demasia)
    `)
    .in("id", orderIds);
  if (error) throw error;
  return (data || []).map((o) => {
    const det = Array.isArray(o.detalles_orden) ? o.detalles_orden[0] : o.detalles_orden;
    return {
      orden_id: o.id,
      numero_orden_fisica: o.numero_orden_fisica || `#${o.id}`,
      cliente_nombre: o.cliente?.nombre || "-",
      cliente_tipo: o.cliente?.tipo_cliente || "-",
      descripcion_trabajo: o.descripcion_trabajo || "-",
      tipo_impresion: det?.tipo_impresion || null,
      cantidad_solicitada: det?.cantidad_solicitada ?? null,
      demasia: det?.demasia ?? null
    };
  });
}

export async function fetchOrdenJuegosByIds(ids = []) {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from("orden_juegos_tr")
    .select("id,orden_id,juego_num,cara,nombre")
    .in("id", ids);
  if (error) throw error;
  return data || [];
}

export async function fetchClienteTiposByOrdenIds(orderIds = []) {
  if (!orderIds.length) return [];
  const { data, error } = await supabase
    .from("ordenes")
    .select("id, cliente:clientes(tipo_cliente)")
    .in("id", orderIds);
  if (error) throw error;
  return data || [];
}

export async function fetchOrdenById(ordenId) {
  const runQuery = async (
    withJuegosPlaca,
    withExternalFlag,
    withExtendedAcabados,
    withRouteConfig,
    withRouteOwner
  ) => supabase
    .from("ordenes")
    .select(`
      id,
      cliente_id,
      prioridad,
      estado,
      responsable_diseno,
      descripcion_trabajo,
      observaciones_generales,
      ${withExternalFlag ? "es_externo," : ""}
      fecha_entrega,
      tiene_oc,
      oc_numero,
      oc_observacion,
      tiene_guia,
      guia_numero,
      guia_observacion,
      detalles_orden(
        material_id,
        formato_id,
        papel_material,
        gramaje,
        medida_ancho,
        medida_alto,
        tipo_impresion,
        color_mode,
        color_text,
        cantidad_solicitada,
        demasia,
        corte,
        empaquetado,
        doblez,
        compaginado,
        troquelado,
        sectorizado,
        barniz,
        plastificado,
        ${withExtendedAcabados ? "encolado,marcado,anillado,perforado,perforado_tipo,pegado_solapa,semi_corte,enumerado," : ""}
        ${withRouteConfig ? "ruta_procesos," : ""}
        ${withRouteOwner ? "modulo_ruta_actual," : ""}
        observacion_tecnica,
        ${withJuegosPlaca ? "requiere_juegos_placa,juegos_placa_total,juegos_placa_detalle," : ""}
        maquina_sugerida_id,
        maquina:maquinas(nombre)
      ),
      cliente:clientes(nombre,tipo_cliente,doc_fiscal_tipo,doc_fiscal_numero)
    `)
    .eq("id", ordenId)
    .single();

  let data = null;
  let error = null;
  let withJuegosPlaca = true;
  let withExternalFlag = true;
  let withExtendedAcabados = true;
  let withRouteConfig = true;
  let withRouteOwner = true;
  for (let i = 0; i < 10; i += 1) {
    ({ data, error } = await runQuery(
      withJuegosPlaca,
      withExternalFlag,
      withExtendedAcabados,
      withRouteConfig,
      withRouteOwner
    ));
    if (!error) break;
    const miss = parseMissingColumn(error);
    if (!miss) break;
    if (miss.table === "ordenes" && miss.column === "es_externo" && withExternalFlag) {
      withExternalFlag = false;
      continue;
    }
    if (miss.table === "detalles_orden" && ["requiere_juegos_placa", "juegos_placa_total", "juegos_placa_detalle"].includes(miss.column) && withJuegosPlaca) {
      withJuegosPlaca = false;
      continue;
    }
    if (miss.table === "detalles_orden" && [
      "encolado",
      "marcado",
      "anillado",
      "perforado",
      "perforado_tipo",
      "pegado_solapa",
      "semi_corte",
      "enumerado"
    ].includes(miss.column) && withExtendedAcabados) {
      withExtendedAcabados = false;
      continue;
    }
    if (miss.table === "detalles_orden" && miss.column === "ruta_procesos" && withRouteConfig) {
      withRouteConfig = false;
      continue;
    }
    if (miss.table === "detalles_orden" && miss.column === "modulo_ruta_actual" && withRouteOwner) {
      withRouteOwner = false;
      continue;
    }
    break;
  }

  if (error) throw error;
  return data;
}

export async function fetchOrdenesMetaByIds(orderIds = []) {
  if (!orderIds.length) return [];
  let { data, error } = await supabase
    .from("ordenes")
    .select("id, observaciones_generales, es_externo")
    .in("id", orderIds);
  if (error) {
    const miss = parseMissingColumn(error);
    if (miss && miss.table === "ordenes" && miss.column === "es_externo") {
      ({ data, error } = await supabase
        .from("ordenes")
        .select("id, observaciones_generales")
        .in("id", orderIds));
    }
  }
  if (error) throw error;
  return data || [];
}

export async function rpcIniciarTrabajo({ ordenId, maquinaId }) {
  const { data, error } = await supabase.rpc("iniciar_trabajo", {
    p_orden_id: ordenId,
    p_maquina_id: maquinaId
  });
  if (error) throw error;
  return data?.[0];
}

export async function fetchMiRegistroActivo(userId) {
  const { data, error } = await supabase
    .from("registro_produccion")
    .select("id, orden_id, maquina_id, hora_inicio, hora_fin, estado_registro, hora_pausa, pausado_en, motivo_incidencia, obs_incidencia, motivo_pausa, obs_pausa, orden_juego_id, juego_num, cara_impresion, buena_reportada, mala_reportada")
    .eq("user_id", userId)
    .eq("estado_registro", "ACTIVO")
    .is("hora_fin", null)
    .order("hora_inicio", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function rpcFinalizarTrabajo({ registroId, buena, mala, observaciones = null }) {
  const { data, error } = await supabase.rpc("finalizar_trabajo", {
    p_registro_id: registroId,
    p_buena: buena,
    p_mala: mala,
    p_observaciones: observaciones
  });
  if (error) throw error;
  return data?.[0];
}

export async function fetchOrdenJuegosTR(ordenId) {
  const { data, error } = await supabase
    .from("orden_juegos_tr")
    .select("id,orden_id,juego_num,cara,nombre,cantidad_objetivo,estado")
    .eq("orden_id", ordenId)
    .order("juego_num", { ascending: true })
    .order("cara", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function fetchOrdenJuegosActivos(ordenId) {
  const { data, error } = await supabase
    .from("registro_produccion")
    .select("juego_num,cara_impresion")
    .eq("orden_id", ordenId)
    .eq("estado_registro", "ACTIVO")
    .is("hora_fin", null)
    .not("juego_num", "is", null);
  if (error) throw error;
  return data || [];
}

export async function fetchRegistrosPausadosDisponibles() {
  const { data: pausados, error } = await supabase
    .from("registro_produccion")
    .select("id,orden_id,user_id,maquina_id,orden_juego_id,juego_num,cara_impresion,flujo_trabajo_id,motivo_pausa,obs_pausa,hora_inicio,pausado_en,hora_fin,estado_registro")
    .eq("estado_registro", "PAUSADO")
    .not("hora_fin", "is", null)
    .order("pausado_en", { ascending: false, nullsLast: true })
    .order("id", { ascending: false });

  if (error) throw error;
  const rows = pausados || [];
  if (!rows.length) return [];

  const pausedIds = rows.map((r) => Number(r.id)).filter(Boolean);
  if (!pausedIds.length) return rows;

  const { data: retomados, error: retError } = await supabase
    .from("registro_produccion")
    .select("retoma_de_registro_id")
    .in("retoma_de_registro_id", pausedIds);

  if (retError) throw retError;

  const retomadosSet = new Set(
    (retomados || [])
      .map((r) => Number(r?.retoma_de_registro_id || 0))
      .filter((n) => n > 0)
  );

  return rows.filter((r) => !retomadosSet.has(Number(r.id)));
}

export async function rpcIniciarTrabajoJuego({ ordenId, juegoNum, cara, maquinaId }) {
  const { data, error } = await supabase.rpc("iniciar_trabajo_juego", {
    p_orden_id: ordenId,
    p_juego_num: juegoNum,
    p_cara: cara,
    p_maquina_id: maquinaId
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function rpcFinalizarTrabajoJuego({ registroId, buena, mala, observaciones = null }) {
  const { data, error } = await supabase.rpc("finalizar_trabajo_juego", {
    p_registro_id: registroId,
    p_buena: buena,
    p_mala: mala,
    p_observaciones: observaciones
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function rpcPausarTrabajo({ registroId, motivoIncidencia, obsIncidencia = null }) {
  const { data, error } = await supabase.rpc("pausar_trabajo", {
    p_registro_id: registroId,
    p_motivo_incidencia: motivoIncidencia,
    p_obs_incidencia: obsIncidencia
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function rpcDevolverTrabajoAPlacas({ registroId, motivoIncidencia, obsIncidencia = null }) {
  const { data, error } = await supabase.rpc("devolver_trabajo_a_placas", {
    p_registro_id: registroId,
    p_motivo_incidencia: motivoIncidencia,
    p_obs_incidencia: obsIncidencia
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function rpcReanudarTrabajo({ registroId }) {
  const { data, error } = await supabase.rpc("reanudar_trabajo", {
    p_registro_id: registroId
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function rpcRetomarTrabajo({ registroId, maquinaId = null }) {
  const { data, error } = await supabase.rpc("retomar_trabajo", {
    p_registro_id: registroId,
    p_maquina_id: maquinaId
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function rpcRegistrarIncidenciaProduccion({ registroId, motivo, observacion = null }) {
  const { data, error } = await supabase.rpc("registrar_incidencia_produccion", {
    p_registro_id: registroId,
    p_motivo: motivo,
    p_observacion: observacion
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function rpcEnsureOrdenProcesosAcabados({ ordenId }) {
  const { data, error } = await supabase.rpc("ensure_orden_procesos_acabados", {
    p_orden_id: ordenId
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function rpcRecalcularEstadoOrdenAcabados({ ordenId }) {
  const { data, error } = await supabase.rpc("recalcular_estado_orden_acabados", {
    p_orden_id: ordenId
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function rpcIniciarProcesoAcabado({ procesoId }) {
  const { data, error } = await supabase.rpc("iniciar_proceso_acabado", {
    p_proceso_id: procesoId
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function rpcPausarProcesoAcabado({ procesoId, observaciones = null }) {
  const { data, error } = await supabase.rpc("pausar_proceso_acabado", {
    p_proceso_id: procesoId,
    p_observaciones: observaciones
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function rpcRetomarProcesoAcabado({ procesoId }) {
  const { data, error } = await supabase.rpc("retomar_proceso_acabado", {
    p_proceso_id: procesoId
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function rpcFinalizarProcesoAcabado({ procesoId, observaciones = null }) {
  const { data, error } = await supabase.rpc("finalizar_proceso_acabado", {
    p_proceso_id: procesoId,
    p_observaciones: observaciones
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function rpcTransferirOrdenRuta({ ordenId, moduloDestino }) {
  const { data, error } = await supabase.rpc("transferir_orden_ruta", {
    p_orden_id: ordenId,
    p_modulo_destino: moduloDestino
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function rpcIniciarProcesoCortador({ procesoId }) {
  const { data, error } = await supabase.rpc("iniciar_proceso_cortador", {
    p_proceso_id: procesoId
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function rpcPausarProcesoCortador({ procesoId, observaciones = null }) {
  const { data, error } = await supabase.rpc("pausar_proceso_cortador", {
    p_proceso_id: procesoId,
    p_observaciones: observaciones
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function rpcRetomarProcesoCortador({ procesoId }) {
  const { data, error } = await supabase.rpc("retomar_proceso_cortador", {
    p_proceso_id: procesoId
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function rpcFinalizarProcesoCortador({ procesoId, observaciones = null }) {
  const { data, error } = await supabase.rpc("finalizar_proceso_cortador", {
    p_proceso_id: procesoId,
    p_observaciones: observaciones
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function rpcFinalizarEntregaOrden({
  ordenId,
  userId = null,
  obsEntrega = null,
  tieneGuia = false,
  guiaNumero = null,
  guiaObservacion = null
}) {
  const { data, error } = await supabase.rpc("finalizar_entrega_orden", {
    p_orden_id: ordenId,
    p_user_id: userId,
    p_obs_entrega: obsEntrega,
    p_tiene_guia: tieneGuia,
    p_guia_numero: guiaNumero,
    p_guia_observacion: guiaObservacion
  });
  if (error) {
    if (isMissingRpc(error)) return null;
    throw error;
  }
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

export async function createOrdenConDetalles({ orden, detalles }) {
  const { data: rpcData, error: rpcError } = await supabase.rpc("create_orden_con_detalles_v2", {
    p_orden: orden,
    p_detalles: detalles
  });
  if (!rpcError && rpcData && (!Array.isArray(rpcData) || rpcData.length > 0)) {
    return Array.isArray(rpcData) ? rpcData[0] : rpcData;
  }
  if (rpcError && !isMissingRpc(rpcError) && !isRpcCompatFallbackError(rpcError)) throw rpcError;

  let ordenPayload = { ...orden };
  let o = null;
  for (let i = 0; i < 10; i++) {
    const { data, error } = await supabase.from("ordenes").insert([ordenPayload]).select("id,numero_orden_fisica,fecha_entrega").single();
    if (!error) {
      o = {
        id: data?.id,
        numero_orden_fisica: data?.numero_orden_fisica || null,
        fecha_entrega: data?.fecha_entrega || null
      };
      break;
    }
    const miss = parseMissingColumn(error);
    if (miss && miss.table === "ordenes" && Object.prototype.hasOwnProperty.call(ordenPayload, miss.column)) {
      delete ordenPayload[miss.column];
      continue;
    }
    throw error;
  }
  if (!o) throw new Error("No se pudo insertar en ordenes por incompatibilidad de columnas.");

  try {
    const { data: ordMeta } = await supabase.from("ordenes").select("id,numero_orden_fisica,fecha_entrega").eq("id", o.id).single();
    if (ordMeta?.numero_orden_fisica) o.numero_orden_fisica = ordMeta.numero_orden_fisica;
    if (ordMeta?.fecha_entrega) o.fecha_entrega = ordMeta.fecha_entrega;
  } catch {
    // continue
  }

  let det = {
    ...detalles,
    orden_id: o.id,
    material_id: detalles.material_id ?? null,
    formato_id: detalles.formato_id ?? null,
    maquina_sugerida_id: detalles.maquina_sugerida_id ?? null
  };

  let e2 = null;
  for (let i = 0; i < 20; i++) {
    const ins = await supabase.from("detalles_orden").insert([det]);
    if (!ins.error) {
      e2 = null;
      break;
    }
    const miss = parseMissingColumn(ins.error);
    if (miss && miss.table === "detalles_orden" && Object.prototype.hasOwnProperty.call(det, miss.column)) {
      delete det[miss.column];
      continue;
    }
    e2 = ins.error;
    break;
  }

  if (e2) {
    const { error: rollbackError } = await supabase.from("ordenes").delete().eq("id", o.id);
    if (rollbackError) {
      throw new Error(
        `Fallo al insertar detalles y tambien fallo el rollback de la orden ${o.id}. ` +
        `Detalle: ${e2.message}. Rollback: ${rollbackError.message}`
      );
    }
    throw e2;
  }

  return o;
}

export async function updateOrdenConDetalles({ ordenId, orden, detalles }) {
  const oid = Number(ordenId);
  if (!oid) throw new Error("ordenId invalido para actualizar.");

  let ordenPayload = { ...(orden || {}) };
  for (let i = 0; i < 10; i++) {
    const { error } = await supabase.from("ordenes").update(ordenPayload).eq("id", oid);
    if (!error) break;
    const miss = parseMissingColumn(error);
    if (miss && miss.table === "ordenes" && Object.prototype.hasOwnProperty.call(ordenPayload, miss.column)) {
      delete ordenPayload[miss.column];
      continue;
    }
    throw error;
  }

  const { data: detailAny, error: detailAnyErr } = await supabase
    .from("detalles_orden")
    .select("orden_id")
    .eq("orden_id", oid)
    .limit(1);
  if (detailAnyErr) throw detailAnyErr;

  let detPayload = {
    ...(detalles || {}),
    orden_id: oid,
    material_id: detalles?.material_id ?? null,
    formato_id: detalles?.formato_id ?? null,
    maquina_sugerida_id: detalles?.maquina_sugerida_id ?? null
  };

  const hasExistingDetail = Array.isArray(detailAny) && detailAny.length > 0;
  for (let i = 0; i < 20; i++) {
    const resp = hasExistingDetail
      ? await supabase.from("detalles_orden").update(detPayload).eq("orden_id", oid)
      : await supabase.from("detalles_orden").insert([detPayload]);
    if (!resp.error) break;
    const miss = parseMissingColumn(resp.error);
    if (miss && miss.table === "detalles_orden" && Object.prototype.hasOwnProperty.call(detPayload, miss.column)) {
      delete detPayload[miss.column];
      continue;
    }
    throw resp.error;
  }

  const { data: ordMeta, error: ordMetaErr } = await supabase
    .from("ordenes")
    .select("id,numero_orden_fisica,fecha_entrega")
    .eq("id", oid)
    .single();
  if (ordMetaErr) throw ordMetaErr;
  return ordMeta;
}

export async function fetchReporteEntregados({
  dateFrom = "",
  dateTo = "",
  clienteId = null,
  limit = 1000,
  q = ""
} = {}) {
  let oq = supabase
    .from("ordenes")
    .select("id,numero_orden_fisica,cliente_id,descripcion_trabajo,fecha_entrega,prioridad,estado,created_at,responsable_diseno,fecha_entregado,entregado_por,obs_entrega,tiene_oc,oc_numero,oc_observacion,tiene_guia,guia_numero,guia_observacion")
    .eq("estado", "ENTREGADO")
    .order("fecha_entregado", { ascending: false, nullsLast: true })
    .limit(limit);

  if (clienteId) oq = oq.eq("cliente_id", Number(clienteId));
  if (dateFrom) oq = oq.gte("fecha_entregado", `${dateFrom}T00:00:00`);
  if (dateTo) oq = oq.lte("fecha_entregado", `${dateTo}T23:59:59`);

  const { data: ordenes, error: e1 } = await oq;
  if (e1) throw e1;
  const rows = ordenes || [];
  if (!rows.length) return [];

  const ordenIds = [...new Set(rows.map((o) => Number(o.id)).filter(Boolean))];
  const clienteIds = [...new Set(rows.map((o) => Number(o.cliente_id)).filter(Boolean))];

  const [{ data: detalles, error: e2 }, { data: clientes, error: e3 }] = await Promise.all([
    supabase
      .from("detalles_orden")
      .select("orden_id,papel_material,gramaje,medida_ancho,medida_alto,tipo_impresion,color_text,maquina_sugerida_id,cantidad_solicitada")
      .in("orden_id", ordenIds),
    supabase
      .from("clientes")
      .select("id,nombre,tipo_cliente,doc_fiscal_tipo,doc_fiscal_numero")
      .in("id", clienteIds)
  ]);
  if (e2) throw e2;
  if (e3) throw e3;

  const maqIds = [...new Set((detalles || []).map((d) => Number(d.maquina_sugerida_id)).filter(Boolean))];
  const { data: maqs, error: e4 } = await supabase.from("maquinas").select("id,nombre").in("id", maqIds);
  if (e4) throw e4;

  const detMap = new Map((detalles || []).map((d) => [Number(d.orden_id), d]));
  const cliMap = new Map((clientes || []).map((c) => [Number(c.id), c]));
  const maqMap = new Map((maqs || []).map((m) => [Number(m.id), m.nombre]));

  let out = rows.map((o) => {
    const d = detMap.get(Number(o.id)) || {};
    return {
      id: o.id,
      numero_orden_fisica: o.numero_orden_fisica || `#${o.id}`,
      cliente: cliMap.get(Number(o.cliente_id))?.nombre || "-",
      cliente_tipo: cliMap.get(Number(o.cliente_id))?.tipo_cliente || "-",
      cliente_doc_tipo: cliMap.get(Number(o.cliente_id))?.doc_fiscal_tipo || "-",
      cliente_doc_numero: cliMap.get(Number(o.cliente_id))?.doc_fiscal_numero || "-",
      trabajo: o.descripcion_trabajo || "-",
      fecha_entrega: o.fecha_entrega || null,
      fecha_creacion: o.created_at || null,
      fecha_entregado: o.fecha_entregado || null,
      entregado_por: o.entregado_por || null,
      obs_entrega: o.obs_entrega || "",
      tiene_oc: !!o.tiene_oc,
      oc_numero: o.oc_numero || "",
      oc_observacion: o.oc_observacion || "",
      tiene_guia: !!o.tiene_guia,
      guia_numero: o.guia_numero || "",
      guia_observacion: o.guia_observacion || "",
      prioridad: o.prioridad || "-",
      papel_material: d.papel_material || "-",
      gramaje: d.gramaje ?? null,
      formato: (d.medida_ancho && d.medida_alto) ? `${d.medida_ancho} x ${d.medida_alto}` : "-",
      tipo_impresion: d.tipo_impresion || "-",
      color: d.color_text || "-",
      maquina: maqMap.get(Number(d.maquina_sugerida_id)) || "-",
      cantidad: d.cantidad_solicitada ?? null,
      responsable_diseno: o.responsable_diseno || "-"
    };
  });

  const n = String(q || "").trim().toLowerCase();
  if (n) {
    out = out.filter((r) =>
      [
        r.numero_orden_fisica,
        r.cliente,
        r.trabajo,
        r.formato,
        r.tipo_impresion,
        r.color,
        r.maquina,
        r.responsable_diseno
      ].join(" ").toLowerCase().includes(n)
    );
  }
  return out;
}

