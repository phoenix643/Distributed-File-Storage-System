const API = "http://localhost:3000";   // change accrodingly if  backend runs elsewhere

const FILE_ICONS = { pdf:"📄", mp4:"🎬", csv:"📊", txt:"📝", jpg:"🖼️", png:"🖼️", zip:"🗜️", json:"📋", py:"🐍", js:"🟨", html:"🌐" };
const getIcon = name => FILE_ICONS[name.split(".").pop().toLowerCase()] ?? "📦";
const fmtSize = b => b < 1024 ? b+"B" : b < 1048576 ? (b/1024).toFixed(1)+"KB" : (b/1048576).toFixed(1)+"MB";
const now = () => new Date().toTimeString().slice(0,8);

let selectedFile = null;

// ── API helpers ──
async function apiFetch(path, opts={}) {
const res = await fetch(API+path, opts);
if (!res.ok) {
const err = await res.json().catch(()=>({}));
throw new Error(err.error || err.detail || `HTTP ${res.status}`);
}
return res;
}

// ── Connectivity check ──
async function checkHealth() {
try {
    await apiFetch("/health");
    document.getElementById("api-dot").classList.add("online");
    document.getElementById("api-label").textContent = "Backend connected — localhost:3000";
    return true;
} catch {
    document.getElementById("api-label").textContent = "Backend offline — start uvicorn main:app --reload";
    return false;
}
}

// ── Log ──
function addLog(msg, type="info") {
const box = document.getElementById("log-box");
const row = document.createElement("div");
row.className = "log-entry";
row.innerHTML = `<span class="log-time">${now()}</span><span class="c-${type}">${msg}</span>`;
box.appendChild(row);
box.scrollTop = box.scrollHeight;
}

// ── Nodes ──
async function loadNodes() {
const nodes = await apiFetch("/nodes").then(r=>r.json());
const grid = document.getElementById("nodes-grid");
grid.innerHTML = "";
let online = 0;
nodes.forEach(n => {
    if (n.online) online++;
    const fill = n.usagePct > 80 ? "var(--red)" : n.usagePct > 55 ? "var(--amber)" : "var(--green)";
    const div = document.createElement("div");
    div.id = "node-"+n.id;
    div.className = "node-card" + (n.online?" active":"") + (!n.online?" offline":"");
    div.onclick = () => toggleNode(n.id);
    div.innerHTML = `
    <div class="node-toggle-dot ${n.online?"on":"off"}"></div>
    <div class="node-icon">🖥️</div>
    <div class="node-name">${n.id}</div>
    <div class="usage-bar"><div class="usage-fill" style="width:${n.usagePct}%;background:${fill}"></div></div>
    <div class="node-stat" style="color:${n.online?"var(--green)":"var(--red)"}">${n.online ? n.usagePct+"% used" : "OFFLINE"}</div>
    `;
    grid.appendChild(div);
});
document.getElementById("s-nodes").textContent = online;
}

async function toggleNode(nodeId) {
try {
    const data = await apiFetch(`/nodes/${nodeId}/toggle`, {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({})
    }).then(r=>r.json());
    addLog(`${nodeId} → ${data.status}${data.rebalancedChunks?" (rebalanced "+data.rebalancedChunks+" chunks)":""}`,
            data.status==="ONLINE"?"replicate":"warn");
    await loadNodes();
    await loadFiles();
} catch(e) { addLog("Toggle error: "+e.message, "warn"); }
}

function flashNode(nodeId) {
const el = document.getElementById("node-"+nodeId);
if (!el) return;
el.classList.add("flash","pulsing");
setTimeout(()=>el.classList.remove("flash","pulsing"), 900);
}

// ── Files ──
async function loadFiles() {
const files = await apiFetch("/files").then(r=>r.json());
const list = document.getElementById("file-list");
const sel  = document.getElementById("retrieve-select");
sel.innerHTML = '<option value="">— select file —</option>';

let totalChunks = 0;
if (!files.length) {
    list.innerHTML = '<div class="empty">No files yet — upload one above</div>';
} else {
    list.innerHTML = "";
    files.forEach(f => {
    totalChunks += f.chunks.reduce((a, c) => a + c.replicas.length, 0);
    const pills = f.chunks.map(c => {
        const replicas = c.replicas.map(r =>
            `<span class="pill pill-replica" title="${r.nodeId}">${r.nodeId}</span>`
        ).join("");
        return `<span class="pill pill-chunk" title="chunk ${c.index}">ch${c.index}</span>${replicas}`;
    }).join("");
    const item = document.createElement("div");
    item.className = "file-item";
    item.innerHTML = `
        <div class="file-icon">${getIcon(f.filename)}</div>
        <div class="file-info">
        <div class="file-name">${f.filename}</div>
        <div class="file-meta">${fmtSize(f.size)} &nbsp;·&nbsp; ${f.chunks.length} chunks &nbsp;·&nbsp; <span style="color:var(--purple);cursor:pointer" title="MD5">${f.md5.slice(0,12)}…</span></div>
        <div class="chunk-pills">${pills}</div>
        </div>
        <button class="btn btn-sm btn-danger" onclick="deleteFile('${f.fileId}')">✕</button>
    `;
    list.appendChild(item);
    const opt = document.createElement("option");
    opt.value = f.fileId;
    opt.textContent = f.filename;
    sel.appendChild(opt);
    });
}
document.getElementById("s-files").textContent = files.length;
document.getElementById("s-chunks").textContent = totalChunks;
}

