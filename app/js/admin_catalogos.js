import { requireAdmin, logout, getProfileDisplayName } from "./auth.js";
import { supabase } from "./supabaseClient.js";
import { $, setText } from "./ui.js";

const msgC = (t) => setText("msgClientes", t);
const msgM = (t) => setText("msgMaquinas", t);
let clientesAll = [];
const activeTab = (new URLSearchParams(window.location.search).get("tab") || "").toLowerCase();
const CLIENTE_CSV_HEADERS = [
  "nombre",
  "contacto",
  "telefono",
  "tipo_cliente",
  "doc_fiscal_tipo",
  "doc_fiscal_numero",
  "requiere_oc_default"
];

function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));
}

function norm(s){
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeTipoCliente(v){
  const t = String(v || "").trim().toUpperCase();
  if (t === "SERVICIO_IMPRESION") return "SERVICIO";
  return t || "DIRECTO";
}

function normalizeDocTipo(v) {
  const t = String(v || "").trim().toUpperCase();
  if (t === "RUC" || t === "SUR") return t;
  return "RUC";
}

function parseBool(v) {
  const t = String(v ?? "").trim().toLowerCase();
  return t === "1" || t === "true" || t === "si" || t === "s" || t === "yes" || t === "y";
}

function normalizeHeader(h) {
  const n = String(h || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const map = {
    tipo: "tipo_cliente",
    tipo_cliente: "tipo_cliente",
    tipo_de_cliente: "tipo_cliente",
    doc_tipo: "doc_fiscal_tipo",
    tipo_doc: "doc_fiscal_tipo",
    doc_fiscal_tipo: "doc_fiscal_tipo",
    nro_doc: "doc_fiscal_numero",
    numero_doc: "doc_fiscal_numero",
    doc_numero: "doc_fiscal_numero",
    doc_fiscal_numero: "doc_fiscal_numero",
    requiere_oc: "requiere_oc_default",
    requiere_oc_default: "requiere_oc_default"
  };
  return map[n] || n;
}

function splitCsvLine(line, delimiter) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

function detectDelimiter(text) {
  const first = String(text || "").split(/\r?\n/).find((l) => l.trim());
  if (!first) return ",";
  const commaCount = (first.match(/,/g) || []).length;
  const semiCount = (first.match(/;/g) || []).length;
  return semiCount > commaCount ? ";" : ",";
}

function parseCsv(text) {
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return [];
  const delimiter = detectDelimiter(text);
  const headersRaw = splitCsvLine(lines[0], delimiter);
  const headers = headersRaw.map(normalizeHeader);
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i], delimiter);
    const row = {};
    headers.forEach((h, idx) => { row[h] = cols[idx] ?? ""; });
    row.__line = i + 1;
    rows.push(row);
  }
  return rows;
}

function csvValue(v, delimiter) {
  const raw = String(v ?? "");
  if (!raw.includes('"') && !raw.includes("\n") && !raw.includes("\r") && !raw.includes(delimiter)) {
    return raw;
  }
  return `"${raw.replace(/"/g, '""')}"`;
}

function pickCsvCliente(row) {
  return {
    __line: row.__line,
    nombre: String(row.nombre || "").trim(),
    contacto: String(row.contacto || "").trim() || null,
    telefono: String(row.telefono || "").trim() || null,
    tipo_cliente: normalizeTipoCliente(row.tipo_cliente || "DIRECTO"),
    doc_fiscal_tipo: normalizeDocTipo(row.doc_fiscal_tipo || "RUC"),
    doc_fiscal_numero: String(row.doc_fiscal_numero || "").trim() || null,
    requiere_oc_default: parseBool(row.requiere_oc_default)
  };
}

