/**
 * Distributed File Storage System — Backend
 * Stack: Node.js + Express + Multer
 *
 * Instructions:-
 * Install:  npm install
 * Run:      node server.js
 * API docs: http://localhost:3000 (If using different port change accordingly)
 */

const express    = require("express");
const multer     = require("multer");
const cors       = require("cors");
const fs         = require("fs");
const fsp        = require("fs").promises;
const path       = require("path");
const crypto     = require("crypto");
const { v4: uuid } = require("uuid");

const app  = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());


// Storage Setup
    
const BASE_DIR = path.join(__dirname, "storage");

const NODES = {
  "node-01": { id: "node-01",    dir: path.join(BASE_DIR, "node-01"), online: true, usageBytes: 0 },
  "node-02": { id: "node-02",    dir: path.join(BASE_DIR, "node-02"), online: true, usageBytes: 0 },
  "node-03": { id: "node-03",    dir: path.join(BASE_DIR, "node-03"), online: true, usageBytes: 0 },
  "node-04": { id: "node-04",   dir: path.join(BASE_DIR, "node-04"), online: true, usageBytes: 0 },
  "node-05": { id: "node-05",  dir: path.join(BASE_DIR, "node-05"), online: true, usageBytes: 0 },
  "node-06": { id: "node-06", dir: path.join(BASE_DIR, "node-06"), online: true, usageBytes: 0 },
};

// Create node directories
Object.values(NODES).forEach(n => fs.mkdirSync(n.dir, { recursive: true }));


// In-Memory Registry & Config
// ——————————————————————————————————————
// Load registry from disk if it exists
const REGISTRY_FILE = path.join(__dirname, "registry.json");
const saved = fs.existsSync(REGISTRY_FILE)
  ? JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"))
  : {};

const FILE_REGISTRY = saved.files || saved; // handles both old and new format

// Restore node usage
if (saved.nodeUsage) {
  Object.entries(saved.nodeUsage).forEach(([id, bytes]) => {
    if (NODES[id]) NODES[id].usageBytes = bytes;
  });
}

function saveRegistry() {
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify({
    files: FILE_REGISTRY,
    nodeUsage: Object.fromEntries(
      Object.entries(NODES).map(([id, n]) => [id, n.usageBytes])
    )
  }, null, 2));
}
const ACTIVITY_LOG  = [];

let REPLICATION_FACTOR = 3;
const CHUNK_SIZE       = 1 * 1024 * 1024; // 1 MB


// Multer — store upload in memory temporarily

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }  // 100MB max (Change size if using larger files)
});


// Helpers

function logActivity(message, level = "info") {
  const entry = { timestamp: new Date().toISOString(), level, message };
  ACTIVITY_LOG.push(entry);
  console.log(`[${level.toUpperCase()}] ${message}`);
}

function getOnlineNodes() {
  return Object.values(NODES).filter(n => n.online);
}

// Pick REPLICATION_FACTOR least-used online nodes, excluding given ids 
function pickNodes(excludeIds = []) {
  const available = getOnlineNodes()
    .filter(n => !excludeIds.includes(n.id))
    .sort((a, b) => a.usageBytes - b.usageBytes);
  return available.slice(0, REPLICATION_FACTOR);
}

// Split a Buffer into fixed-size chunks
function splitBuffer(buf) {
  const chunks = [];
  for (let i = 0; i < buf.length; i += CHUNK_SIZE) {
    chunks.push(buf.slice(i, i + CHUNK_SIZE));
  }
  return chunks;
}

function md5(buf) {
  return crypto.createHash("md5").update(buf).digest("hex");
}


// Routes — Health

app.get("/health", (req, res) => {
  res.json({ status: "ok", onlineNodes: getOnlineNodes().length });
});


// Routes — Nodes