// ── Upload ──
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const uploadBtn = document.getElementById("upload-btn");
const uploadBar = document.getElementById("upload-bar");

fileInput.addEventListener("change", () => {
selectedFile = fileInput.files[0];
if (selectedFile) {
    uploadBtn.textContent = `Upload  "${selectedFile.name}"  (${fmtSize(selectedFile.size)})`;
    uploadBtn.disabled = false;
}
});

dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("drag"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag"));
dropZone.addEventListener("drop", e => {
e.preventDefault(); dropZone.classList.remove("drag");
const f = e.dataTransfer.files[0];
if (f) { selectedFile = f; uploadBtn.textContent = `Upload  "${f.name}"  (${fmtSize(f.size)})`; uploadBtn.disabled = false; }
});

uploadBtn.addEventListener("click", async () => {
if (!selectedFile) return;
uploadBtn.disabled = true;
uploadBtn.textContent = "Uploading…";
uploadBar.style.width = "30%";

const form = new FormData();
form.append("file", selectedFile);
try {
    addLog(`Uploading "${selectedFile.name}" (${fmtSize(selectedFile.size)})`, "upload");
    uploadBar.style.width = "60%";
    const data = await apiFetch("/files/upload", { method:"POST", body:form }).then(r=>r.json());
    uploadBar.style.width = "100%";
    addLog(`Upload complete — ${data.chunks} chunks, MD5: ${data.md5.slice(0,12)}…`, "replicate");
    await loadFiles();
    await loadNodes();
} catch(e) {
    addLog("Upload failed: "+e.message, "warn");
}
setTimeout(()=>{ uploadBar.style.width="0"; }, 700);
uploadBtn.disabled = false;
uploadBtn.textContent = "Select a file first";
selectedFile = null;
fileInput.value = "";
});

// ── Delete ──
async function deleteFile(fileId) {
try {
    await apiFetch(`/files/${fileId}`, {method:"DELETE"});
    addLog(`File deleted: ${fileId.slice(0,8)}…`, "delete");
    await loadFiles();
    await loadNodes();
} catch(e) { addLog("Delete failed: "+e.message, "warn"); }
}

// ── Retrieve ──
async function retrieveFile() {
const fileId = document.getElementById("retrieve-select").value;
const result = document.getElementById("retrieve-result");
if (!fileId) { result.innerHTML = '<span style="color:var(--amber)">Select a file first.</span>'; return; }
result.innerHTML = '<span style="color:var(--text2)">Fetching chunks…</span>';
try {
    const res = await apiFetch(`/files/${fileId}/retrieve`);
    const blob = await res.blob();
    const fname = res.headers.get("content-disposition")?.match(/filename="(.+?)"/)?.[1] ?? "download";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    a.click();
    result.innerHTML = `<span style="color:var(--green)">✓ Downloaded "${fname}"</span>`;
    addLog(`File "${fname}" retrieved & downloaded`, "retrieve");
} catch(e) {
    const msg = e.message.replace("HTTP 503", "").trim() || e.message;
    result.innerHTML = `<span style="color:var(--red)">✗ ${e.message}</span>`;
    addLog("Retrieve failed: " + e.message, "warn");
}
}

// ── Config ──
async function loadConfig() {
const cfg = await apiFetch("/config").then(r=>r.json());
document.getElementById("s-rep").textContent = cfg.replicationFactor+"×";
document.getElementById("config-display").innerHTML = `
    <div class="config-row"><span class="config-key">Replication factor</span><span class="config-val">${cfg.replicationFactor}×</span></div>
    <div class="config-row"><span class="config-key">Chunk size</span><span class="config-val">${(cfg.chunkSizeBytes/1024/1024).toFixed(0)} MB</span></div>
    <div class="config-row"><span class="config-key">Online nodes</span><span class="config-val">${cfg.onlineNodes} / ${cfg.totalNodes}</span></div>
`;
}

async function updateRepFactor() {
const val = document.getElementById("rep-factor").value;
try {
    await apiFetch("/config", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ replicationFactor: parseInt(val) })
    });
    document.getElementById("s-rep").textContent = val+"×";
    addLog(`Replication factor set to ${val}×`, "info");
    await loadConfig();
} catch(e) { addLog("Config update failed: "+e.message, "warn"); }
}

// ── Poll logs from backend ──
let lastLogCount = 0;
async function pollLogs() {
const logs = await apiFetch("/logs?limit=100").then(r=>r.json()).catch(()=>[]);
logs.slice(lastLogCount).forEach(l => addLog(l.message, l.level));
lastLogCount = logs.length;
}

// ── Init ──
async function init() {
addLog("Connecting to DFSS backend…", "info");
const ok = await checkHealth();
if (!ok) { addLog("Backend offline — please start the FastAPI server.", "warn"); return; }
addLog("Backend online — loading system state…", "replicate");
await Promise.all([loadNodes(), loadFiles(), loadConfig()]);
addLog("System ready.", "info");
// Poll every 3 seconds
setInterval(async () => {
    await loadNodes();
    await loadFiles();
    await pollLogs();
}, 3000);
}

init();