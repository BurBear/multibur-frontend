import { requireAdmin, logout, getProfileDisplayName } from "./auth.js";
import { supabase } from "./supabaseClient.js";
import { $, setText } from "./ui.js";

const msgMat = (t) => setText("msgMat", t);
const msgFor = (t) => setText("msgFor", t);
let materialesAll = [];
let materialesFiltered = [];
let materialesPage = 1;
let materialesPageSize = 20;
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

function renderMaterialesTable(rows){
  $("tbMat").innerHTML = (rows||[]).map(m => `
    <tr data-id="${m.id}">
      <td>${m.id}</td>
      <td><input class="m_nombre w-100" value="${esc(m.nombre)}"></td>
      <td><input class="m_gramaje w-100" type="number" min="0" value="${esc(m.gramaje)}"></td>
      <td><input class="m_proveedor w-100" value="${esc(m.proveedor)}"></td>
      <td>
        <button class="btn btn-ghost btnSaveMat">Guardar</button>
        <button class="btn btn-danger btnDelMat">Eliminar</button>
      </td>
    </tr>
  `).join("");
}

function renderMaterialesPage() {
  const total = materialesFiltered.length;
  const totalPages = Math.max(1, Math.ceil(total / materialesPageSize));
  materialesPage = Math.min(materialesPage, totalPages);
  const start = (materialesPage - 1) * materialesPageSize;
  const end = start + materialesPageSize;
  const pageRows = materialesFiltered.slice(start, end);

  renderMaterialesTable(pageRows);

  const from = total ? start + 1 : 0;
  const to = Math.min(end, total);
  setText("mat_stats", `Mostrando ${from}-${to} de ${total} (total: ${materialesAll.length})`);
  setText("mat_page_info", `${materialesPage} / ${totalPages}`);

  const prev = $("btnMatPrev");
  const next = $("btnMatNext");
  if (prev) prev.disabled = materialesPage <= 1;
  if (next) next.disabled = materialesPage >= totalPages;
}

function applyMaterialesFilter(){
  const q = norm($("mat_filter")?.value || "");
  materialesFiltered = q
    ? materialesAll.filter(m => norm(`${m.nombre} ${m.gramaje || ""} ${m.proveedor || ""}`).includes(q))
    : materialesAll;
  materialesPage = 1;
  renderMaterialesPage();
  msgMat(`Materiales filtrados: ${materialesFiltered.length} / ${materialesAll.length}`);
}

/* =======================
   MATERIALES
======================= */
async function loadMateriales(){
  msgMat("");
  const { data, error } = await supabase
    .from("materiales")
    .select("id,nombre,gramaje,proveedor")
    .order("id", { ascending:false });

  if(error){ msgMat("Error cargando materiales: " + error.message); return; }

  materialesAll = data || [];
  materialesFiltered = materialesAll.slice();
  applyMaterialesFilter();
}

async function addMaterial(){
  msgMat("");

  const nombre = $("mat_nombre").value.trim();
  const gramaje = $("mat_gramaje").value ? Number($("mat_gramaje").value) : null;
  const proveedor = $("mat_prov").value.trim() || null;
  if(!nombre) return msgMat("Falta nombre.");
  if(!gramaje && gramaje !== 0) return msgMat("Falta gramaje.");

  const { error } = await supabase
    .from("materiales")
    .insert([{ nombre, gramaje, proveedor }]);

  if(error){ msgMat("No pude crear: " + error.message); return; }

  $("mat_nombre").value = "";
  $("mat_gramaje").value = "";
  $("mat_prov").value = "";
  msgMat("OK Material creado.");
  await loadMateriales();
}

async function saveMaterial(tr){
  msgMat("");

  const id = Number(tr.dataset.id);
  const nombre = tr.querySelector(".m_nombre").value.trim();
  const gramaje = tr.querySelector(".m_gramaje").value ? Number(tr.querySelector(".m_gramaje").value) : null;
  const proveedor = tr.querySelector(".m_proveedor").value.trim() || null;

  if(!nombre) return msgMat("Falta nombre.");
  if(gramaje === null) return msgMat("Falta gramaje.");

  const { error } = await supabase
    .from("materiales")
    .update({ nombre, gramaje, proveedor })
    .eq("id", id);

  if(error){ msgMat("No pude guardar: " + error.message); return; }

  msgMat("OK Material actualizado.");
}

async function delMaterial(tr){
  msgMat("");
  const id = Number(tr.dataset.id);
  if(!confirm(`Eliminar material ID ${id}?`)) return;

  const { error } = await supabase.from("materiales").delete().eq("id", id);
  if(error){ msgMat("No pude eliminar: " + error.message); return; }

  msgMat("OK Material eliminado.");
  await loadMateriales();
}

/* =======================
   FORMATOS
======================= */
async function loadFormatos(){
  msgFor("");
  const { data, error } = await supabase
    .from("formatos")
    .select("id,nombre,ancho,alto,notas")
    .order("id", { ascending:false });

  if(error){ msgFor("Error cargando formatos: " + error.message); return; }

  $("tbFor").innerHTML = (data||[]).map(f => `
    <tr data-id="${f.id}">
      <td>${f.id}</td>
      <td><input class="f_nombre w-100" value="${esc(f.nombre)}"></td>
      <td><input class="f_ancho w-100" type="number" step="0.01" value="${esc(f.ancho)}"></td>
      <td><input class="f_alto w-100" type="number" step="0.01" value="${esc(f.alto)}"></td>
      <td>
        <button class="btn btn-ghost btnSaveFor">Guardar</button>
        <button class="btn btn-danger btnDelFor">Eliminar</button>
      </td>
    </tr>
  `).join("");

  msgFor(`Formatos: ${(data||[]).length}`);
}

