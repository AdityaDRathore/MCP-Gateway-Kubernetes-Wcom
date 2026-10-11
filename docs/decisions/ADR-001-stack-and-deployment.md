# ADR-001: Application Stack, Runtime, and Local Kubernetes Strategy

**Status**: Accepted  
**Date**: 2026-10-09  
**Decision Makers**: Aditya Rathore (FDE Candidate), Antigravity AI  

---

## 1. Context & Problem Statement
The assignment requires a multi-tier platform comprising a React dashboard, a team MCP gateway backend, three upstream MCP servers, and a stateful WooCommerce application running on Kubernetes. We must select a runtime, monorepo strategy, local Kubernetes engine, and database persistence model that will reliably function within the machine's 7.6 GiB total RAM (~1.4 GiB available) and translate cleanly to a production VPS (K3s).

---

## 2. Decision

1. **Runtime & Language**:
   - Pinned **Node.js 24 LTS (`v24.20.0`)** via `.nvmrc` and root `package.json` `engines`.
   - Node.js 20 reached official End-of-Life (EOL) in April 2026. As of October 2026, Node.js 24 is the active Long Term Support (LTS) line.
   - The MCP SDK (`@modelcontextprotocol/sdk@1.32.1`), Express, TypeScript, and `@urumi/shared` build and execute cleanly on Node.js 24.
   - TypeScript is used across all services with a shared package (`@urumi/shared`) for common types.

2. **Monorepo Architecture**:
   - Native **npm workspaces** inside a single repository (`apps/*`, `packages/*`).
   - Pinned dependencies with a single committed `package-lock.json`.

3. **Local Kubernetes Engine**:
   - **`k3d` v5.8.3 (K3s inside Docker)** selected as the local development cluster provider.
   - Host port 80 is occupied by native `nginx/1.24.0`, and port 3001 is occupied by Wekan. To avoid port conflicts, k3d ingress load balancer ports are mapped to `8080` (HTTP) and `8443` (HTTPS).
   - Ingress routing utilizes `nip.io` wildcard DNS (`shop.127.0.0.1.nip.io:8080`, `dashboard.127.0.0.1.nip.io:8080`) requiring zero `/etc/hosts` modifications.

4. **Gateway Persistence Engine & Storage Model**:
   - **SQLite with WAL mode mounted on a PersistentVolumeClaim (`/data/gateway.db`)**.
   - Preserves team metadata, hashed user API keys, upstream registrations, and audit logs across pod restarts.
   - Uses <15 MiB RAM, avoiding the 150 MiB+ idle overhead of deploying a separate PostgreSQL pod.
   - *Failure Model*: Guarantees durability across container restarts, deployment rollouts, and node re-schedules on persistent volume storage. Does not protect against physical host disk destruction, which requires external backup replication (e.g. WAL shipping or Litestream) for enterprise disaster recovery.

---

## 3. Alternatives Considered & Rejected

| Alternative | Reason for Rejection |
| :--- | :--- |
| **Node.js 18** | End-of-Life / Deprecated. Fails `npm install` on modern 2025/2026 dependencies with `EBADENGINE` warnings. |
| **Node.js 20** | End-of-Life in April 2026. Cannot be selected for a forward-looking production deployment in late 2026. |
| **PostgreSQL for Gateway** | Rejected due to host memory constraints (~1.4 GiB available). SQLite on PVC meets ACID requirements with 10x lower memory consumption. |
| **Kind instead of k3d** | Rejected because the target production VPS environment explicitly runs K3s. k3d uses the exact same K3s distribution, guaranteeing maximum parity between local and VPS Helm values. |
| **Binding Ingress to Host Port 80** | Rejected because host port 80 is actively bound to `nginx/1.24.0` on the host machine. Modifying host services violates safety constraints. |

---

## 4. Consequences & Verification
- **Positive**: Clean local-to-VPS parity; minimal RAM footprint; no root permissions required to develop and test.
- **Negative**: URLs require port `:8080` locally (e.g. `http://dashboard.127.0.0.1.nip.io:8080`). In production `values-prod.yaml`, this changes to standard port `80`/`443`.
