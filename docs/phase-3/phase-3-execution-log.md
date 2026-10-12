# Phase 3 Execution Log — Custom WooCommerce MCP Server on Kubernetes

**Project:** Urumi — Team MCP Gateway on Kubernetes with WooCommerce  
**Phase:** 3 — Custom WooCommerce MCP Server  
**Namespace:** `urumi`  
**Engineer:** Antigravity AI (Pair Programming with Aditya Rathore)  
**Status:** In Progress (G0, G1, G2 PASS)  

---

## 1. Gate G0 — Baseline Inventory & Preflight Verification
- **Status:** PASS
- **Date:** 2026-10-12
- **Activities:**
  - Verified git branch `main`, commit `7e2cc1b`, clean working tree.
  - Verified Node.js `v24.20.0`, npm `11.19.0`, `.nvmrc` matching `24.20.0`.
  - Verified pinned MCP SDK `@modelcontextprotocol/sdk@1.32.1` in `spikes/mcp-echo/package.json`.
  - Verified local cluster `k3d-urumi-server-0` on `v1.37.1+k3s1` (zero client skew with `kubectl v1.37.1`).
  - Verified running pods in `urumi`: `urumi-wordpress-d994966c6-frqvk` (1/1 Ready) and `urumi-mariadb-0` (1/1 Ready).
  - Verified PVC bindings: `urumi-wordpress-pvc` (Bound) and `urumi-mariadb-pvc` (Bound).
  - Verified Secret `urumi-woocommerce-api` exists with keys `consumer-key` (43 B) and `consumer-secret` (43 B).
  - Recorded protected baseline data via live WP-CLI query:
    - Product ID 10: `URUMI-MUG-001` (₹299, `publish`)
    - Product ID 11: `URUMI-MOUSE-001` (₹799, `publish`)
    - Product ID 12: `URUMI-NOTE-001` (₹149, `publish`)
    - Order #14: Status `processing`, Total `₹299.00`, Currency `INR`, Payment Method `cod`.

---

## 2. Gate G1 — Internal Authentication Investigation
- **Status:** PASS
- **Date:** 2026-10-12
- **Activities:**
  - Provisioned ephemeral diagnostic pod in `urumi` namespace (`urumi-diag`).
  - Verified internal DNS `urumi-wordpress.urumi.svc.cluster.local` resolves to `10.43.146.205`.
  - Verified TCP port 80 connectivity; `GET /wp-json/` returns HTTP 200.
  - Verified unauthenticated `GET /wp-json/wc/v3/products` returns HTTP 401.
  - Investigated `local-dev-rest-ssl.php`: demonstrated that calling `urumi-wordpress.urumi.svc.cluster.local` does not match `$allowed_local_hosts`, blocking Basic Auth.
  - Evaluated Options A-D:
    - Option A (Internal TLS): Apache `mod_ssl` disabled; excessive developer friction.
    - Option B (OAuth 1.0a HMAC-SHA256): Native RFC 5849 one-legged OAuth supported by WooCommerce core for HTTP connections. Consumer secret never transmitted over the wire.
    - Option C (Broaden helper): Rejected due to security risk of sending Base64 credentials over plain HTTP.
  - Empirically proved Option B live:
    - Catalog GET: HTTP 200 (returned 3 products).
    - Product create POST: HTTP 201 (created and deleted test product 19).
    - Invalid secret: HTTP 401 (`"Invalid signature - provided signature does not match."`).
    - Invalid key: HTTP 401 (`"Consumer key is invalid."`).
  - Purged `urumi-diag` pod; confirmed seeded products and Order #14 unchanged.
  - Authored and approved `docs/decisions/ADR-007-in-cluster-rest-api-authentication.md`.

---

## 3. Gate G2 — Application Skeleton & Protocol Verification
- **Status:** PASS
- **Date:** 2026-10-12
- **Activities:**
  - Initialized workspace `apps/woocommerce-mcp` with `package.json` and strict `tsconfig.json`.
  - Configured pinned dependencies: `@modelcontextprotocol/sdk@1.32.1`, `express@^4.21.2`, `zod@^3.24.2`.
  - Implemented `src/config.ts`: startup configuration validation with Zod, failure fast on missing secrets, zero credential leakage.
  - Implemented `src/logging/logger.ts`: structured JSON logging with recursive redaction of credentials, auth tokens, signatures, and customer PII.
  - Implemented `src/http/health.ts`: operational `/health` probe for Kubernetes liveness and readiness checks.
  - Implemented `src/tools/schemas.ts`: strict input validation schemas for all five tools (`list_products`, `create_product`, `list_orders`, `get_order`, `update_order_status`).
  - Implemented `src/tools/index.ts`: exact five-tool registration on `McpServer`.
  - Implemented `src/server.ts`: Express application hosting stateless `StreamableHTTPServerTransport`.
  - Implemented `src/index.ts`: HTTP listener, lifecycle management, and graceful shutdown handlers (`SIGTERM`, `SIGINT`).
  - Executed clean build: `npm install` and `npm run --workspace=apps/woocommerce-mcp build` (0 errors).
  - Executed protocol test suite (`apps/woocommerce-mcp/test/protocol/handshake.test.ts`):
    - Test 1: Operational health check (`GET /health`) returned HTTP 200.
    - Test 2: Streamable HTTP handshake (`initialize`) succeeded.
    - Test 3: Discovered exactly five tools (`listTools`).
    - Test 4: Valid tool execution via protocol succeeded.
    - Test 5: Invalid inputs (negative ID, unapproved status, missing fields, unknown tool) rejected safely by schema.
    - Verdict: 5/5 tests passed.
