# ADR-020: Dual-Listener Architecture and Ingress Perimeter Security

**Status**: Accepted & Empirically Verified (Phase 5 Gate P5-G6 Stage 5)  
**Date**: 2026-10-21  
**Decision Makers**: Aditya Rathore (FDE Candidate), Antigravity AI  
**Related Documents**: [`ADR-001`](./ADR-001-stack-and-deployment.md), [`ADR-009`](./ADR-009-kubernetes-network-isolation-and-conditional-policies.md), [`ADR-011`](./ADR-011-gateway-dual-mcp-proxy-and-transport-lifecycle.md), [`ADR-019`](./ADR-019-browser-identity-session-and-csrf.md), [`architecture.md`](../architecture.md)

---

## 1. Context & Problem Statement

Phase 4 of the Urumi Gateway operated a single HTTP listener serving the Model Context Protocol (MCP) stream and health endpoints. 

In Phase 5, the addition of the human administrative dashboard (`apps/dashboard`) introduces browser-facing REST endpoints (`/api/v1/browser/*`) with cookie-based session authentication, member management, key issuance, upstream lifecycle management, and audit inspection.

Combining browser endpoints and machine protocol endpoints on a single HTTP server port exposes critical security risks:
1. **Ambient Authentication Bleed**: If browser cookies were recognized across the entire port, cross-site browser requests could unintentionally authenticate against MCP tool execution routes (`/mcp`), creating severe CSRF exposure to backend WooCommerce mutations.
2. **Perimeter Perimeter Confusion**: Ingress routing and firewall rules could not distinguish between automated external AI agent traffic and internal team administrative dashboard navigation.
3. **DoS & Resource Starvation**: High-volume browser dashboard polling or audit queries could saturate the HTTP event loop, degrading real-time MCP tool proxying latency.

---

## 2. Decision & Architecture

### 2.1 Dual Independent HTTP Listeners in Gateway Node Process
Rather than deploying separate microservices or sharing a single server, the Gateway process (`apps/gateway/src/index.ts`) initializes two distinct Node.js HTTP servers sharing the same in-memory upstream registry and SQLite database connection:

```
                          ┌────────────────────────────────────────────────────────┐
                          │               Urumi Gateway Pod (Node 24)               │
                          │                                                        │
MCP External Agents ─────►│ Port 3000 (MCP Protocol Plane)                         │
(Bearer API Key)          │   - /mcp (SSE / JSON-RPC 2.0 tool execution)           │
                          │   - /health/live, /health/ready, /metrics              │
                          │   - STRICT: Rejects all cookies; Bearer Token ONLY    │
                          │                                                        │
Human Team Browser ──────►│ Port 3001 (Browser Control Plane)                      │
(Session Cookie + CSRF)   │   - /api/v1/browser/* (Auth, Keys, Upstreams, Audit)   │
                          │   - / (Static dashboard assets)                        │
                          │   - STRICT: Enforces CSRF / Origin headers             │
                          │                                                        │
                          │       Shared In-Memory State & SQLite DB Pool          │
                          │       (node:sqlite WAL mode on /data/gateway.db)       │
                          └────────────────────────────────────────────────────────┘
```

1. **Port 3000 (`http-mcp`) — Data/Protocol Plane**:
   - Routes: `/mcp`, `/health/live`, `/health/ready`, `/metrics`.
   - Authentication: Mandatory `Authorization: Bearer <mcp_live_...>` header.
   - Security Policy: All cookies are ignored; requests relying on cookie authentication are rejected with HTTP 401. CSRF is structurally impossible on this port.
2. **Port 3001 (`http-browser`) — Control/Management Plane**:
   - Routes: `/api/v1/browser/session`, `/api/v1/browser/upstreams`, `/api/v1/browser/keys`, `/api/v1/browser/members`, `/api/v1/browser/audit`, and dashboard assets.
   - Authentication: HttpOnly session cookie validated against `browser_sessions` table.
   - Security Policy: Strict Origin/Referer verification and custom header checks on state-mutating requests (`POST`, `PATCH`, `DELETE`).

### 2.2 Kubernetes Service & Ingress Routing
The Helm chart (`infra/helm/urumi-platform`) exposes both ports on the `urumi-gateway` ClusterIP Service:
```yaml
apiVersion: v1
kind: Service
metadata:
  name: urumi-gateway
spec:
  ports:
    - name: http-mcp
      port: 3000
      targetPort: 3000
    - name: http-browser
      port: 3001
      targetPort: 3001
```

Traefik Ingress provides physical boundary separation at the cluster edge:
- **`urumi-gateway.local`**: Ingress routes exclusively to backend Service port `http-mcp` (3000). Requests to `/api/v1/browser/*` return HTTP 404 from the port 3000 server.
- **`urumi-dashboard.local`**: Ingress routes exclusively to backend Service port `http-browser` (3001). Requests to `/mcp` return HTTP 404 from the port 3001 server.

### 2.3 Egress Isolation via Kubernetes NetworkPolicy
As defined in `ADR-009` and refined in Phase 5:
- Inbound traffic to Port 3000 is allowed from Ingress controller and authorized namespace workloads.
- Inbound traffic to Port 3001 is restricted to Ingress controller (dashboard visitors).
- Outbound egress from the Gateway pod is restricted to:
  - DNS resolution (CoreDNS port 53).
  - Internal upstreams: WooCommerce WordPress service (`urumi-store-wordpress:80`), Mock CRM (`urumi-mock-crm:3000`), and Mock Tasks (`urumi-mock-tasks:3000`).
  - All internet egress is blocked by default NetworkPolicy rules.

---

## 3. Consequences & Verification

- **Positive**:
  - Eliminates ambient authentication vulnerabilities between human dashboard and machine MCP tools.
  - Provides clear network boundary isolation at the Kubernetes Service and Ingress levels.
  - Allows independent logging, metrics collection, and rate limiting per listener.
- **Negative**:
  - Two server ports to configure and expose in Helm templates.
  - Local development without Ingress requires targeting two distinct localhost ports (`http://localhost:3000` for MCP, `http://localhost:3001` for Dashboard API).
- **Empirical Verification**:
  - Verified in Phase 5 Gate P5-G6 Stage 5 acceptance suite:
    - `TEST-8.6.1`: Verified port 3000 exclusively handles MCP protocol requests with Bearer auth and rejects cookie authentication.
    - `TEST-8.6.2`: Verified port 3001 exclusively serves browser dashboard and management endpoints with session cookie validation.
    - `TEST-8.6.3`: Verified Ingress hosts route to correct ports with 0 routing bleed.
