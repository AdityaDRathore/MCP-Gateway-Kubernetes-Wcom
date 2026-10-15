# ADR-016: Upstream Tool Namespacing, Dynamic Catalog Snapshotting, and Health Tracking

**Status**: Proposed — Pending Technical Head Approval  
**Date**: 2026-10-15 (Revised: 2026-10-15)  
**Decision Makers**: Aditya Rathore (FDE Candidate), Antigravity AI  
**Related Documents**: [`ADR-008`](./ADR-008-five-tool-contract-and-pii-redaction.md), [`ADR-011`](./ADR-011-gateway-dual-mcp-proxy-and-transport-lifecycle.md)  

---

## 1. Context & Problem Statement

Requirement GTW-01 through GTW-04 requires the gateway to aggregate multiple upstream MCP servers into a single unified downstream MCP endpoint. 

We must define:
1. Deterministic namespacing `{slug}__{tool_name}` to avoid collisions.
2. Catalog snapshotting mechanics that guarantee non-blocking `tools/list` responses.
3. Exact behavior of the catalog and router when an upstream server is unreachable or disabled.
4. Health probe decoupling so upstream outages do not fail the gateway pod's Kubernetes readiness probe.

---

## 2. Decision & Technical Architecture

### 2.1 Deterministic Tool Namespacing
- **Pattern**: Every aggregated tool exposed to downstream clients is formatted as:
  `{upstream_slug}__{original_tool_name}`
- **Examples**:
  - `woocommerce__list_products`
  - `woocommerce__get_order`
  - `crm__search_contacts`
  - `tasks__create_task`
- **Validation**:
  - `upstream_slug`: Lowercase alphanumeric with hyphens (`^[a-z0-9-]+$`, 2..32 chars).
  - Basename collisions across different servers (e.g. `crm__search` and `tasks__search`) are legal and isolated.
  - Duplicate public names within a single upstream are treated as upstream schema integrity errors and rejected during catalog compilation.

---

### 2.2 Catalog Snapshotting & Unreachable Upstream Behavior

The gateway maintains an in-memory **Catalog Snapshot** representing all registered tools:

```mermaid
flowchart TD
    Client["AI Client"] -->|tools/list| Router["Gateway Router"]
    Router -->|Read O(1)| Snapshot["In-Memory Catalog Snapshot"]
    
    subgraph Upstreams ["Internal Upstreams"]
        Woo["WooCommerce (Healthy)"]
        CRM["CRM Mock (Unreachable / 503)"]
        Tasks["Tasks Mock (Healthy)"]
    end
    
    Refresher["Catalog Refresher (30s TTL / Event)"] -.->|Parallel tools/list| Upstreams
    Refresher -->|Compile & Atomic Swap| Snapshot
```

#### Reconciled Behavior for Unreachable & Disabled Upstreams:
1. **Disabled Upstreams (`is_enabled: 0`)**:
   - Tools from disabled upstreams are **strictly excluded** from the downstream `tools/list` response.
   - If an AI agent attempts to invoke a disabled tool, the gateway rejects it immediately with **HTTP 404 Not Found / ToolDisabledError** before making any network call.
2. **Unreachable Upstreams (`is_enabled: 1` but pod down / timeout)**:
   - When an enabled upstream fails its protocol ping or catalog refresh, the gateway retains its tool definitions in the catalog snapshot, but tags them with `_meta: { reachable: false, error: "Upstream unreachable" }`.
   - **Non-Blocking Invariant**: When an AI client calls an unreachable tool, the gateway **immediately returns a clean, model-facing error**:
     ```json
     {
       "content": [{ "type": "text", "text": "Upstream service 'crm' is currently unreachable. The tool could not be executed." }],
       "isError": true
     }
     ```
   - *Rationale*: Failing fast avoids stalling the client for the full 10-second request timeout when the gateway already knows the upstream connection is dead.
3. **Atomic Catalog Swap**:
   - Dynamic catalog updates do not mutate active dictionaries in-place.
   - The refresher builds an immutable catalog object and swaps the memory pointer atomically.

---

### 2.3 Health Probes & Readiness Decoupling

The gateway exposes two distinct health endpoints:

1. **`GET /health/live` (Kubernetes Liveness Probe)**:
   - Verifies process event loop is active. Returns **HTTP 200 OK** immediately.
2. **`GET /health/ready` (Kubernetes Readiness Probe)**:
   - Verifies:
     - SQLite database `/data/gateway.db` is readable (`SELECT 1`).
     - Gateway configuration is loaded and valid.
   - **Partial Outage Resiliency**: The readiness probe **MUST NOT fail** when one or more upstream servers are down or degraded. As long as the gateway proxy and persistence are operational, readiness returns **HTTP 200 OK**.
3. **Upstream Health Tracking**:
   - The gateway maintains status indicators for registered upstreams:
     - `ACTIVE`: Healthy and responding to protocol pings.
     - `DEGRADED`: Transient failures or circuit breaker open.
     - `UNREACHABLE`: Connection refused or timeout.
     - `DISABLED`: Administratively disabled by operator.

---

## 3. Consequences & Verification
- **Positive**: Sub-millisecond non-blocking `tools/list`, instant failure reporting on known dead upstreams, zero catalog naming collisions.
- **Negative**: Unreachable tools remain visible in catalog until administratively disabled.
- **Verification**: Verified via test suites simulating unreachable upstreams during `tools/list` and `tools/call`.
