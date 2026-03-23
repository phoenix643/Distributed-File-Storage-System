# Distributed File Storage System

A distributed file storage system that splits uploaded files into chunks and replicates them across multiple storage nodes for fault tolerance and high availability.

---

## Features

- **File Chunking** — uploaded files are split into 1MB chunks automatically
- **Replication** — each chunk is copied across multiple nodes (configurable 1× to 4×)
- **Fault Tolerance** — if a node goes offline, chunks are automatically re-replicated to surviving nodes
- **Persistent Registry** — file metadata survives server restarts via a JSON registry
- **Fallback Recovery** — retrieves files even when metadata is out of sync with disk
- **MD5 Integrity** — every file is hashed on upload for integrity verification
- **Load Balancing** — chunks are distributed to least-used nodes first

---

## Tech Stack

- **Backend** — Node.js, Express.js, Multer
- **Frontend** — HTML, CSS, Vanilla JavaScript
- **Storage** — Local filesystem (simulated distributed nodes)
- **Other** — UUID, Crypto (MD5), REST API

---

## Project Structure

```
dfss/
├── server.js          # Express backend — all API routes and storage logic
├── package.json       # Dependencies
├── public/
│   └── index.html     # Frontend UI
└── storage/           # Auto-created on first run
    ├── node-01/
    ├── node-02/
    ├── node-03/
    ├── node-04/
    ├── node-05/
    └── node-06/
```

---

## Getting Started

**1. Clone the repository**
```bash
git clone https://github.com/yourusername/dfss.git
cd dfss
```

**2. Install dependencies**
```bash
npm install
```

**3. Start the server**
```bash
node server.js
```

**4. Open the frontend**

Go to `http://localhost:3000` in your browser.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server health check |
| GET | `/nodes` | List all storage nodes and usage |
| POST | `/nodes/:nodeId/toggle` | Toggle a node online or offline |
| GET | `/files` | List all stored files |
| POST | `/files/upload` | Upload a file (multipart/form-data) |
| GET | `/files/:fileId/retrieve` | Download a file |
| DELETE | `/files/:fileId` | Delete a file |
| GET | `/config` | Get system configuration |
| POST | `/config` | Update replication factor |
| GET | `/logs` | Get activity log |

---

## How It Works

```
Upload flow:
  File → Split into 1MB chunks → Each chunk replicated to N nodes → Registry updated

Retrieval flow:
  Registry lookup → Find online replica → Read chunks in order → Reassemble → Download

Node failure flow:
  Node goes offline → Detect affected chunks → Copy to surviving nodes → Update registry
```

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Replication factor | 3× | Number of copies per chunk |
| Chunk size | 1MB | Size of each chunk |
| Max file size | 100MB | Upload size limit |
| Node count | 6 | Number of storage nodes |

---

## Known Limitations

- File registry is stored in a single JSON file — not suitable for large scale
- No authentication or access control
- No encryption at rest
- Rebalancing is synchronous — may be slow for large files
- Node usage counters can drift under rapid toggle stress testing

---

## Demo Scenario

1. Upload any file
2. Toggle 2 nodes offline
3. Retrieve the file — it still downloads successfully
4. Toggle a 3rd node offline to see re-replication warnings
5. Toggle all nodes back online and upload again
