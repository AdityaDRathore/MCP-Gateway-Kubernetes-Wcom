# ADR-016: Upstream Tool Namespacing, Dynamic Catalog Snapshotting, and Health Tracking

**Status**: Accepted  
**Date**: 2026-10-15  
**Decision Makers**: Aditya Rathore (FDE Candidate), Antigravity AI  
**Related Documents**: [`ADR-008`](./ADR-008-five-tool-contract-and-pii-redaction.md), [`ADR-011`](./ADR-011-gateway-dual-mcp-proxy-and-transport-lifecycle.md)  

---

## 1. Context & Problem Statement

Requirement GTW-01 through GTW-04 requires the gateway to aggregate multiple upstream MCP servers into a single unified downstream MCP endpoint. 

This presents three operational challenges:
1. **Tool Name Collisions**: Two independent upstream servers may define identical tool names (e.g. both a CRM and an ERP might register `search_records` or `get_status`).
2. **Catalog Latency & Head-of-Line Blocking**: If the gateway queries every upstream server synchronously every time a downstream client issues `tools/list`, a single slow upstream will delay or fail the entire catalog discovery for all tools.
3. **Health Decoupling**: If an upstream service is down, the gateway’s own Kubernetes readiness probe must not fail, yet administrators and downstream clients must have accurate visibility into upstream reachability.

We must define a deterministic tool namespacing convention, an atomic catalog snapshotting mechanism, and health tracking lifecycles.

---

## 2. Decision

### 2.1 Deterministic Tool Namespacing
- **Namespacing Pattern**: All aggregated tools exposed downstream are prefixed with:
  `{upstream_slug}__{original_tool_name}`
- **Examples**:
  - `woocommerce__list_products`
  - `woocommerce__get_order`
  - `crm__search_contacts`
  - `tasks__create_task`
- **Validation**:
  - `upstream_slug`: Matches regex `^[a-z0-9-]+$` (1..32 characters).
  - Tool names: Standard MCP identifier format.
  - Same basenames across different upstreams (e.g. `crm__search` and `tasks__search`) are fully legal and isolated.
  - A duplicate tool name within the same upstream slug is treated as an upstream schema integrity error and rejected during registration.

### 2.2 Atomic Catalog Snapshotting (Non-Blocking `tools/list`)
- The gateway maintains an in-memory **Catalog Snapshot** representing all registered, enabled, and healthy tools.
- **Serving Path**: When a downstream client calls `tools/list`, the gateway serves directly from the in-memory snapshot with **zero upstream network hops** ($O(1)$ in-memory response, <1ms latency).
- **Snapshot Compilation**:
  - Triggered at startup, on background periodic refresh (every 30 seconds), or immediately upon an Admin API mutation (`POST/PATCH/DELETE /admin/v1/upstreams`).
  - Fetches tools from each enabled upstream in parallel under a 3,000 ms timeout.
  - Validates schemas, prefixes names, strips dangerous remote JSON Schema `$ref` tags, and constructs a new immutable catalog object.
  - **Atomic Swap**: The new catalog object replaces the active catalog reference via a single pointer swap.

### 2.3 Unreachable Upstream Behavior in Catalog
- If an upstream server times out or fails during snapshot compilation:
  - The gateway **does not fail** or throw 500.
  - The upstream’s cached tools are retained with metadata flag `is_reachable: false`, or omitted from the downstream list depending on administrator configuration.
  - Healthy upstreams remain 100% discoverable and callable.

### 2.4 Gateway Health & Readiness Decoupling
The gateway provides two distinct HTTP health endpoints on its web server:

1. **`GET /health/live` (Kubernetes Liveness Probe)**:
   - Verifies the Node.js process is responsive and not stuck in a deadlocked event loop.
   - Returns **HTTP 200 OK** immediately.
2. **`GET /health/ready` (Kubernetes Readiness Probe)**:
   - Verifies:
     - SQLite database file `/data/gateway.db` is open and responsive (`SELECT 1`).
     - Gateway configuration is loaded and valid.
   - **Partial Outage Resiliency**: The readiness probe **MUST NOT fail** when one or more upstream servers are down or degraded. As long as the gateway proxy and persistence are operational, readiness returns **HTTP 200 OK**.
3. **Upstream Health Tracking (Dashboard & Admin API)**:
   - The gateway maintains an active status pill for each registered upstream:
     - `ACTIVE`: Healthy and responding to protocol pings.
     - `DEGRADED`: Transient failures or circuit breaker open.
     - `UNREACHABLE`: Connection refused or timeout.
     - `DISABLED`: Administratively disabled by operator.

---

## 3. Consequences & Verification
- **Positive**: Sub-millisecond `tools/list` responses, complete isolation from upstream discovery lag, zero naming collisions, resilient Kubernetes pod readiness.
- **Negative**: Dynamic changes to an upstream tool's definition may take up to 30 seconds to propagate if not manually refreshed.
- **Verification**: Verified via multi-upstream aggregation tests, dead-upstream isolation tests, and probe verification.
