# ADR-002: MCP Protocol Compatibility, Transport, and SDK Selection

**Status**: Accepted & Verified by Spike  
**Date**: 2026-10-09  
**Decision Makers**: Aditya Rathore (FDE Candidate), Antigravity AI  

---

## 1. Context & Problem Statement
The Model Context Protocol (MCP) specification has evolved from early HTTP+SSE drafts into the official **Streamable HTTP transport specification**. In the official TypeScript SDK, legacy transports (`SSEServerTransport`) are marked `@deprecated` in favor of `StreamableHTTPServerTransport`. The assignment brief requires a custom server using Streamable HTTP, capable of interoperating with external clients such as **MCP Inspector**, Cursor, and Claude Code using individual static API keys.

We must pin an exact SDK version, establish transport terminology, and prove end-to-end tool discovery, execution, and header-based authentication with concrete execution evidence.

---

## 2. Decision

1. **Pinned SDK Package**:
   - Package: `@modelcontextprotocol/sdk`
   - Exact Pinned Version: **`1.32.1`** (released October 2026).
   - Node.js Runtime: Node.js 20 LTS (`v20.20.2`).

2. **Wire Protocol Version**:
   - The negotiated MCP wire protocol version is **`2024-11-05`** (transmitted in the `mcp-protocol-version` header and `initialize` JSON-RPC response).

3. **Transport Specification & Architecture**:
   - **Transport**: **Streamable HTTP** (implemented via `StreamableHTTPServerTransport` on the server and `StreamableHTTPClientTransport` on the client).
   - **Mode**: Stateless Streamable HTTP per-request lifecycle (following the official SDK architecture demonstrated in `simpleStatelessStreamableHttp.js`):
     - For each incoming HTTP request, a fresh transport and server instance are instantiated and connected.
     - Handles `POST /mcp` for both JSON-RPC requests (`initialize`, `tools/list`, `tools/call`) and notifications (`notifications/initialized` returning HTTP 202).
     - Cleans up and tears down transport upon request completion (`res.on('close')`).

4. **Authentication & Authorization**:
   - Custom Header Authentication: `Authorization: Bearer <user_api_key>`.
   - Validated at the Express middleware layer before passing requests to the transport.
   - Unauthenticated or invalid requests receive an immediate **HTTP 401 Unauthorized** with structured JSON error.

---

## 3. Empirical Verification Evidence (Spike Test Run)

A dedicated, isolated verification suite was built in `spikes/mcp-echo/`:
- **Server**: Express app listening on `http://127.0.0.1:7777/mcp` using `StreamableHTTPServerTransport` with tool `echo_message({ message: string })`.
- **Client**: `test-client.ts` using `Client` and `StreamableHTTPClientTransport`.

### Actual Command Output from Verification Run:
```
====================================================
🧪 Starting MCP Streamable HTTP Protocol Spike Tests
Target: http://127.0.0.1:7777/mcp
====================================================

👉 [Test 1/4] Testing Authentication Enforcement (Reject Invalid/Missing Key)...
   ✅ Request successfully rejected as expected: Streamable HTTP error: Error POSTing to endpoint: {"error":"Unauthorized","message":"Missing or invalid Authorization header. Expected Bearer <api_key>."}
   ✅ PASS: Authentication barrier verified (401 Unauthorized).

👉 [Test 2/4] Connecting with Valid Authorization Header over Streamable HTTP...
   ✅ Connected successfully over Streamable HTTP!
   ✅ Handshake completed.
   ✅ PASS: Streamable HTTP connection & protocol handshake established.

👉 [Test 3/4] Testing Tool Discovery (client.listTools)...
   Found 1 tool(s):
   - Name: echo_message
     Description: Echoes back the received message with a server timestamp
     Input Schema: {"type":"object","properties":{"message":{"type":"string","description":"The message text to echo back"}},"required":["message"],"additionalProperties":false,"$schema":"http://json-schema.org/draft-07/schema#"}
   ✅ PASS: Tool "echo_message" discovered via protocol.

👉 [Test 4/4] Testing Tool Execution (client.callTool)...
   Tool call raw response: {
  "content": [
    {
      "type": "text",
      "text": "Echo from Streamable HTTP Server: Hello Urumi AI Take-Home Spike! (timestamp: 2026-10-09T13:20:08.240Z)"
    }
  ]
}
   ✅ PASS: Tool "echo_message" executed successfully with verified output.

🔌 Client disconnected cleanly.
====================================================
🏁 Spike Verification Summary: 4/4 tests passed
🎉 VERDICT: ALL MCP PROTOCOL COMPATIBILITY CHECKS PASSED!
====================================================
```

---

## 4. External Client Compatibility: MCP Inspector
The official **MCP Inspector** (`@modelcontextprotocol/inspector`) runs directly via `npx` and connects to Streamable HTTP endpoints. When testing User B:
- Endpoint: `http://dashboard.127.0.0.1.nip.io:8080/mcp`
- Transport: `Streamable HTTP`
- Custom Headers: `Authorization: Bearer <user_b_api_key>`
- Inspector connects, lists tools across all enabled servers, and allows visual execution of tool calls.

---

## 5. Consequences & Forward Roadmap
- **Phase 3 (WooCommerce MCP)**: Will directly adopt this verified `StreamableHTTPServerTransport` stateless architecture.
- **Phase 4 (Gateway Engine)**: Gateway backend will act as a `StreamableHTTPClientTransport` to the internal WooCommerce, CRM, and Tasks upstreams, and a `StreamableHTTPServerTransport` to downstream clients.
