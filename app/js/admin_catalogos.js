import { requireAdmin, logout, getProfileDisplayName } from "./auth.js";
import { supabase } from "./supabaseClient.js";
import { $, setText } from "./ui.js";

const msgC = (t) => setText("msgClientes", t);
const msgM = (t) => setText("msgMaquinas", t);
let clientesAll = [];
const activeTab = (new URLSearchParams(window.location.search).get("tab") || "").toLowerCase();

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