app.get("/nodes", (req, res) => {
  const CAP = 100 * 1024 * 1024; // 100 MB cap per node (display only)
  res.json(
    Object.values(NODES).map(n => ({
      id:         n.id,
      online:     n.online,
      usageBytes: n.usageBytes,
      usagePct:   Math.round((n.usageBytes / CAP) * 100),
    }))
  );
});

app.post("/nodes/:nodeId/toggle", (req, res) => {
  const nodeId = req.params.nodeId;
  const node = NODES[nodeId];
  if (!node) return res.status(404).json({ error: `Node '${nodeId}' not found` });

  node.online = !node.online;
  const status = node.online ? "ONLINE" : "OFFLINE";
  logActivity(`Node ${nodeId} → ${status}`, node.online ? "info" : "warn");

  let rebalanced = 0;

  if (!node.online) {
    // Re-replicate every chunk that lived on the dead node
    for (const meta of Object.values(FILE_REGISTRY)) {
      for (const chunk of meta.chunks) {
        const hadReplica = chunk.replicas.some(r => r.nodeId === nodeId);
        if (!hadReplica) continue;

        // Remove the dead replica
        chunk.replicas = chunk.replicas.filter(r => r.nodeId !== nodeId);
        node.usageBytes = Math.max(0, node.usageBytes - chunk.size);

        // Find a replacement node
        const existingIds = chunk.replicas.map(r => r.nodeId);
        const [newNode]   = pickNodes(existingIds);
        if (!newNode){ 
          logActivity(`Cannot rebalance chunk ${chunk.index} of '${meta.filename}' — no online nodes available`, "warn");
          continue;
        }

        const src = chunk.replicas[0]?.nodeId;
        if (src && NODES[src]?.online) {
          const srcPath  = path.join(NODES[src].dir, chunk.chunkId);
          const destPath = path.join(newNode.dir, chunk.chunkId);
          try {
            fs.copyFileSync(srcPath, destPath);
            chunk.replicas.push({ nodeId: newNode.id });
            newNode.usageBytes += chunk.size;
            saveRegistry();
            logActivity(`Re-replicated chunk ${chunk.index} of '${meta.filename}' → ${newNode.id}`, "replicate");
            rebalanced++;
          } catch (e) {
            logActivity(`Failed to re-replicate chunk ${chunk.index}: ${e.message}`, "warn");
          }
        }
      }
    }
  }

  res.json({ status, rebalancedChunks: rebalanced });
});


// Routes — Files

app.get("/files", (req, res) => {
  res.json(
    Object.entries(FILE_REGISTRY).map(([fileId, meta]) => ({
      fileId,
      filename:   meta.filename,
      size:       meta.size,
      md5:        meta.md5,
      mimeType:   meta.mimeType,
      uploadedAt: meta.uploadedAt,
      chunks: meta.chunks.map(c => ({
        index:   c.index,
        chunkId: c.chunkId,
        size:    c.size,
        replicas: c.replicas,
      })),
    }))
  );
});

app.post("/files/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file provided" });

  const online = getOnlineNodes();
  if (online.length < REPLICATION_FACTOR) {
    return res.status(503).json({
      error: `Need at least ${REPLICATION_FACTOR} online nodes. Only ${online.length} available.`,
    });
  }



  const { originalname, mimetype, buffer } = req.file;
  const fileId   = uuid();
  const fileHash = md5(buffer);
  const rawChunks = splitBuffer(buffer);

  logActivity(`Uploading '${originalname}' (${buffer.length} bytes) → ${rawChunks.length} chunks`, "upload");

  const chunkMeta = [];

  for (let i = 0; i < rawChunks.length; i++) {
    const chunkData = rawChunks[i];
    const chunkId   = `${fileId}_chunk_${i}`;
    const targets   = pickNodes();
    const replicas  = [];

    for (const node of targets) {
      const dest = path.join(node.dir, chunkId);
      await fsp.writeFile(dest, chunkData);
      node.usageBytes += chunkData.length;
      replicas.push({ nodeId: node.id });
      logActivity(`  Chunk ${i} (${chunkData.length}B) → ${node.id}`, "replicate");
    }

    chunkMeta.push({ index: i, chunkId, size: chunkData.length, replicas });
  }

  FILE_REGISTRY[fileId] = {
    filename:   originalname,
    size:       buffer.length,
    md5:        fileHash,
    mimeType:   mimetype || "application/octet-stream",
    uploadedAt: new Date().toISOString(),
    chunks:     chunkMeta,
  };

  saveRegistry();

  logActivity(`Upload complete: '${originalname}' — ID ${fileId.slice(0,8)}…`, "upload");
  res.json({ fileId, md5: fileHash, chunks: rawChunks.length });
});

