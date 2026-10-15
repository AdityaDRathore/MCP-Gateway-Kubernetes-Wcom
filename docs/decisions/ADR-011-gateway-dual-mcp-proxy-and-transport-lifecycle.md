# ADR-011: Gateway Dual MCP Proxy Architecture and Transport Lifecycle

**Status**: Accepted  
**Date**: 2026-10-15  
**Decision Makers**: Aditya Rathore (FDE Candidate), Antigravity AI  
**Related Documents**: [`ADR-002`](./ADR-002-mcp-compatibility.md), [`ADR-008`](./ADR-008-five-tool-contract-and-pii-redaction.md)  

---

## 1. Context & Problem Statement

Phase 4 requires building the central Team MCP Gateway (`apps/gateway`). The gateway acts as a **dual MCP proxy**:
1. **Downstream MCP Server**: Exposes an authenticated Model Context Protocol endpoint (`POST /mcp`) to external AI clients (Claude Code, MCP Inspector, internal Chat Agent).
2. **Upstream MCP Client Manager**: Connects to multiple upstream MCP servers running inside the Kubernetes cluster (`urumi-woocommerce-mcp`, `urumi-mcp-crm`, `urumi-mcp-tasks`).

We must establish the exact transport lifecycles, connection management patterns, concurrency guarantees, and cancellation mechanics for both downstream and upstream sides, pinned to `@modelcontextprotocol/sdk@1.32.1` on Node.js 24 LTS.

---

## 2. Decision

### 2.1 Pinned Protocol & SDK Version
- **Package**: `@modelcontextprotocol/sdk@1.32.1` across all Phase 4 applications (`apps/gateway`, `apps/mcp-crm`, `apps/mcp-tasks`).
- **Wire Protocol Version**: `2024-11-05` (RFC JSON-RPC 2.0).
- **Runtime**: Node.js 24 LTS (`v24.20.0`).

### 2.2 Downstream Transport: Stateless Streamable HTTP
- The gateway exposes `POST /mcp` utilizing `StreamableHTTPServerTransport`.
- **Stateless Per-Request Lifecycle**: Following [`ADR-002`](./ADR-002-mcp-compatibility.md), each incoming HTTP request instantiates an ephemeral `McpServer` and `StreamableHTTPServerTransport` instance bound to the request/response pair.
- The transport handles `initialize`, `notifications/initialized`, `tools/list`, and `tools/call`.
- The connection is cleanly torn down on `res.on('close')`.
- Downstream clients do not require sticky sessions or persistent SSE streams.

### 2.3 Upstream Transport: Single Reusable Client per Service
- The gateway maintains **one active `Client` instance per registered upstream server** utilizing `StreamableHTTPClientTransport`.
- **Lifecycle States**:
  - `DISCONNECTED`: Initial state prior to connection.
  - `CONNECTING`: Single-flight connection handshake (`client.connect(transport)`).
  - `CONNECTED`: Active session ready to service tool calls.
  - `DEGRADED`: Transient upstream failure (subject to circuit-breaker policy).
  - `DRAINING`: Gracefully waiting for in-flight calls to complete before termination.
  - `CLOSED`: Transport closed and resources freed.
- **Client Reuse Proof**:
  - Inspection of `@modelcontextprotocol/sdk@1.32.1` confirms `Client.prototype.request` assigns monotonic JSON-RPC request IDs (`_requestMessageId++`) and routes responses through an internal map (`_responseHandlers`).
  - A single connected `Client` safely handles concurrent asynchronous requests without transport collision.
  - Single reusable clients eliminate the overhead of repeated TCP handshakes and MCP protocol initialization per tool call.

### 2.4 Timeout and Cancellation Semantics
- **Default Upstream Timeout**: **10,000 ms** (10.0 seconds).
- **Timeout Bounds**: Overrides via Admin API are bounded between **500 ms** and **30,000 ms**.
- **Cancellation Execution**:
  - When a timeout occurs, an `AbortController` triggers `signal.abort()`.
  - The SDK client intercepts the abort signal, sends `notifications/cancelled` to the upstream server, cleans up the request handler, and rejects the promise with `UpstreamTimeoutError`.
- **Non-Negotiable Mutation Invariant**:
  - A local timeout does not guarantee that the upstream side-effect was aborted.
  - The gateway **never automatically retries a mutating write operation** (`create_product`, `update_order_status`, `create_task`, `update_task_status`).
  - Callers receive an explicit, unambiguous error indicating the operation timed out and must be verified by reading state before re-attempting.

---

## 3. Alternatives Considered & Rejected

| Alternative | Rationale for Rejection |
|---|---|
| **Per-Request Upstream Connection** | Re-connecting and re-initializing MCP protocol on every tool call adds 40–80ms latency per invocation and creates socket churn in Kubernetes. |
| **Legacy HTTP+SSE Upstream Transport** | Deprecated in MCP SDK 1.32.1; requires persistent GET streams vulnerable to silent proxy timeouts. |
| **Automatic Mutation Retries on Timeout** | Violates safety invariants. If WooCommerce or MariaDB committed the write during network delay, retrying creates duplicate products or duplicate orders. |

---

## 4. Consequences & Verification
- **Positive**: Low invocation latency, robust multiplexing, memory-safe request cleanup, zero blind write retries.
- **Negative**: Gateway must maintain reconnect logic for upstream clients on pod restarts.
- **Verification**: Verified via protocol test suites in `apps/woocommerce-mcp/test/protocol/` and upcoming G3 gateway protocol integration suites.
