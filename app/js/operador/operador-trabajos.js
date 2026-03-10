export function filterTrabajosByQuery(rows, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return rows || [];
  return (rows || []).filter((r) => {
    const source = [
      r.numero_orden_fisica,
      r.cliente_nombre,
      r.descripcion_trabajo,
      r.estado,
      r.tipo_impresion,
      r.color_text,
      r.maquina_sugerida_nombre
    ].join(" ").toLowerCase();
    return source.includes(q);
  });
}