async function addFormato(){
  msgFor("");

  const nombre = $("for_nombre").value.trim() || null;
  const ancho = $("for_ancho").value ? Number($("for_ancho").value) : null;
  const alto = $("for_alto").value ? Number($("for_alto").value) : null;
  const notas = $("for_notas").value.trim() || null;

  if(ancho === null) return msgFor("Falta ancho.");
  if(alto === null) return msgFor("Falta alto.");

  const finalNombre = nombre || `${ancho} x ${alto}`;

  const { error } = await supabase
    .from("formatos")
    .insert([{ nombre: finalNombre, ancho, alto, notas }]);

  if(error){ msgFor("No pude crear: " + error.message); return; }

  $("for_nombre").value = "";
  $("for_ancho").value = "";
  $("for_alto").value = "";
  $("for_notas").value = "";

  msgFor("OK Formato creado.");
  await loadFormatos();
}

async function saveFormato(tr){
  msgFor("");

  const id = Number(tr.dataset.id);
  const nombre = tr.querySelector(".f_nombre").value.trim() || null;
  const ancho = tr.querySelector(".f_ancho").value ? Number(tr.querySelector(".f_ancho").value) : null;
  const alto = tr.querySelector(".f_alto").value ? Number(tr.querySelector(".f_alto").value) : null;

  if(ancho === null) return msgFor("Falta ancho.");
  if(alto === null) return msgFor("Falta alto.");

  const finalNombre = nombre || `${ancho} x ${alto}`;

  const { error } = await supabase
    .from("formatos")
    .update({ nombre: finalNombre, ancho, alto })
    .eq("id", id);

  if(error){ msgFor("No pude guardar: " + error.message); return; }

  msgFor("OK Formato actualizado.");
}

async function delFormato(tr){
  msgFor("");
  const id = Number(tr.dataset.id);
  if(!confirm(`Eliminar formato ID ${id}?`)) return;

  const { error } = await supabase.from("formatos").delete().eq("id", id);
  if(error){ msgFor("No pude eliminar: " + error.message); return; }

  msgFor("OK Formato eliminado.");
  await loadFormatos();
}

/* =======================
   INIT + EVENTS
======================= */
function wire(){
  $("btnLogout").addEventListener("click", async () => {
    await logout();
    window.location.href = "./login.html";
  });

  $("btnReloadMat").addEventListener("click", loadMateriales);
  $("btnAddMat").addEventListener("click", addMaterial);
  $("mat_filter").addEventListener("input", applyMaterialesFilter);
  $("mat_page_size").addEventListener("change", () => {
    materialesPageSize = Number($("mat_page_size").value || 20);
    materialesPage = 1;
    renderMaterialesPage();
  });
  $("btnMatPrev").addEventListener("click", () => {
    if (materialesPage <= 1) return;
    materialesPage -= 1;
    renderMaterialesPage();
  });
  $("btnMatNext").addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(materialesFiltered.length / materialesPageSize));
    if (materialesPage >= totalPages) return;
    materialesPage += 1;
    renderMaterialesPage();
  });

  $("btnReloadFor").addEventListener("click", loadFormatos);
  $("btnAddFor").addEventListener("click", addFormato);

  $("tbMat").addEventListener("click", async (e) => {
    const tr = e.target.closest("tr");
    if(!tr) return;
    if(e.target.classList.contains("btnSaveMat")) await saveMaterial(tr);
    if(e.target.classList.contains("btnDelMat")) await delMaterial(tr);
  });

  $("tbFor").addEventListener("click", async (e) => {
    const tr = e.target.closest("tr");
    if(!tr) return;
    if(e.target.classList.contains("btnSaveFor")) await saveFormato(tr);
    if(e.target.classList.contains("btnDelFor")) await delFormato(tr);
  });
}

function applyTabView() {
  const secMat = $("sectionMateriales");
  const secFor = $("sectionFormatos");
  const title = $("viewTitle");
  const sub = $("viewSub");

  if (activeTab === "materiales") {
    if (secFor) secFor.style.display = "none";
    if (title) title.textContent = "Materiales";
    if (sub) sub.textContent = "Admin - Gestion de materiales";
  } else if (activeTab === "formatos") {
    if (secMat) secMat.style.display = "none";
    if (title) title.textContent = "Formatos";
    if (sub) sub.textContent = "Admin - Gestion de formatos";
  } else {
    if (title) title.textContent = "Materiales & Formatos";
    if (sub) sub.textContent = "Admin - Catalogo real para autocompletar ordenes";
  }
}

(async function init(){
  const prof = await requireAdmin();
  if(!prof) return;

  const rawName = String(getProfileDisplayName(prof) || "").trim();
  const displayName = rawName && !rawName.includes("@")
    ? rawName
    : (prof?.rol === "ADMIN" ? "Administrador" : "Usuario");
  setText("userPill", `${displayName} | ${prof.rol}`);
  applyTabView();
  wire();

  if (activeTab === "materiales") {
    await loadMateriales();
  } else if (activeTab === "formatos") {
    await loadFormatos();
  } else {
    await Promise.all([loadMateriales(), loadFormatos()]);
  }
})();