function downloadClientesCurrentCsv() {
  const delimiter = ";";
  const rows = (clientesAll || []).map((c) => ([
    c.nombre || "",
    c.contacto || "",
    c.telefono || "",
    normalizeTipoCliente(c.tipo_cliente || "DIRECTO"),
    c.doc_fiscal_tipo || "RUC",
    c.doc_fiscal_numero || "",
    c.requiere_oc_default ? "true" : "false"
  ]));
  const lines = [
    CLIENTE_CSV_HEADERS.join(delimiter),
    ...rows.map((r) => r.map((v) => csvValue(v, delimiter)).join(delimiter))
  ].join("\r\n");

  const blob = new Blob(["\uFEFF", lines], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "clientes_multibur_export.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  msgC(`CSV exportado: ${rows.length} cliente(s).`);
}

async function importClientesFromFile(file) {
  msgC("");
  if (!file) return;
  const text = await file.text();
  const rawRows = parseCsv(text);
  if (!rawRows.length) {
    msgC("Archivo vacio o sin filas validas.");
    return;
  }

  const selectedRows = rawRows.map(pickCsvCliente);
  const invalid = [];
  const prepared = [];
  const seen = new Set();

  selectedRows.forEach((r) => {
    if (!r.nombre) {
      invalid.push(`Linea ${r.__line}: falta nombre.`);
      return;
    }
    const key = r.doc_fiscal_numero
      ? `doc:${r.doc_fiscal_numero.toUpperCase()}`
      : `nom:${norm(r.nombre)}`;
    if (seen.has(key)) {
      invalid.push(`Linea ${r.__line}: duplicado dentro del archivo (${key}).`);
      return;
    }
    seen.add(key);
    prepared.push(r);
  });

  const existingByDoc = new Map();
  const existingByName = new Map();
  (clientesAll || []).forEach((c) => {
    const doc = String(c.doc_fiscal_numero || "").trim();
    const nom = norm(c.nombre || "");
    if (doc) existingByDoc.set(doc.toUpperCase(), c);
    if (nom) existingByName.set(nom, c);
  });

  const toInsert = [];
  const toUpdate = [];
  prepared.forEach((r) => {
    const target = r.doc_fiscal_numero
      ? existingByDoc.get(r.doc_fiscal_numero.toUpperCase())
      : existingByName.get(norm(r.nombre));
    if (!target) {
      toInsert.push({
        nombre: r.nombre,
        contacto: r.contacto,
        telefono: r.telefono,
        tipo_cliente: r.tipo_cliente,
        doc_fiscal_tipo: r.doc_fiscal_tipo,
        doc_fiscal_numero: r.doc_fiscal_numero,
        requiere_oc_default: r.requiere_oc_default
      });
      return;
    }
    toUpdate.push({
      id: target.id,
      nombre: r.nombre,
      contacto: r.contacto,
      telefono: r.telefono,
      tipo_cliente: r.tipo_cliente,
      doc_fiscal_tipo: r.doc_fiscal_tipo,
      doc_fiscal_numero: r.doc_fiscal_numero,
      requiere_oc_default: r.requiere_oc_default
    });
  });

  let inserted = 0;
  let updated = 0;
  const dbErrors = [];

  if (toInsert.length) {
    const { error } = await supabase.from("clientes").insert(toInsert);
    if (error) {
      dbErrors.push(`Insert: ${error.message}`);
    } else {
      inserted = toInsert.length;
    }
  }

  for (const row of toUpdate) {
    const { id, ...payload } = row;
    const { error } = await supabase.from("clientes").update(payload).eq("id", id);
    if (error) {
      dbErrors.push(`Update ID ${id}: ${error.message}`);
    } else {
      updated += 1;
    }
  }

  await loadClientes();
  const summary = [
    `Archivo: ${file.name}`,
    `Filas leidas: ${rawRows.length}`,
    `Validas: ${prepared.length}`,
    `Insertadas: ${inserted}`,
    `Actualizadas: ${updated}`,
    `Con error: ${invalid.length + dbErrors.length}`
  ];
  if (invalid.length) summary.push(`\nErrores de validacion:\n- ${invalid.join("\n- ")}`);
  if (dbErrors.length) summary.push(`\nErrores de BD:\n- ${dbErrors.join("\n- ")}`);
  msgC(summary.join("\n"));
}

function renderClientesTable(rows){
  $("tbClientes").innerHTML = (rows || []).map(c => `
    <tr data-id="${c.id}">
      <td>${c.id}</td>
      <td><input class="c_nombre w-100" value="${esc(c.nombre)}"></td>
      <td><input class="c_contacto w-100" value="${esc(c.contacto)}"></td>
      <td><input class="c_telefono w-100" value="${esc(c.telefono)}"></td>
      <td>
        <select class="c_tipo_cliente">
          <option value="DIRECTO" ${normalizeTipoCliente(c.tipo_cliente) === "DIRECTO" ? "selected" : ""}>DIRECTO</option>
          <option value="SERVICIO" ${normalizeTipoCliente(c.tipo_cliente) === "SERVICIO" ? "selected" : ""}>SERVICIO</option>
        </select>
      </td>
      <td>
        <select class="c_doc_tipo">
          <option value="RUC" ${c.doc_fiscal_tipo === "RUC" ? "selected" : ""}>RUC</option>
          <option value="SUR" ${c.doc_fiscal_tipo === "SUR" ? "selected" : ""}>SUR</option>
        </select>
      </td>
      <td><input class="c_doc_numero w-100" value="${esc(c.doc_fiscal_numero)}"></td>
      <td style="text-align:center"><input class="c_req_oc" type="checkbox" ${c.requiere_oc_default ? "checked" : ""}></td>
      <td class="cell-actions">
        <button class="btn btn-ghost btnSaveCliente">Guardar</button>
        <button class="btn btn-danger btnDelCliente">Eliminar</button>
      </td>
    </tr>
  `).join("");
}

function applyClientesFilter(){
  const q = norm($("c_filter")?.value || "");
  const rows = q
    ? clientesAll.filter(c => norm(`${c.nombre} ${c.contacto || ""} ${c.telefono || ""} ${c.tipo_cliente || ""} ${c.doc_fiscal_tipo || ""} ${c.doc_fiscal_numero || ""}`).includes(q))
    : clientesAll;
  renderClientesTable(rows);
  msgC(`Clientes: ${rows.length} / ${clientesAll.length}`);
}

async function loadClientes(){
  msgC("");
  const { data, error } = await supabase
    .from("clientes")
    .select("id,nombre,contacto,telefono,tipo_cliente,doc_fiscal_tipo,doc_fiscal_numero,requiere_oc_default")
    .order("id", { ascending:false });

  if(error){ msgC("Error cargando clientes: " + error.message); return; }

  clientesAll = data || [];
  applyClientesFilter();
}

async function addCliente(){
  msgC("");
  const nombre = $("c_nombre").value.trim();
  const contacto = $("c_contacto").value.trim() || null;
  const telefono = $("c_telefono").value.trim() || null;
  const tipo_cliente = normalizeTipoCliente($("c_tipo_cliente").value || "DIRECTO");
  const doc_fiscal_tipo = $("c_doc_tipo").value || "RUC";
  const doc_fiscal_numero = $("c_doc_numero").value.trim() || null;
  const requiere_oc_default = $("c_req_oc").checked;

  if(!nombre){ msgC("Falta nombre de cliente."); return; }

  const { error } = await supabase
    .from("clientes")
    .insert([{ nombre, contacto, telefono, tipo_cliente, doc_fiscal_tipo, doc_fiscal_numero, requiere_oc_default }]);

  if(error){ msgC("No pude crear cliente: " + error.message); return; }

  $("c_nombre").value = "";
  $("c_contacto").value = "";
  $("c_telefono").value = "";
  $("c_doc_numero").value = "";
  $("c_tipo_cliente").value = "DIRECTO";
  $("c_doc_tipo").value = "RUC";
  $("c_req_oc").checked = false;

  msgC("OK Cliente creado.");
  await loadClientes();
}

async function saveCliente(tr){
  msgC("");
  const id = Number(tr.dataset.id);
  const nombre = tr.querySelector(".c_nombre").value.trim();
  const contacto = tr.querySelector(".c_contacto").value.trim() || null;
  const telefono = tr.querySelector(".c_telefono").value.trim() || null;
  const tipo_cliente = normalizeTipoCliente(tr.querySelector(".c_tipo_cliente").value || "DIRECTO");
  const doc_fiscal_tipo = tr.querySelector(".c_doc_tipo").value || "RUC";
  const doc_fiscal_numero = tr.querySelector(".c_doc_numero").value.trim() || null;
  const requiere_oc_default = !!tr.querySelector(".c_req_oc").checked;

  if(!nombre){ msgC("Falta nombre de cliente."); return; }

  const { error } = await supabase
    .from("clientes")
    .update({ nombre, contacto, telefono, tipo_cliente, doc_fiscal_tipo, doc_fiscal_numero, requiere_oc_default })
    .eq("id", id);

  if(error){ msgC("No pude guardar: " + error.message); return; }

  msgC("OK Cliente actualizado.");
}

async function delCliente(tr){
  msgC("");
  const id = Number(tr.dataset.id);

  if(!confirm(`Eliminar cliente ID ${id}?`)) return;

  const { error } = await supabase
    .from("clientes")
    .delete()
    .eq("id", id);

  if(error){ msgC("No pude eliminar: " + error.message); return; }

  msgC("OK Cliente eliminado.");
  await loadClientes();
}

// ------------------- MAQUINAS -------------------

async function loadMaquinas(){
  msgM("");
  const { data, error } = await supabase
    .from("maquinas")
    .select("id,nombre,tipo")
    .order("id", { ascending:false });

  if(error){ msgM("Error cargando maquinas: " + error.message); return; }

  $("tbMaquinas").innerHTML = (data || []).map(m => `
    <tr data-id="${m.id}">
      <td>${m.id}</td>
      <td><input class="m_nombre w-100" value="${esc(m.nombre)}"></td>
      <td>
        <select class="m_tipo">
          <option value="OFFSET" ${m.tipo==="OFFSET"?"selected":""}>OFFSET</option>
          <option value="DIGITAL" ${m.tipo==="DIGITAL"?"selected":""}>DIGITAL</option>
        </select>
      </td>
      <td class="cell-actions">
        <button class="btn btn-ghost btnSaveMaquina">Guardar</button>
        <button class="btn btn-danger btnDelMaquina">Eliminar</button>
      </td>
    </tr>
  `).join("");

  msgM(`Maquinas: ${(data||[]).length}`);
}

async function addMaquina(){
  msgM("");
  const nombre = $("m_nombre").value.trim();
  const tipo = $("m_tipo").value;

  if(!nombre){ msgM("Falta nombre de maquina."); return; }

  const { error } = await supabase
    .from("maquinas")
    .insert([{ nombre, tipo }]);

  if(error){ msgM("No pude crear maquina: " + error.message); return; }

  $("m_nombre").value = "";
  msgM("OK Maquina creada.");
  await loadMaquinas();
}

async function saveMaquina(tr){
  msgM("");
  const id = Number(tr.dataset.id);
  const nombre = tr.querySelector(".m_nombre").value.trim();
  const tipo = tr.querySelector(".m_tipo").value;

  if(!nombre){ msgM("Falta nombre de maquina."); return; }

  const { error } = await supabase
    .from("maquinas")
    .update({ nombre, tipo })
    .eq("id", id);

  if(error){ msgM("No pude guardar: " + error.message); return; }

  msgM("OK Maquina actualizada.");
}

async function delMaquina(tr){
  msgM("");
  const id = Number(tr.dataset.id);

  if(!confirm(`Eliminar maquina ID ${id}?`)) return;

  const { error } = await supabase
    .from("maquinas")
    .delete()
    .eq("id", id);

  if(error){ msgM("No pude eliminar: " + error.message); return; }

  msgM("OK Maquina eliminada.");
  await loadMaquinas();
}

// ------------------- INIT + EVENT DELEGATION -------------------

function wireEventos(){
  $("btnLogout").addEventListener("click", async () => {
    await logout();
    window.location.href = "./login.html";
  });

  $("btnReloadClientes").addEventListener("click", loadClientes);
  $("btnExportClientes").addEventListener("click", downloadClientesCurrentCsv);
  $("btnImportClientes").addEventListener("click", () => $("c_import_file")?.click());
  $("c_import_file").addEventListener("change", async (ev) => {
    const file = ev?.target?.files?.[0];
    await importClientesFromFile(file);
    ev.target.value = "";
  });
  $("btnAddCliente").addEventListener("click", addCliente);
  $("c_filter").addEventListener("input", applyClientesFilter);

  $("btnReloadMaquinas").addEventListener("click", loadMaquinas);
  $("btnAddMaquina").addEventListener("click", addMaquina);

  // Delegacion: clientes
  $("tbClientes").addEventListener("click", async (e) => {
    const tr = e.target.closest("tr");
    if(!tr) return;

    if(e.target.classList.contains("btnSaveCliente")) await saveCliente(tr);
    if(e.target.classList.contains("btnDelCliente")) await delCliente(tr);
  });

  // Delegacion: maquinas
  $("tbMaquinas").addEventListener("click", async (e) => {
    const tr = e.target.closest("tr");
    if(!tr) return;

    if(e.target.classList.contains("btnSaveMaquina")) await saveMaquina(tr);
    if(e.target.classList.contains("btnDelMaquina")) await delMaquina(tr);
  });
}

function applyTabView() {
  const secCli = $("sectionClientes");
  const secMaq = $("sectionMaquinas");
  const title = $("viewTitle");
  const sub = $("viewSub");

  if (activeTab === "clientes") {
    if (secMaq) secMaq.style.display = "none";
    if (title) title.textContent = "Clientes";
    if (sub) sub.textContent = "Admin - Gestion de clientes";
  } else if (activeTab === "maquinas") {
    if (secCli) secCli.style.display = "none";
    if (title) title.textContent = "Maquinas";
    if (sub) sub.textContent = "Admin - Gestion de maquinas";
  } else {
    if (title) title.textContent = "Catalogos";
    if (sub) sub.textContent = "Admin - Clientes y Maquinas";
  }
}

(async function init(){
  const prof = await requireAdmin();
  if(!prof) return;

  setText("userPill", `${getProfileDisplayName(prof)} - ${prof.rol}`);
  applyTabView();

  wireEventos();
  if (activeTab === "clientes") {
    await loadClientes();
  } else if (activeTab === "maquinas") {
    await loadMaquinas();
  } else {
    await Promise.all([loadClientes(), loadMaquinas()]);
  }
})();
