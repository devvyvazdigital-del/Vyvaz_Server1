// ═════════════════════════════════════
// VYVAZ PORTAL — App Logic
// ═════════════════════════════════════

const API = "https://vyvaz-server.onrender.com";
let allBases = [];
let currentBaseData = null;

// ─── INIT ───────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("apiUrl").textContent = API.replace("https://", "");
  setupNavigation();
  setupFileDrop();
  checkServer();
  loadDashboard();
});

// ─── NAVIGATION ─────────────────────
function setupNavigation() {
  document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
      item.classList.add("active");
      document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
      const target = document.getElementById(`page-${page}`);
      if (target) target.classList.add("active");
      if (page === "bases") populateBaseSelect();
      // Close mobile sidebar
      document.getElementById("sidebar").classList.remove("open");
    });
  });

  document.getElementById("menuToggle").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
  });
}

// ─── SERVER STATUS ──────────────────
async function checkServer() {
  const dot = document.querySelector(".status-dot");
  const label = document.querySelector(".sidebar-status");
  const statServer = document.getElementById("statServer");
  try {
    const res = await fetch(`${API}/health`);
    const data = await res.json();
    if (data.ok) {
      dot.className = "status-dot online";
      label.innerHTML = `<span class="status-dot online"></span> Servidor online`;
      statServer.textContent = "Online";
      statServer.style.color = "var(--green)";
    } else { throw new Error(); }
  } catch {
    dot.className = "status-dot offline";
    label.innerHTML = `<span class="status-dot offline"></span> Servidor offline`;
    statServer.textContent = "Offline";
    statServer.style.color = "var(--red)";
  }
}

// ─── DASHBOARD ──────────────────────
async function loadDashboard() {
  try {
    const res = await fetch(`${API}/bases`);
    const data = await res.json();
    allBases = data.bases || data || [];

    document.getElementById("statBases").textContent = allBases.length;

    // Última importação
    if (allBases.length > 0) {
      const ultima = allBases[0];
      const d = new Date(ultima.updated_at || ultima.created_at);
      document.getElementById("statUltima").textContent = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
    } else {
      document.getElementById("statUltima").textContent = "—";
    }

    // Contar total de SKUs (load all bases)
    let totalSkus = 0;
    for (const base of allBases) {
      try {
        const r = await fetch(`${API}/bases/${base.slug}`);
        const bd = await r.json();
        if (bd.ok) totalSkus += bd.total || 0;
      } catch { /* skip */ }
    }
    document.getElementById("statItens").textContent = totalSkus.toLocaleString("pt-BR");

    // Table
    renderBasesTable(allBases);
  } catch (err) {
    console.error("Erro ao carregar dashboard:", err);
    document.getElementById("basesTableBody").innerHTML =
      `<tr><td colspan="4" class="empty-state">Erro ao conectar: ${err.message}</td></tr>`;
  }
}

function renderBasesTable(bases) {
  const tbody = document.getElementById("basesTableBody");
  if (!bases.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Nenhuma base encontrada</td></tr>`;
    return;
  }
  tbody.innerHTML = bases.map(b => {
    const d = new Date(b.created_at);
    const dateStr = d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return `<tr>
      <td style="color:var(--text-1);font-weight:500;">${esc(b.nome)}</td>
      <td class="mono">${esc(b.slug)}</td>
      <td>${dateStr}</td>
      <td class="text-right">
        <button class="btn btn-sm" onclick="viewBase('${esc(b.slug)}')">Ver itens</button>
        <button class="btn btn-sm btn-danger" onclick="deleteBase('${esc(b.slug)}', '${esc(b.nome)}')">Excluir</button>
      </td>
    </tr>`;
  }).join("");
}

// ─── VIEW BASE DETAIL ───────────────
async function viewBase(slug) {
  // Switch to bases page
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.querySelector('[data-page="bases"]').classList.add("active");
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById("page-bases").classList.add("active");

  populateBaseSelect();
  document.getElementById("baseSelectDetail").value = slug;
  await loadBaseDetail();
}

function populateBaseSelect() {
  const sel = document.getElementById("baseSelectDetail");
  const current = sel.value;
  sel.innerHTML = `<option value="">Selecione...</option>` +
    allBases.map(b => `<option value="${esc(b.slug)}">${esc(b.nome)} (${esc(b.slug)})</option>`).join("");
  if (current) sel.value = current;
}

async function loadBaseDetail() {
  const slug = document.getElementById("baseSelectDetail").value;
  if (!slug) return;

  const card = document.getElementById("baseDetailCard");
  card.style.display = "block";
  document.getElementById("baseDetailTitle").textContent = "Carregando...";
  document.getElementById("itensTableBody").innerHTML = "";

  try {
    const res = await fetch(`${API}/bases/${slug}`);
    const data = await res.json();

    if (!data.ok) throw new Error(data.erro || "Base não encontrada");

    currentBaseData = data;
    document.getElementById("baseDetailTitle").textContent = data.nome;
    document.getElementById("baseDetailCount").textContent = `${data.total} itens`;

    renderItensTable(data.dados);
  } catch (err) {
    document.getElementById("baseDetailTitle").textContent = "Erro";
    document.getElementById("baseDetailCount").textContent = err.message;
  }
}

function renderItensTable(dados) {
  const tbody = document.getElementById("itensTableBody");
  const entries = Object.entries(dados || {});
  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Nenhum item nesta base</td></tr>`;
    return;
  }
  tbody.innerHTML = entries.map(([id, item]) => `<tr>
    <td class="mono" style="color:var(--text-1);">${esc(id)}</td>
    <td class="text-right mono">${fmt(item.custo_produto)}</td>
    <td class="text-right mono">${fmt(item.imposto_percentual)}%</td>
    <td class="text-right mono">${fmt(item.taxa_fixa)}</td>
  </tr>`).join("");
}

