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

---

## 4. Gate G3 — Authenticated WooCommerce API Client Implementation & Verification
- **Status:** PASS
- **Date:** 2026-10-12
- **Activities:**
  - Implemented OAuth 1.0a HMAC-SHA256 signer (`apps/woocommerce-mcp/src/woocommerce/oauth.ts`):
    - Strict RFC 3986 percent encoding (`rfc3986`) conforming to RFC 5849 Section 3.6.
    - Normalized parameter collection merging query parameters and OAuth parameters.
    - Lexicographical parameter sorting per RFC 5849 Section 3.4.1.3.2.
    - Architectural separation of transport base URI (`http://urumi-wordpress.urumi.svc.cluster.local:80`) and signature base URI (`http://shop.127.0.0.1.nip.io:8080`) mandated by WooCommerce core `check_oauth_signature()`.
  - Implemented domain error mapping and bounds (`apps/woocommerce-mcp/src/woocommerce/errors.ts`):
    - Typed hierarchy: `AuthenticationError`, `PermissionDeniedError`, `NotFoundError`, `ConflictError`, `UpstreamTimeoutError`, `UpstreamPayloadTooLargeError`, `UpstreamServerError`, `UpstreamProtocolError`.
    - All domain errors marked non-retryable (`isRetryable: false`) to prevent ambiguous write retries.
    - HTML tag stripping and sanitization to prevent raw HTML/script leakage to LLMs.
  - Implemented response validation and PII scrub mappers:
    - `src/woocommerce/schemas.ts`: Zod validation of upstream WooCommerce responses.
    - `src/woocommerce/mappers.ts`: Output projections strictly omitting customer billing/shipping addresses, phone numbers, email addresses, order customer notes, and IP addresses.
  - Implemented `WooCommerceClient` (`apps/woocommerce-mcp/src/woocommerce/client.ts`):
    - Implemented custom `httpTransport` using `node:http` and `node:https` to prevent Undici/fetch from stripping custom `Host` headers (`urumi-wordpress.urumi.svc.cluster.local`).
    - Enforced 1 MiB hard response budget during chunk streaming (immediately destroying socket on breach).
    - Enforced configurable timeout (`REQUEST_TIMEOUT_MS`) mapping directly to non-retryable `UpstreamTimeoutError`.
    - Zero retry on `POST`/`PUT` operations.
    - Implemented API methods for all 5 target operations: `listProducts`, `getProductBySku`, `createProduct`, `listOrders`, `getOrder`, `updateOrderStatus`.
  - Executed Unit Test Suite (`apps/woocommerce-mcp/test/unit/*.test.ts`):
    - Error mapping, sanitization, and response bounds: 7/7 pass.
    - Output projection and PII redaction: 2/2 pass.
    - OAuth 1.0a canonicalization, sorting, and determinism: 4/4 pass.
    - Unit suite verdict: 13/13 tests passed.
  - Executed Live Integration Test Suite (`apps/woocommerce-mcp/test/integration/client.live.test.ts`):
    - Test 1: Live catalog read: retrieves seeded products 10, 11, 12 (PASS).
    - Test 2: Live query-filtered read: pagination (`per_page=2`) and SKU filter (`URUMI-MUG-001`) (PASS).
    - Test 3: Live order read: Order #14 retrieved and verified zero customer PII (PASS).
    - Test 4: Live orders list: bounded list without customer PII (PASS).
    - Test 5: Negative auth: invalid consumer key and secret rejected with HTTP 401 (PASS).
    - Test 5b: Negative auth: missing credentials rejected with HTTP 401 (PASS).
    - Test 5c: Live nonce replay enforcement: replaying exact same nonce and timestamp rejected by WooCommerce core with HTTP 401 (`"Invalid nonce - nonce has already been used."`) (PASS).
    - Test 5d: Live timestamp freshness enforcement: stale timestamp (>15 mins) rejected by WooCommerce core with HTTP 401 (`"Invalid timestamp."`) (PASS).
    - Test 6: Non-existent resource: safely mapped to HTTP 404 `NotFoundError` (PASS).
    - Test 7: Duplicate SKU prevention: pre-checks SKU and blocks conflict before mutation (PASS).
    - Test 8: Live product create & cleanup: disposable test product created via REST API and deleted via WP-CLI (PASS).
    - Test 9: Timeout enforcement: aborts long-running request without retry (PASS).
    - Live suite verdict: 12/12 tests passed.
  - Verified API Key Scoping and Credentials:
    - Inspected `wp_woocommerce_api_keys`: Key ID 1 belongs to user ID 2 (`urumi-mcp-integration`) with role `shop_manager` and permissions `read_write`.
    - Principle of least privilege satisfied: integration user cannot modify WordPress core, plugins, themes, or administrator accounts.
  - Verified Baseline Store State Preservation:
    - Seeded products intact: ID 10 (`URUMI-MUG-001`), ID 11 (`URUMI-MOUSE-001`), ID 12 (`URUMI-NOTE-001`).
    - Order #14 intact: status `processing`, INR 299.00. Zero extraneous records in store catalog.