app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "File too large — 100MB maximum" });
  }
  next(err);
});

app.get("/files/:fileId/retrieve", async (req, res) => {
  const meta = FILE_REGISTRY[req.params.fileId];
  if (!meta) return res.status(404).json({ error: "File not found" });

  const parts = [];
  for (const chunk of meta.chunks.sort((a, b) => a.index - b.index)) {
    let retrieved = false;

    // First try known replicas from registry
    for (const replica of chunk.replicas) {
      const node = NODES[replica.nodeId];
      if (!node?.online) continue;
      const filePath = path.join(node.dir, chunk.chunkId);
      if (!fs.existsSync(filePath)) continue;
      parts.push(await fsp.readFile(filePath));
      retrieved = true;
      break;
    }

    // Fallback — scan ALL online nodes if registry is out of sync
    if (!retrieved) {
      for (const node of getOnlineNodes()) {
        const filePath = path.join(node.dir, chunk.chunkId);
        if (!fs.existsSync(filePath)) continue;
        parts.push(await fsp.readFile(filePath));
        retrieved = true;
        logActivity(`Recovered chunk ${chunk.index} from ${node.id} (not in registry)`, "warn");
        break;
      }
    }

    if (!retrieved) {
      return res.status(503).json({
        error: `Chunk ${chunk.index} unavailable — all replicas offline or missing`,
      });
    }
  }

  logActivity(`File '${meta.filename}' retrieved successfully`, "retrieve");
  res.setHeader("Content-Type", meta.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${meta.filename}"`);
  res.send(Buffer.concat(parts));
});

app.delete("/files/:fileId", async (req, res) => {
  const meta = FILE_REGISTRY[req.params.fileId];
  if (!meta) return res.status(404).json({ error: "File not found" });

  for (const chunk of meta.chunks) {
    for (const replica of chunk.replicas) {
      const node = NODES[replica.nodeId];
      if (!node) continue;
      const filePath = path.join(node.dir, chunk.chunkId);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      node.usageBytes = Math.max(0, node.usageBytes - chunk.size);
    }
  }

  delete FILE_REGISTRY[req.params.fileId];
  saveRegistry();
  logActivity(`Deleted file '${meta.filename}'`, "delete");
  res.json({ deleted: true, fileId: req.params.fileId });
});


// Routes — Config & Logs

app.get("/config", (req, res) => {
  res.json({
    replicationFactor: REPLICATION_FACTOR,
    chunkSizeBytes:    CHUNK_SIZE,
    onlineNodes:       getOnlineNodes().length,
    totalNodes:        Object.keys(NODES).length,
  });
});

app.post("/config", (req, res) => {
  if (req.body.replicationFactor) REPLICATION_FACTOR = req.body.replicationFactor;
  logActivity(`Config updated: replication=${REPLICATION_FACTOR}`, "info");
  res.json({ replicationFactor: REPLICATION_FACTOR, chunkSizeBytes: CHUNK_SIZE });
});

app.get("/logs", (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(ACTIVITY_LOG.slice(-limit));
});



// Start


app.use(express.static(path.join(__dirname, "public")));
app.listen(PORT, () => {
  logActivity(`DFSS backend running on http://localhost:${PORT}`, "info");
  logActivity(`API docs: GET /nodes, /files, /config, /logs`, "info");
});
