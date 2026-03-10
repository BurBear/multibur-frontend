// app/js/api.js
import { supabase } from "../supabaseClient.js";

function isMissingRpc(err) {
  const code = String(err?.code || "");
  const msg = String(err?.message || "").toLowerCase();
  return code === "42883" || code === "PGRST202" || (msg.includes("function") && msg.includes("not found"));
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
  const runQuery = async (withObsTecnica) => {
    let q = supabase
      .from("ordenes")
      .select(`
        id,
        numero_orden_fisica,
        descripcion_trabajo,
        fecha_entrega,
        prioridad,
        estado,
        cliente:clientes(nombre),
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
          corte,
          empaquetado,
          doblez,
          compaginado,
          troquelado,
          sectorizado,
          barniz,
          plastificado,
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
  ({ data, error } = await runQuery(true));
  if (error) {
    const miss = parseMissingColumn(error);
    if (miss && miss.table === "detalles_orden" && miss.column === "observacion_tecnica") {
      ({ data, error } = await runQuery(false));
    }
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
      fecha_entrega: o.fecha_entrega || null,
      prioridad: o.prioridad || "NORMAL",
      estado: o.estado || "-",
      papel_material: det.papel_material || "",
      gramaje: det.gramaje ?? null,
      medida_ancho: det.medida_ancho ?? null,
      medida_alto: det.medida_alto ?? null,
      tipo_impresion: det.tipo_impresion || "-",
      color_text: det.color_text || "-",
      cantidad_solicitada: det.cantidad_solicitada ?? null,
      demasia: det.demasia ?? null,
      corte: !!det.corte,
      empaquetado: !!det.empaquetado,
      doblez: !!det.doblez,
      compaginado: !!det.compaginado,
      troquelado: !!det.troquelado,
      sectorizado: !!det.sectorizado,
      barniz: !!det.barniz,
      plastificado: det.plastificado || null,
      observacion_tecnica: det.observacion_tecnica || null,
      maquina_sugerida_nombre: det.maquina?.nombre || "-"
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
    .select("id, orden_id, user_id, maquina_id, hora_inicio, hora_fin, cantidad_buena, cantidad_mala")
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
    .select("id, orden_id, maquina_id, hora_inicio, hora_fin, cantidad_buena, cantidad_mala, estado_registro, motivo_incidencia")
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
  const { data, error } = await supabase
    .from("ordenes")
    .select(`
      id,
      cliente_id,
      prioridad,
      estado,
      responsable_diseno,
      descripcion_trabajo,
      observaciones_generales,
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
        observacion_tecnica,
        maquina_sugerida_id,
        maquina:maquinas(nombre)
      ),
      cliente:clientes(nombre,tipo_cliente,doc_fiscal_tipo,doc_fiscal_numero)
    `)
    .eq("id", ordenId)
    .single();

  if (error) throw error;
  return data;
}

export async function fetchOrdenesMetaByIds(orderIds = []) {
  if (!orderIds.length) return [];
  const { data, error } = await supabase
    .from("ordenes")
    .select("id, observaciones_generales")
    .in("id", orderIds);
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
    .select("id, orden_id, maquina_id, hora_inicio, hora_fin, estado_registro, hora_pausa, motivo_incidencia, obs_incidencia")
    .eq("user_id", userId)
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
  const forceFallback = Object.prototype.hasOwnProperty.call(detalles || {}, "observacion_tecnica");
  if (!forceFallback) {
    const { data: rpcData, error: rpcError } = await supabase.rpc("create_orden_con_detalles", {
      p_orden: orden,
      p_detalles: detalles
    });
    if (!rpcError && rpcData && (!Array.isArray(rpcData) || rpcData.length > 0)) {
      return Array.isArray(rpcData) ? rpcData[0] : rpcData;
    }
    if (rpcError && !isMissingRpc(rpcError)) throw rpcError;
  }

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