### 4.1 Gate G3 Focused Checks & Full Acceptance Verification
- **Status:** PASS (Fully Accepted)
- **Date:** 2026-10-12
- **Activities:**
  - Refactored OAuth parameter comparator in `apps/woocommerce-mcp/src/woocommerce/oauth.ts`:
    - Replaced locale-dependent string sorting with explicit RFC 5849 byte-value comparator (`rfc5849ByteComparator`): `a < b ? -1 : (a > b ? 1 : 0)`.
    - Handled duplicate parameter keys by sorting secondary on percent-encoded values per RFC 5849 Section 3.4.1.3.2.
    - Added deterministic unit tests in `apps/woocommerce-mcp/test/unit/oauth.test.ts` for byte comparator, duplicate parameter keys, spaces, reserved characters (`!`, `'`, `(`, `)`, `*`, `&`, `=`), and multi-byte UTF-8 sequences (accents, Indian Rupee `₹`, Hindi text, emoji).
  - Hardened log sanitization in `apps/woocommerce-mcp/src/logging/logger.ts` and `apps/woocommerce-mcp/src/woocommerce/client.ts`:
    - Implemented `sanitizeString` to scrub signed URLs, query parameters, OAuth signatures (`oauth_signature=[REDACTED]`), consumer keys (`oauth_consumer_key=[REDACTED]`), nonces, consumer secrets, auth headers, and customer emails.
    - Wrapped network error messages in `client.ts` through `sanitizeString` before logging and throwing.
    - Created dedicated unit test suite `apps/woocommerce-mcp/test/unit/logger.test.ts` (3/3 tests passing) proving full URL scrubbing and recursive metadata redaction.
  - Documented effective permissions and threat model for `urumi-mcp-integration`:
    - WooCommerce core REST API supports only coarse `read`, `write`, `read_write` scopes and lacks sub-resource or per-endpoint scoping.
    - Service account user ID 2 (`urumi-mcp-integration`) possesses role `shop_manager` (permitting product and order management while denying WordPress administrator rights like `manage_options` or plugin/theme editing).
    - The MCP server application layer acts as the authoritative least-privilege enforcement boundary: exposing strictly the five approved tools and executing zero deletion, refund, or configuration mutations.
  - Preserved Kubernetes private boundary & NetworkPolicy requirements:
    - Reaffirmed that `ClusterIP` alone provides neither caller authorization nor transport encryption; in-cluster HTTP traffic remains unencrypted.
    - Documented invariant that private endpoint reachability and NetworkPolicy enforcement (restricting pod-to-pod traffic to Gateway -> WooCommerce MCP -> WordPress) will be implemented and validated during Gates G6 and G7.
  - Full Regression Verification:
    - Unit Tests: 20/20 passed across 4 test suites (`oauth.test.ts`, `errors.test.ts`, `mappers.test.ts`, `logger.test.ts`).
    - Protocol Tests: 5/5 passed (`handshake.test.ts`).
    - Live Integration Tests: 12/12 passed against live store (`client.live.test.ts`).
    - TypeScript compilation: 0 errors via `npm run typecheck` and `npm run build`.
    - Baseline Store Preservation: WP-CLI query confirms products 10, 11, 12 and Order #14 are 100% intact.