function filterTable() {
  if (!currentBaseData) return;
  const q = document.getElementById("filterItens").value.trim().toLowerCase();
  if (!q) return renderItensTable(currentBaseData.dados);

  const filtered = {};
  for (const [id, item] of Object.entries(currentBaseData.dados || {})) {
    if (id.toLowerCase().includes(q)) filtered[id] = item;
  }
  renderItensTable(filtered);
}

// ─── DELETE BASE ────────────────────
async function deleteBase(slug, nome) {
  if (!confirm(`Excluir a base "${nome}" (${slug})?\n\nIsso removerá todos os custos associados.`)) return;
  try {
    const res = await fetch(`${API}/bases/${slug}`, { method: "DELETE" });
    const data = await res.json();
    if (data.ok) {
      loadDashboard();
    } else {
      alert("Erro: " + (data.erro || "Falha ao excluir"));
    }
  } catch (err) {
    alert("Erro de conexão: " + err.message);
  }
}

// ─── IMPORT ─────────────────────────
let selectedFile = null;

function setupFileDrop() {
  const drop = document.getElementById("fileDrop");
  const input = document.getElementById("importArquivo");
  const label = document.getElementById("fileDropLabel");

  drop.addEventListener("click", () => input.click());

  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag-over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag-over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("drag-over");
    if (e.dataTransfer.files.length) {
      selectedFile = e.dataTransfer.files[0];
      label.textContent = selectedFile.name;
      drop.classList.add("has-file");
    }
  });

  input.addEventListener("change", () => {
    if (input.files.length) {
      selectedFile = input.files[0];
      label.textContent = selectedFile.name;
      drop.classList.add("has-file");
    }
  });
}

function showImportStatus(msg, type) {
  const el = document.getElementById("importStatus");
  el.style.display = "block";
  el.className = `import-status ${type}`;
  el.textContent = msg;
}

async function previewImport() {
  const nome = document.getElementById("importNomeBase").value.trim();
  if (!nome) return showImportStatus("Informe o nome da base.", "error");
  if (!selectedFile) return showImportStatus("Selecione um arquivo.", "error");

  showImportStatus("Enviando preview...", "info");
  document.getElementById("btnPreview").disabled = true;

  try {
    const form = new FormData();
    form.append("arquivo", selectedFile);
    form.append("nomeBase", nome);
    form.append("confirmar", "false");

    const res = await fetch(`${API}/importar-base`, { method: "POST", body: form });
    const data = await res.json();

    if (!data.ok) throw new Error(data.erro || "Erro no preview");

    showImportStatus(`Preview OK: ${data.total} IDs detectados. Coluna: ${data.colunaUsada || data.colunaId}`, "success");

    // Render preview table
    const preview = data.preview || [];
    document.getElementById("previewCount").textContent = `${data.total} itens`;
    document.getElementById("previewArea").style.display = "block";
    document.getElementById("previewTableBody").innerHTML = preview.map(p => `<tr>
      <td class="mono" style="color:var(--text-1);">${esc(String(p.id || p.produto_id || ""))}</td>
      <td class="text-right mono">${fmt(p.custo_produto)}</td>
      <td class="text-right mono">${fmt(p.imposto_percentual)}%</td>
      <td class="text-right mono">${fmt(p.taxa_fixa)}</td>
    </tr>`).join("");

    document.getElementById("btnConfirmar").disabled = false;
  } catch (err) {
    showImportStatus("Erro: " + err.message, "error");
  } finally {
    document.getElementById("btnPreview").disabled = false;
  }
}

async function confirmarImport() {
  const nome = document.getElementById("importNomeBase").value.trim();
  if (!nome || !selectedFile) return;

  showImportStatus("Importando e salvando no banco...", "info");
  document.getElementById("btnConfirmar").disabled = true;

  try {
    const form = new FormData();
    form.append("arquivo", selectedFile);
    form.append("nomeBase", nome);
    form.append("confirmar", "true");

    const res = await fetch(`${API}/importar-base`, { method: "POST", body: form });
    const data = await res.json();

    if (!data.ok) throw new Error(data.erro || "Erro na importação");

    showImportStatus(data.mensagem || `Importação concluída — ${data.total} IDs salvos.`, "success");

    // Reset form
    selectedFile = null;
    document.getElementById("importArquivo").value = "";
    document.getElementById("fileDropLabel").textContent = "Clique ou arraste o arquivo aqui";
    document.getElementById("fileDrop").classList.remove("has-file");
    document.getElementById("previewArea").style.display = "none";
    document.getElementById("btnConfirmar").disabled = true;

    // Refresh dashboard data
    loadDashboard();
  } catch (err) {
    showImportStatus("Erro: " + err.message, "error");
    document.getElementById("btnConfirmar").disabled = false;
  }
}

// ─── HELPERS ────────────────────────
function esc(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function fmt(val) {
  const n = parseFloat(val);
  if (!Number.isFinite(n)) return "0,00";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
