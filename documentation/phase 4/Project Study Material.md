# Urumi Platform — Phase 4 Project Study Material
## A Comprehensive Self-Study Guide to Centralized Team MCP Gateways, Dynamic Upstream Federation, Node.js 24 SQLite WAL Persistence, Constant-Time Cryptography, and Kubernetes Security Boundaries

> **Author**: Aditya Rathore  
> **Phase**: Phase 4 (Team MCP Gateway Core, Multi-Upstream Dynamic Catalog, Security Hardening & Acceptance)  
> **Target Audience**: Self-study, technical interviews, architecture reviews, DevOps & AI platform engineering  
> **Repository**: `AdityaDRathore/MCP-Gateway-Kubernetes-Wcom`  
> **Target Cluster**: Local Kubernetes (`k3d-urumi`)  
> **Last Updated**: October 2026  

---

## Table of Contents
1. [Introduction & Phase 4 Mission](#1-introduction--phase-4-mission)
   - [The Evolution: From Single Server (Phase 3) to Centralized Gateway (Phase 4)](#the-evolution-from-single-server-phase-3-to-centralized-gateway-phase-4)
   - [The Problem of the $N \times M$ AI Tooling Mesh](#the-problem-of-the-n--times-m-ai-tooling-mesh)
   - [Core Design Philosophy](#core-design-philosophy)
2. [What is an MCP Gateway? Core Technologies Explained Simply](#2-what-is-an-mcp-gateway-core-technologies-explained-simply)
   - [Model Context Protocol (MCP) Streamable HTTP & Wire Protocol](#model-context-protocol-mcp-streamable-http--wire-protocol)
   - [Node.js 24 LTS & `node:sqlite` (Built-in Embedded Persistence)](#nodejs-24-lts--nodesqlite-built-in-embedded-persistence)
   - [SQLite Write-Ahead Logging (WAL) Mode Under the Hood](#sqlite-write-ahead-logging-wal-mode-under-the-hood)
   - [Constant-Time Cryptography & Timing Attacks](#constant-time-cryptography--timing-attacks)
   - [Two-Phase Audit Logging & Cryptographic Argument Hashing](#two-phase-audit-logging--cryptographic-argument-hashing)
   - [Dynamic Tool Discovery & Prefix Federation](#dynamic-tool-discovery--prefix-federation)
   - [Concurrency Management, Queuing & Overload Protection](#concurrency-management-queuing--overload-protection)
3. [The Upstream Microservices Ecosystem](#3-the-upstream-microservices-ecosystem)
   - [CRM MCP Service (`apps/mcp-crm`)](#crm-mcp-service-appsmcp-crm)
   - [Tasks MCP Service (`apps/mcp-tasks`)](#tasks-mcp-service-appsmcp-tasks)
   - [WooCommerce MCP Service (`apps/woocommerce-mcp`)](#woocommerce-mcp-service-appswoocommerce-mcp)
   - [Why Mock Services are Crucial for Resilient Distributed Systems](#why-mock-services-are-crucial-for-resilient-distributed-systems)
4. [Kubernetes Security Boundaries & Storage Architecture](#4-kubernetes-security-boundaries--storage-architecture)
   - [Namespace Separation: Workloads (`urumi`) vs Secrets (`urumi-gateway-secrets`)](#namespace-separation-workloads-urumi-vs-secrets-urumi-gateway-secrets)
   - [Default-Deny Egress NetworkPolicies with `kube-router`](#default-deny-egress-networkpolicies-with-kube-router)
   - [POSIX Storage Permissions (`0700` and `0600`)](#posix-storage-permissions-0700-and-0600)
   - [The `DAC_OVERRIDE` InitContainer Defect & Resolution](#the-dac_override-initcontainer-defect--resolution)
   - [Single-Writer `Recreate` Strategy for SQLite](#single-writer-recreate-strategy-for-sqlite)
5. [The Quality Gate Journey (Gate G0 through Gate G9)](#5-the-quality-gate-journey-gate-g0-through-gate-g9)
   - [Gate G0: Inception, Master Roadmap & Workspace Setup](#gate-g0-inception-master-roadmap--workspace-setup)
   - [Gate G1: Architecture Decision Records (ADR-011 through ADR-015)](#gate-g1-architecture-decision-records-adr-011-through-adr-015)
   - [Gate G2: Upstream Microservices (CRM & Tasks Implementation)](#gate-g2-upstream-microservices-crm--tasks-implementation)
   - [Gate G3: Gateway Engine & SQLite WAL Persistence](#gate-g3-gateway-engine--sqlite-wal-persistence)
   - [Gate G4: Persistence, Online Backup (`VACUUM INTO`) & Recovery Drill](#gate-g4-persistence-online-backup-vacuum-into--recovery-drill)
   - [Gate G5: Auth, RBAC, Admin API & K8s Secrets Isolation](#gate-g5-auth-rbac-admin-api--k8s-secrets-isolation)
   - [Gate G6: Dynamic Upstream Lifecycle & Tool Discovery](#gate-g6-dynamic-upstream-lifecycle--tool-discovery)
   - [Gate G7: Concurrency Control, Queues, Timeouts & Overload Protection](#gate-g7-concurrency-control-queues-timeouts--overload-protection)
   - [Gate G8: Unified Helm Deployment, NetworkPolicies & Security Tightening](#gate-g8-unified-helm-deployment-networkpolicies--security-tightening)
   - [Gate G9: End-to-End Acceptance, Pod Replacement Defect Fix & Performance Benchmarks](#gate-g9-end-to-end-acceptance-pod-replacement-defect-fix--performance-benchmarks)
6. [Critical Real-World Gotchas & Lessons Learned](#6-critical-real-world-gotchas--lessons-learned)
   - [The Ingress Host Header Stripping Trap (`undici` / `fetch`)](#the-ingress-host-header-stripping-trap-undici--fetch)
   - [The SQLite Companion File Corruption Trap](#the-sqlite-companion-file-corruption-trap)
   - [The Kubernetes API Server Dual-IP Filter Trap](#the-kubernetes-api-server-dual-ip-filter-trap)
   - [Why Timing Attacks are Real in Microservice Gateways](#why-timing-attacks-are-real-in-microservice-gateways)
7. [Study & Interview Preparation Guide](#7-study--interview-preparation-guide)
   - [15 Technical Questions & Answers for System Design & DevOps](#15-technical-questions--answers-for-system-design--devops)

---

## 1. Introduction & Phase 4 Mission

### The Evolution: From Single Server (Phase 3) to Centralized Gateway (Phase 4)

In **Phase 3**, we built a specialized MCP server (`apps/woocommerce-mcp`) that exposed WooCommerce e-commerce tools (listing products, getting orders, updating statuses) over the Model Context Protocol. While this proved that an AI agent could securely read and manipulate store data, running standalone MCP servers for every business domain introduces massive architectural chaos:

```
[ Phase 3: Uncoordinated Standalone Tool Servers ]

   AI Agent 1 ──── Bearer Token A ────> [ WooCommerce MCP ] ────> Store Database
   AI Agent 2 ──── Basic Auth B   ────> [ CRM MCP ]         ────> CRM Database
   AI Agent 3 ──── Custom Token C ────> [ Tasks MCP ]       ────> Tasks Database
```

When an enterprise scales, having AI agents establish separate network connections, authenticate with distinct tokens, manage disparate rate limits, and communicate across multiple ports creates a security nightmare.

In **Phase 4**, we solved this by architecting and deploying a **Centralized Team MCP Gateway** (`apps/gateway`). The Gateway acts as the single, hardened, authenticated, and rate-limited front door for all AI tools across the organization:

```
[ Phase 4: Centralized Enterprise MCP Gateway ]

                              AI Agents & MCP Clients
                                         │
                         Single Bearer Token (urumi_live_...)
                                         │
                                         ▼
                 +───────────────────────────────────────────────+
                 │        Traefik Ingress Controller             │
                 │    dashboard.127.0.0.1.nip.io:8080/mcp        │
                 +───────────────────────────────────────────────+
                                         │
                                         ▼
                 +───────────────────────────────────────────────+
                 │           Central Team MCP Gateway            │
                 │  - Constant-Time API Key Auth & RBAC         │
                 │  - Two-Phase Audit Logging (Hash Redacted)    │
                 │  - Embedded SQLite WAL Persistence            │
                 │  - Global (20) & Per-Upstream (4+10) Queues   │
                 │  - Dynamic Upstream Catalog Discovery         │
                 +───────────────────────────────────────────────+
                     │                   │                   │
             (Private NetPol)    (Private NetPol)    (Private NetPol)
                     │                   │                   │
                     ▼                   ▼                   ▼
             +---------------+   +---------------+   +---------------+
             │  MCP CRM      │   │  MCP Tasks    │   │  WooCommerce  │
             │  Port: 3000   │   │  Port: 3000   │   │  MCP Server   │
             │  Tools: 2     │   │  Tools: 2     │   │  Tools: 6     │
             +---------------+   +---------------+   +---------------+
```

### The Problem of the $N \times M$ AI Tooling Mesh

Without a central gateway, adding $N$ AI clients to $M$ internal tool servers requires $N \times M$ security connections, audit configurations, and network permissions. A central gateway reduces this to $N + M$:
- Clients only connect to **one endpoint** (`POST /mcp`).
- Clients only authenticate with **one API key**.
- The gateway enforces rate limits, monitors health, federates tools, and guarantees that sensitive arguments are cryptographically redacted before being logged.

### Core Design Philosophy
1. **AI agents must never talk directly to raw backend databases or microservices.** Every interaction must pass through an auditable, rate-limited gateway.
2. **Fail-Closed Security by Default.** All network routes, ingress rules, and file permissions default to closed. Explicit allowlists are required for every operation.
3. **Data Protection Invariance.** Production data (like Products 10, 11, 12 and Order #14) must remain strictly unmutated by test suites and evaluation drills.
4. **Zero Cloud Dependencies for Core Reliability.** Persistence relies on high-performance embedded SQLite in WAL mode rather than managing external database clusters for gateway state.

---

## 2. What is an MCP Gateway? Core Technologies Explained Simply

### Model Context Protocol (MCP) Streamable HTTP & Wire Protocol

The Model Context Protocol (MCP) standardizes how AI applications discover and invoke tools. Rather than writing ad-hoc REST endpoints, MCP uses the **JSON-RPC 2.0** specification.

#### The Wire Protocol
Every MCP interaction follows a structured JSON-RPC format:
- **Request:**
  ```json
  {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "woocommerce__get_order",
      "arguments": { "order_id": 14 }
    }
  }
  ```
- **Success Response:**
  ```json
  {
    "jsonrpc": "2.0",
    "id": 1,
    "result": {
      "content": [
        {
          "type": "text",
          "text": "{\"id\":14,\"status\":\"processing\",\"total\":\"299.00\"}"
        }
      ],
      "isError": false
    }
  }
  ```
- **Error Response:**
  ```json
  {
    "jsonrpc": "2.0",
    "id": 1,
    "error": {
      "code": -32602,
      "message": "Tool not found: unknown_tool"
    }
  }
  ```

#### Handshake and Capabilities
When a client connects, it begins with an `initialize` request. The gateway responds with its server information and capabilities:
```json
{
  "capabilities": {
    "tools": { "listChanged": true }
  },
  "serverInfo": {
    "name": "urumi-gateway",
    "version": "1.0.0"
  }
}
```
Setting `tools.listChanged: true` tells the client: *"I support dynamic upstreams. If a new service is registered or removed, I will notify you via `notifications/tools/list_changed` so you can re-fetch the tool list without reconnecting."*

---

### Node.js 24 LTS & `node:sqlite` (Built-in Embedded Persistence)

Traditionally, Node.js applications that needed a database relied on third-party native C++ add-ons like `better-sqlite3` or external database services like PostgreSQL or MySQL.

In **Node.js 24 LTS**, the Node core team introduced native SQLite support via `node:sqlite` (`DatabaseSync`).

#### Why Built-in SQLite?
1. **Zero External Pods:** We do not need to run, monitor, or pay for a PostgreSQL pod just to store API keys and upstream configurations.
2. **Zero Network Latency:** Reads and writes happen via memory pointers and local disk I/O in microseconds, not TCP sockets across the Kubernetes network.
3. **Zero Native Compilation Headaches:** Because `node:sqlite` is baked directly into the official Node 24 binary, there are no `node-gyp`, Python, or C++ compilation errors when building Alpine Linux Docker images.

---

### SQLite Write-Ahead Logging (WAL) Mode Under the Hood

By default, SQLite uses a "Rollback Journal." Whenever a transaction writes data, it locks the entire database, preventing anyone else from reading.

In Phase 4, we explicitly configure SQLite to run in **Write-Ahead Logging (WAL)** mode:
```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
```

#### How WAL Mode Works:
Instead of writing directly into `gateway.db`, new transactions append their changes to a companion file called `gateway.db-wal`.
- **Readers do not block writers.** Readers read committed pages from `gateway.db` and check `gateway.db-wal` for newer versions.
- **Writers do not block readers.** A writer simply appends new frames to the end of the WAL file.
- **The Shared Memory Index (`gateway.db-shm`):** This file provides an in-memory index so readers can locate the newest frame in the WAL without scanning the entire file.

```
                  ┌─────────────────────────────────────┐
                  │          Node 24 Gateway            │
                  └──────────────────┬──────────────────┘
                                     │
                 ┌───────────────────┴───────────────────┐
                 │                                       │
           (Reads Pages)                           (Appends Logs)
                 │                                       │
                 ▼                                       ▼
        ┌─────────────────┐                     ┌─────────────────┐
        │  gateway.db     │                     │  gateway.db-wal │
        │  (Committed     │◄── Checkpoint ───── │  (Uncheckpointed│
        │   B-Tree Pages) │    (Background)     │   Write Frames) │
        └─────────────────┘                     └─────────────────┘
                 ▲                                       ▲
                 │                                       │
                 └───────────────────┬───────────────────┘
                                     │
                              (Shared Index)
                                     ▼
                            ┌─────────────────┐
                            │  gateway.db-shm │
                            │  (Shared Memory)│
                            └─────────────────┘
```

> **Critical Operational Invariant:**  
> If you copy only `gateway.db` while transactions are occurring, your backup is corrupt! You must always back up SQLite using the native non-locking `VACUUM INTO '/data/backups/gateway-<timestamp>.db'` command, which automatically flushes the WAL frames into a pristine, unified database file.

---

### Constant-Time Cryptography & Timing Attacks

When an AI client calls the Gateway, it passes an API key:
```http
Authorization: Bearer urumi_live_13f4e3682b703936e71d7b1e41412d9b4f86fb45769f2b08c3f13aefeecef348
```

#### Why We NEVER Store API Keys in Plaintext
If an attacker steals a database backup or runs a query on `gateway.db`, plaintext keys would give them full access to all tools. Therefore:
1. The client receives the raw key (`urumi_live_...`).
2. The Gateway computes the **SHA-256 hash** of the key.
3. The Gateway stores **only the hash** in SQLite (`key_hash`).

#### What is a Timing Attack?
When developers compare two strings in standard JavaScript:
```javascript
// DANGEROUS! DO NOT USE FOR PASSWORDS OR KEYS
if (userKeyHash === storedKeyHash) { ... }
```
The JavaScript engine compares strings character by character from left to right. As soon as it encounters the first non-matching character, it stops and returns `false`:
- Guessing `a...` when the key starts with `z`: Fails in **10 nanoseconds**.
- Guessing `z...` when the key starts with `z`: Fails in **25 nanoseconds** (because it checked the next character).

An attacker can measure request response times over thousands of attempts with a high-resolution clock and deduce the key character-by-character!

#### The Fix: `crypto.timingSafeEqual`
In `apps/gateway/src/auth/key-service.ts`, we compare key hashes using Node's cryptographic constant-time comparison:
```typescript
import crypto from 'node:crypto';

export function constantTimeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  
  if (bufA.length !== bufB.length) {
    return false;
  }
  
  return crypto.timingSafeEqual(bufA, bufB);
}
```
`crypto.timingSafeEqual` compares every single byte in the buffer, regardless of where the mismatch occurs. The time taken is identical whether 0 characters match or 64 characters match, completely defeating timing attacks.

---

### Two-Phase Audit Logging & Cryptographic Argument Hashing

Every enterprise requires an audit trail showing what actions AI agents took. However, AI agents pass tool arguments that contain highly confidential information:
- Customer email addresses
- Home addresses
- Passwords and auth tokens
- Financial transaction amounts

If the gateway logs raw JSON arguments to disk, the audit log becomes a liability that violates data privacy laws (such as GDPR and HIPAA).

#### The Two-Phase Pattern:
1. **Phase 1 (Request Ingress):**
   - The Gateway computes the deterministic **SHA-256 hash** of the arguments:
     ```typescript
     const argsHash = crypto.createHash('sha256').update(JSON.stringify(args)).digest('hex');
     ```
   - An audit record is created with `status = 'pending'`, `user_id`, `tool_name`, `args_hash`, and `started_at`.
2. **Phase 2 (Request Egress):**
   - Upon receiving the result from the upstream microservice, the record is updated with `duration_ms`, `status = 'success'` (or `'error'`), and `completed_at`.

If an auditor later asks, *"Did Agent X execute this exact command with these exact parameters at 2:00 PM?"*, the compliance team can hash the parameters and check if the hashes match—without ever persisting sensitive cleartext arguments in the database.

---

### Dynamic Tool Discovery & Prefix Federation

In a multi-service environment, multiple microservices might export tools with identical names (e.g., both CRM and Tasks might have a tool named `search`).

#### Prefix Namespacing
The Gateway automatically prefixes tool names using the upstream slug:
- `apps/mcp-crm` exports `get_contact` $\rightarrow$ Federates as `crm__get_contact`
- `apps/mcp-tasks` exports `list_tasks` $\rightarrow$ Federates as `tasks__list_tasks`
- `apps/woocommerce-mcp` exports `get_order` $\rightarrow$ Federates as `woocommerce__get_order`

#### Dispatching Without Hardcoded Routes
When a client calls `crm__get_contact`, the Gateway:
1. Splices the string on `__` to identify the slug (`crm`) and target tool (`get_contact`).
2. Looks up `crm` in the dynamic upstream registry.
3. Rewrites the JSON-RPC request to target `get_contact`.
4. Dispatches the request to the upstream client's persistent SSE connection.

---

### Concurrency Management, Queuing & Overload Protection

AI agents can generate bursts of dozens of requests per second. If an agent calls `crm__search_contacts` 50 times simultaneously, it could crash the CRM database.

In **Gate G7**, we implemented a two-tier resilience architecture:

```
                              Incoming Tool Calls
                                       │
                                       ▼
                   +───────────────────────────────────────+
                   │      Global Concurrency Limiter       │
                   │        (Max 20 Simultaneous)          │
                   +───────────────────────────────────────+
                                       │
                       Exceeds 20? ────┴───> HTTP 429 Too Many Requests
                                       │
                                       ▼
                   +───────────────────────────────────────+
                   │    Per-Upstream FIFO Queue Manager    │
                   │    (Active: Max 4, Queued: Max 10)    │
                   +───────────────────────────────────────+
                                       │
                       Queue > 10? ────┴───> JSON-RPC Error -32603
                                       │    (Per-upstream queue full)
                                       ▼
                   +───────────────────────────────────────+
                   │      Upstream SSE Client Dispatch     │
                   │       (10,000ms AbortController)      │
                   +───────────────────────────────────────+
```

1. **Global Concurrency Ceiling (20):** Caps total simultaneous requests across all upstreams. Protects the gateway pod itself from CPU/memory starvation.
2. **Per-Upstream FIFO Queues (4 Active + 10 Queued):**
   - At most 4 calls are executed in parallel against a single upstream.
   - Up to 10 additional calls wait in an in-memory FIFO queue.
   - If the queue exceeds 10, subsequent requests are immediately rejected to prevent memory exhaustion.
3. **Fail-Closed Timeouts (10,000ms):** Every outbound request is bound to an `AbortController`. If an upstream hangs or deadlocks, the gateway aborts the fetch after 10 seconds, returning a clean error to the agent instead of hanging indefinitely.

---

## 3. The Upstream Microservices Ecosystem

The Gateway aggregates tools from three dedicated microservices running inside the Kubernetes cluster:

### CRM MCP Service (`apps/mcp-crm`)
- **Port:** `3000` (ClusterIP: `urumi-mcp-crm`)
- **Transport:** Server-Sent Events (SSE) at `/sse`
- **Authentication:** Bearer token stored in `urumi-gateway-secrets`
- **Tools Exported:**
  1. `crm__get_contact`: Retrieves customer profile, company, and email by contact ID.
  2. `crm__search_contacts`: Queries contacts by name or email with pagination limits.

### Tasks MCP Service (`apps/mcp-tasks`)
- **Port:** `3000` (ClusterIP: `urumi-mcp-tasks`)
- **Transport:** Server-Sent Events (SSE) at `/sse`
- **Authentication:** Bearer token stored in `urumi-gateway-secrets`
- **Tools Exported:**
  1. `tasks__get_task`: Fetches task details, status (`todo`, `in_progress`, `done`), priority, and assignee.
  2. `tasks__list_tasks`: Searches and filters active tasks with limit parameters.

### WooCommerce MCP Service (`apps/woocommerce-mcp`)
- **Port:** `3000` (ClusterIP: `urumi-woocommerce-mcp`)
- **Transport:** Streamable HTTP at `/mcp`
- **Authentication:** In-cluster RFC 5849 OAuth 1.0a HMAC-SHA256
- **Tools Exported (6 Tools):**
  1. `woocommerce__list_products`: Browses product catalog with status and category filters.
  2. `woocommerce__get_product`: Retrieves product specifications, price, and inventory.
  3. `woocommerce__list_orders`: Lists historical store orders with date range bounds.
  4. `woocommerce__get_order`: Retrieves order line items with customer PII strictly omitted.
  5. `woocommerce__create_product`: Adds new items with SKU uniqueness validation.
  6. `woocommerce__update_order_status`: Transitions order state (`processing` $\rightarrow$ `completed`) with no-op detection.

### Why Mock Services are Crucial for Resilient Distributed Systems
In `apps/mcp-crm` and `apps/mcp-tasks`, we intentionally built self-contained, high-performance in-memory mock datasets rather than connecting to live external SaaS APIs (like Salesforce or Jira) during development:
- **Deterministic Testing:** Tests never fail due to external cloud outages or network blips.
- **Hermetic Lifecycle Verification:** We can freely test upstream registration, token rotation, network timeouts, and queue exhaustion without risking real customer data or generating SaaS API costs.

---

## 4. Kubernetes Security Boundaries & Storage Architecture

### Namespace Separation: Workloads (`urumi`) vs Secrets (`urumi-gateway-secrets`)

In a standard Kubernetes deployment, developers often put secrets in the same namespace as the pods. If an application pod is compromised (e.g., via a remote code execution vulnerability), an attacker might dump all secrets in the namespace.

In Phase 4, we enforce strict **Cross-Namespace Secret Isolation**:
- **Application Pods, Services, PVCs:** Live in namespace `urumi`.
- **Upstream Bearer Tokens:** Live in namespace `urumi-gateway-secrets`.

The Gateway pod runs under a dedicated Kubernetes ServiceAccount (`urumi-gateway-sa`). We bound this ServiceAccount to a Role that has permissions **strictly in `urumi-gateway-secrets`**:
```bash
# Gateway SA CAN manage upstream secrets:
kubectl auth can-i create secrets -n urumi-gateway-secrets --as=system:serviceaccount:urumi:urumi-gateway-sa
# Result: yes

# Gateway SA CANNOT touch general cluster secrets:
kubectl auth can-i get secrets -n urumi --as=system:serviceaccount:urumi:urumi-gateway-sa
# Result: no

kubectl auth can-i get secrets -n kube-system --as=system:serviceaccount:urumi:urumi-gateway-sa
# Result: no
```

---

### Default-Deny Egress NetworkPolicies with `kube-router`

By default, any pod in Kubernetes can communicate with any other pod across any namespace and access the public Internet.

In Phase 4, we implemented an airtight NetworkPolicy (`urumi-gateway-egress-policy`):
- **Egress to CRM, Tasks, WooCommerce:** Allowed strictly on TCP port `3000`.
- **Egress to Kubernetes DNS:** Allowed on UDP/TCP port `53`.
- **Egress to Kubernetes API Server:** Narrowed strictly to Pre-DNAT ClusterIP `10.43.0.1` (port `443`) and Post-DNAT node `172.19.0.2` (port `6443`).
- **Egress to WordPress (Port 80) & MariaDB (Port 3306):** **STRICTLY BLOCKED.**

```
                                  urumi-gateway
                                        │
           ┌────────────────────────────┼───────────────────────────┐
           │ (Port 3000)                │ (Port 3000)               │ (Port 3000)
           ▼                            ▼                           ▼
    urumi-mcp-crm                urumi-mcp-tasks         urumi-woocommerce-mcp
                                                                    │
                                                                    │ (Port 80)
                                                                    ▼
      urumi-mariadb ◄────────── BLOCKED ─────────────── urumi-wordpress
       (Port 3306)          (From Gateway)
```

If an attacker compromises the gateway, they cannot connect to the WordPress store or inject SQL into MariaDB—the Linux kernel drops the packets at the network interface!

---

### POSIX Storage Permissions (`0700` and `0600`)

To protect the SQLite database on shared Kubernetes worker nodes:
- **Mount directory `/data`:** Enforced as `0700` (`drwx------`) owned by UID `10001:10001`.
- **Database file `/data/gateway.db`:** Enforced as `0600` (`-rw-------`) owned by UID `10001:10001`.
- **Backup files `/data/backups/*.db`:** Enforced as `0600` (`-rw-------`).

Other pods or non-root users on the node have zero read or write access to the database files.

---

### The `DAC_OVERRIDE` InitContainer Defect & Resolution

During Gate G9 testing, we uncovered a subtle Linux permissions edge-case:

#### The Bug:
1. When the Gateway first deployed, an `initContainer` running as `runAsUser: 0` (root) executed:
   ```sh
   chown -R 10001:10001 /data && chmod 0700 /data
   ```
2. The gateway ran smoothly and created `gateway.db`.
3. During a pod restart/rescheduling test, the new pod launched the same `initContainer`.
4. The initContainer crashed with:
   ```
   chown: /data: Permission denied
   chmod: /data: Permission denied
   ```
   Pod entered `Init:CrashLoopBackOff`!

#### Why Did Root Get "Permission Denied"?
In modern Kubernetes, the initContainer had dropped all Linux capabilities (`drop: [ALL]`). In the Linux kernel security model, root (`UID 0`) relies on the **`CAP_DAC_OVERRIDE`** capability to bypass directory read/write/execute permission checks. Because `/data` was already `0700` owned by `10001:10001`, a root process *without* `DAC_OVERRIDE` cannot traverse into the directory!

#### The Fix:
In `infra/helm/urumi-platform/templates/gateway-deployment.yaml`, we explicitly granted `DAC_OVERRIDE` to the initContainer:
```yaml
initContainers:
  - name: volume-permissions
    image: busybox:1.36
    command: ["sh", "-c", "chown -R 10001:10001 /data && chmod 0700 /data"]
    securityContext:
      runAsUser: 0
      capabilities:
        drop:
          - ALL
        add:
          - CHOWN
          - FOWNER
          - DAC_OVERRIDE
```
This allows repeatable, deterministic pod recreations on existing persistent volumes without permission failures.

---

### Single-Writer `Recreate` Strategy for SQLite

SQLite is an embedded, single-process database. If two copies of the Gateway pod ran concurrently on the same PVC, both would attempt to lock `gateway.db`, resulting in database corruption or `SQLITE_BUSY` errors.

To guarantee single-writer safety, the Gateway Deployment is configured with:
```yaml
spec:
  replicas: 1
  strategy:
    type: Recreate
```
When updating the gateway, Kubernetes completely terminates the old pod and unmounts the volume before starting the replacement pod.

---

## 5. The Quality Gate Journey (Gate G0 through Gate G9)

Phase 4 was engineered using a rigorous **10-Gate Quality Assurance System**. Here is what was accomplished and verified at every step:

```
┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐
│  G0  ├──►│  G1  ├──►│  G2  ├──►│  G3  ├──►│  G4  │
└──────┘   └──────┘   └──────┘   └──────┘   └──────┘
 Baseline    ADRs       CRM &      Gateway    Backup &
  Setup    Approved     Tasks      Engine     Recovery
                                                 │
┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐        │
│  G9  │◄──┤  G8  │◄──┤  G7  │◄──┤  G6  │◄───────┘
└──────┘   └──────┘   └──────┘   └──────┘
 Acceptance  NetPol &  Queues &   Dynamic
 & Bench     Helm      Timeouts   Upstreams
```

### Gate G0: Inception, Master Roadmap & Workspace Setup
- Established monorepo npm workspaces (`apps/gateway`, `apps/mcp-crm`, `apps/mcp-tasks`, `packages/shared`).
- Pinned Node.js 24 LTS and TypeScript 5 strict toolchain.
- Captured baseline cluster state (6 pods, 3 PVCs, Order #14 intact).

### Gate G1: Architecture Decision Records (ADR-011 through ADR-015)
- Documented and approved 5 foundational ADRs:
  - **ADR-011:** Centralized Gateway vs. Direct Tool Access.
  - **ADR-012:** SQLite Embedded Persistence with WAL mode.
  - **ADR-013:** Constant-Time API Key Auth & Admin Bootstrap.
  - **ADR-014:** Two-Phase Cryptographic Audit Logging.
  - **ADR-015:** Concurrency Queues, Timeouts & Dynamic Tool Federation.

### Gate G2: Upstream Microservices (CRM & Tasks Implementation)
- Implemented `apps/mcp-crm` (2 tools) and `apps/mcp-tasks` (2 tools).
- Configured SSE transports with Bearer token authentication.
- Wrote 61 unit and protocol tests validating mock datasets and JSON-RPC compliance.

### Gate G3: Gateway Engine & SQLite WAL Persistence
- Built the gateway core in `apps/gateway` using Express and `node:sqlite`.
- Implemented database migrations with foreign keys, busy timeouts, and WAL mode.
- Validated table schemas: `users`, `api_keys`, `upstreams`, `audit_logs`.

### Gate G4: Persistence, Online Backup (`VACUUM INTO`) & Recovery Drill
- Implemented non-locking online database backups using native SQLite `VACUUM INTO`.
- Created backup retention manager (pruning snapshots older than 7 days).
- Executed crash simulation drill: verified that uncheckpointed WAL frames are safely recovered upon gateway restart.
- Authored the [G4 Recovery Runbook](file:///home/rathore/Documents/Urumi%20Assignment/docs/phase-4/g4-recovery-runbook.md).

### Gate G5: Auth, RBAC, Admin API & K8s Secrets Isolation
- Implemented constant-time API key verification (`crypto.timingSafeEqual`).
- Configured admin bootstrap mechanism (`MCP_ADMIN_BOOTSTRAP_TOKEN`).
- Created Admin REST API for upstream registration, patching, and secret rotation.
- Configured Kubernetes RBAC and cross-namespace secret client (`urumi-gateway-secrets`).

### Gate G6: Dynamic Upstream Lifecycle & Tool Discovery
- Implemented `UpstreamCatalogManager` to maintain persistent SSE connections to upstream services.
- Automated dynamic tool discovery: newly registered upstreams dynamically populate the downstream `tools/list` catalog.
- Implemented prefix federation (`<slug>__<tool_name>`).

### Gate G7: Concurrency Control, Queues, Timeouts & Overload Protection
- Implemented global concurrency limiter (max 20 requests) with HTTP 429 backpressure.
- Implemented per-upstream FIFO queues (4 active, 10 queued).
- Integrated `AbortController` timeouts (10,000ms) for all outbound calls.

### Gate G8: Unified Helm Deployment, NetworkPolicies & Security Tightening
- Updated the unified Helm chart (`infra/helm/urumi-platform`).
- Configured Traefik Ingress exposing `POST /mcp` on `dashboard.127.0.0.1.nip.io:8080` while hiding `/admin/*` routes.
- Implemented default-deny egress NetworkPolicies with `kube-router`.
- Conducted positive and negative network probing from inside the cluster.

### Gate G9: End-to-End Acceptance, Pod Replacement Defect Fix & Performance Benchmarks
- Validated monorepo test suite (360 tests passed, 0 failed).
- Fixed the `DAC_OVERRIDE` storage initContainer defect.
- Executed empirical performance benchmarks across concurrency tiers (C=1, 5, 10, 20).
- Confirmed zero mutation of protected store entities (Products 10, 11, 12 and Order #14).
- Authored the [G9 Acceptance Runbook](file:///home/rathore/Documents/Urumi%20Assignment/docs/phase-4/g9-e2e-acceptance-runbook.md) and finalized Phase 4.

---

## 6. Critical Real-World Gotchas & Lessons Learned

### 1. The Ingress Host Header Stripping Trap (`undici` / `fetch`)
**The Problem:** In Node 18+, the native `fetch` client uses `undici`. When sending a request to `http://127.0.0.1:8080/mcp` with a custom header `Host: dashboard.127.0.0.1.nip.io`, `undici` overrides or strips the `Host` header, replacing it with `127.0.0.1:8080`. Traefik Ingress received the wrong host header and returned `404 Not Found`.  
**The Solution:** Instead of connecting to `127.0.0.1` with a manual `Host` header, format the URL as `http://dashboard.127.0.0.1.nip.io:8080/mcp`. The OS resolves the `.nip.io` wildcard domain to `127.0.0.1`, and `undici` automatically formats the HTTP `Host` header correctly!

### 2. The SQLite Companion File Corruption Trap
**The Problem:** Junior engineers often assume that copying `gateway.db` is sufficient for a backup. In WAL mode, dirty pages reside in `gateway.db-wal`. Restoring only `gateway.db` results in a stale or corrupt database.  
**The Solution:** Always execute SQLite's native `VACUUM INTO '<destination_path>'`. This command coordinates with the SQLite engine to flush WAL pages into a consolidated snapshot that can be copied safely while the database is live.

### 3. The Kubernetes API Server Dual-IP Filter Trap
**The Problem:** When configuring egress NetworkPolicies for the Kubernetes API server, allowing only the Service ClusterIP (`10.43.0.1:443`) resulted in dropped packets during secret creation.  
**The Solution:** K3s uses `kube-proxy` iptables DNAT rules. A packet sent to `10.43.0.1:443` is translated *before* leaving the node to the node's physical IP (`172.19.0.2:6443`). The egress NetworkPolicy must allow both the pre-DNAT virtual service (`10.43.0.1/32:443`) and the post-DNAT physical control plane endpoint (`172.19.0.2/32:6443`).

---

## 7. Study & Interview Preparation Guide

### 15 Technical Questions & Answers for System Design & DevOps

#### Q1: Why use an MCP Gateway instead of letting AI models call microservices directly?
**Answer:** Without a gateway, $N$ AI clients connecting to $M$ services create an $N \times M$ integration mesh with fragmented authentication, uncoordinated rate limits, and security vulnerabilities. The Gateway centralizes auth (single API key), prevents tool name collisions via prefixing (`crm__`, `woocommerce__`), enforces rate limits and circuit breakers, records two-phase audit logs, and hides internal cluster topologies behind a single ingress endpoint (`POST /mcp`).

#### Q2: What is SQLite WAL mode, and why did we choose it over Rollback Journal mode?
**Answer:** In Rollback Journal mode, writing locks the entire database, blocking all readers. In Write-Ahead Logging (WAL) mode, writes append frames to a separate log file (`.db-wal`), while readers read committed pages from the main database and the WAL index (`.db-shm`). This allows concurrent readers and writers without lock contention, providing microsecond latencies ideal for high-throughput gateway persistence.

#### Q3: Why is `crypto.timingSafeEqual` required when validating API keys?
**Answer:** Standard string comparisons (`===`) exit early on the first mismatched character, creating measurable timing discrepancies (microsecond/nanosecond variance). Attackers can send thousands of requests and deduce the key character-by-character based on latency. `crypto.timingSafeEqual` compares every byte in constant time regardless of where the mismatch occurs, completely neutralizing timing attacks.

#### Q4: Why do we store the SHA-256 hash of API keys rather than the keys themselves?
**Answer:** Storing plaintext keys means any database leak or unauthorized backup access compromises all credentials. Storing a cryptographic one-way hash (SHA-256) ensures that even if the database is stolen, an attacker cannot reverse the hash to obtain the original API key.

#### Q5: Explain the Two-Phase Audit Logging pattern and why argument hashing is used.
**Answer:** Phase 1 records the request start (`user_id`, `tool_name`, timestamp, `args_hash`), and Phase 2 records completion (`duration_ms`, status, errors). Instead of saving raw JSON arguments (which may contain credit cards, passwords, or customer PII), we compute and store a deterministic SHA-256 hash (`args_hash`). This provides cryptographic proof of the execution for compliance without persisting sensitive cleartext data.

#### Q6: Why did the storage initContainer fail with "Permission Denied" during pod recreation, and how was it resolved?
**Answer:** The volume was hardened to POSIX mode `0700` owned by non-root UID `10001:10001`. The initContainer ran as root (`UID 0`) with all capabilities dropped (`drop: [ALL]`). In the Linux kernel security model, root cannot traverse a directory owned by another user without the `CAP_DAC_OVERRIDE` capability. Granting `DAC_OVERRIDE` in `capabilities.add` resolved the defect.

#### Q7: Why must the Gateway Deployment use `strategy: { type: Recreate }` instead of `RollingUpdate`?
**Answer:** SQLite is an embedded single-process database running on a shared PersistentVolume. If `RollingUpdate` were used, both the terminating pod and the new pod would run simultaneously, attempting to acquire conflicting file locks on `gateway.db` and causing database corruption. `Recreate` guarantees that the old pod releases all file locks before the new pod initializes.

#### Q8: How does the Gateway prevent AI agents from overloading upstream microservices?
**Answer:** Via a two-tier resilience system: (1) A global concurrency limiter capping total in-flight requests at 20 (returning HTTP 429 when exceeded), and (2) Per-upstream FIFO queues that allow a maximum of 4 active requests and 10 queued requests per microservice. Excess requests return JSON-RPC error `-32603`. Outbound calls are also bounded by a 10,000ms `AbortController` timeout.

#### Q9: What is the purpose of cross-namespace secret isolation?
**Answer:** Placing upstream credentials in a dedicated namespace (`urumi-gateway-secrets`) separated from application workloads (`urumi`) enforces least privilege. The Gateway ServiceAccount is granted RBAC permissions strictly in `urumi-gateway-secrets`. Even if an attacker gains control of a pod in `urumi`, they cannot read or tamper with cluster-wide secrets.

#### Q10: How does the Gateway handle tool name collisions across multiple microservices?
**Answer:** Through automated prefix namespacing: `<upstream_slug>__<tool_name>`. If both CRM and Tasks export a tool named `search`, the gateway registers them as `crm__search` and `tasks__search`. The gateway inspects the prefix at runtime to route requests to the correct upstream client.

#### Q11: What is the difference between a NetworkPolicy drop and an application refusal?
**Answer:** An application refusal (e.g., HTTP 401 or 403) occurs when the packet reaches the server, and the application software inspects credentials and returns an error response. A NetworkPolicy drop occurs at the Linux kernel/iptables layer (`kube-router`): packets destined for unauthorized IPs/ports are discarded, resulting in connection timeouts (`fetch failed`) without the target application ever knowing a connection was attempted.

#### Q12: How does the gateway maintain live tool catalogs when an upstream changes without restarting?
**Answer:** The gateway maintains persistent Server-Sent Events (SSE) connections to upstreams. When an upstream is updated or added via the Admin API, the `UpstreamCatalogManager` fetches the updated tool list and notifies downstream MCP clients using the standard MCP protocol notification `notifications/tools/list_changed`.

#### Q13: Why are Kubernetes probes (liveness, readiness) separated from the MCP protocol endpoint?
**Answer:** MCP endpoints require JSON-RPC handshakes, stateful session IDs, and authentication tokens. Kubernetes `kubelet` probes require lightweight, fast, unauthenticated HTTP GET endpoints (`/health`). If the MCP protocol handler or upstream network hangs, the `/health` endpoint can accurately report the container's operational state without triggering false restart loops.

#### Q14: How does SQLite's `VACUUM INTO` achieve non-blocking backups?
**Answer:** `VACUUM INTO` creates an atomic, standalone snapshot of the database while concurrent readers and writers continue operating. It flushes committed pages from the main database and incorporates active frames from the WAL file into a clean, unfragmented target file, ensuring consistency without acquiring exclusive table locks.

#### Q15: Why is non-root container execution (`runAsUser: 10001`) mandatory in production?
**Answer:** If a container running as root (`UID 0`) suffers a container breakout vulnerability, the attacker gains root access to the underlying Kubernetes host node. Running as unprivileged UID `10001` with `readOnlyRootFilesystem: true` and all Linux capabilities dropped ensures that an attacker has no host privileges, cannot modify binaries, and cannot install unauthorized packages.
