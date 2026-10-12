# Phase 3 Execution Log — Custom WooCommerce MCP Server on Kubernetes

**Project:** Urumi — Team MCP Gateway on Kubernetes with WooCommerce  
**Phase:** 3 — Custom WooCommerce MCP Server  
**Namespace:** `urumi`  
**Engineer:** Antigravity AI (Pair Programming with Aditya Rathore)  
**Status:** In Progress (G0, G1, G2, G3, G4, G5, G6 PASS)  

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

---

## 5. Gate G4: Read Tools Implementation & Verification (2026-10-12)

### Scope & Work Order
Authorized by Technical Lead to implement and verify exactly the three read tools:
1. `list_products`
2. `list_orders`
3. `get_order`

### Implementation Details
- **`list_products`**:
  - Bound pagination: `page >= 1` (default 1), `per_page` bounded between 1 and 50 (default 10).
  - Validated filters: `category` (category ID or slug, max 50 chars), `sku` (max 50 chars), `status` (restricted to approved enum: `publish`, `draft`, `pending`, `private`), and `search` (max 100 chars).
  - Wired directly to `WooCommerceClient.listProducts()`.
  - Output mapped via `projectProduct()` returning bounded summary (ID, title, SKU, type, status, price, regular price, stock status, categories).
  - Clean error handling: empty results return `[]`; upstream failures return `{ isError: true, content: [{ text: "Error listing products: ..." }] }`.
- **`list_orders`**:
  - Bound pagination: `page >= 1`, `per_page` bounded between 1 and 50.
  - Validated filters: `status` (approved enum: `pending`, `processing`, `on-hold`, `completed`, `cancelled`, `failed`), `after` and `before` (ISO-8601 timestamps supporting timezone offsets).
  - Date format & range validation: checks `isNaN` for individual timestamps; strictly validates that `after` is earlier than `before`. If `after >= before`, the call is rejected immediately before making any upstream HTTP request.
  - Wired directly to `WooCommerceClient.listOrders()`.
  - Output mapped via `projectOrder()` strictly scrubbing all customer PII (addresses, phone numbers, emails, customer notes, IP addresses, user agents).
- **`get_order`**:
  - Strict order ID validation: requires a positive safe integer (`z.number().int().positive().safe()`, plus runtime guard `Number.isSafeInteger(order_id) && order_id > 0`). Rejects floats, negative numbers, zero, and unsafe integers before upstream calls.
  - Wired directly to `WooCommerceClient.getOrder(orderId)`.
  - Output mapped via `projectOrder()` containing only ID, status, currency, total, date created, payment method, and line items (item ID, name, product ID, quantity, subtotal, total, SKU).
  - **Strict PII Omission Contract**: verified on the returned tool output string (`content[0].text`). Output contains zero raw WooCommerce order fields; billing, shipping, email, phone, customer note, customer IP, and customer user agent are completely excluded.
  - Maps `NotFoundError` (HTTP 404) to clean error response: `{ isError: true, content: [{ text: "Error retrieving order ... not found in store catalog." }] }`.
- **Tool Discovery & Gate Boundary Contract**:
  - Exactly 5 tools registered and advertised via MCP `tools/list`: `list_products`, `create_product`, `list_orders`, `get_order`, `update_order_status`.
  - Write tools `create_product` and `update_order_status` remain intentionally unactivated in Gate G4. Protocol and unit invocations return `{ isError: true }` with message: `"Tool ... is registered for discovery but not activated in Gate G4. Mutation operations are scheduled for Gate G5."`
- **Dependency Injection & Server Wiring**:
  - `createWooCommerceMcpServer(client?: WooCommerceClient)` and `createExpressApp(config: AppConfig, client?: WooCommerceClient)` support optional client injection for isolated protocol testing, while defaulting to live `WooCommerceClient` with environment config in production/live execution.

### Verification Evidence & Test Results
1. **Unit & Contract Tests (`apps/woocommerce-mcp/test/unit/tools.test.ts` + regression)**:
   - **Command**: `npm run test:unit --workspace=apps/woocommerce-mcp`
   - **Result**: 38/38 tests passing across 5 test suites (`tools.test.ts`, `oauth.test.ts`, `errors.test.ts`, `mappers.test.ts`, `logger.test.ts`).
   - Validated schema constraints on all shapes, handler error handling, date range rejection (`after >= before`), order ID safe integer guards, write tool deferral messages, and PII omission contract.
2. **MCP Protocol Transport Tests (`apps/woocommerce-mcp/test/protocol/read-tools.test.ts` + `handshake.test.ts`)**:
   - **Command**: `npm run test:protocol --workspace=apps/woocommerce-mcp`
   - **Result**: 21/21 checks passing over Streamable HTTP transport (`POST /mcp`).
   - Verified exact five tool discovery (`listTools`).
   - Verified calling `list_products`, `list_orders`, and `get_order` through MCP client transport (`callTool`).
   - Verified invalid inputs (page 0, per_page 51, unapproved status, invalid date strings, negative order ID, float order ID) are rejected by protocol before handler/client calls.
   - Verified date range validation rejection (`after >= before`) over protocol without upstream request.
   - Verified PII omission on returned wire response text (`res.content[0].text`).
   - Verified write tools return `isError: true` with Gate G5 deferral message over transport.
3. **Live WooCommerce Store Integration Tests (`apps/woocommerce-mcp/test/integration/read-tools.live.test.ts` + `client.live.test.ts`)**:
   - **Command**: `npm run test:integration --workspace=apps/woocommerce-mcp`
   - **Result**: 27/27 tests passing against live WordPress/WooCommerce store.
   - `list_products`: verified live catalog retrieval of seeded products (`URUMI-MUG-001`, `URUMI-MOUSE-001`, `URUMI-NOTE-001`), category filtering (`16` Accessories -> Mug, `17` Electronics -> Mouse, `18` Stationery -> Notebook), status filtering, search filtering, and bounded pagination (`per_page: 2`).
   - `list_orders`: verified retrieval of live Order #14, status filtering (`processing` matches #14, `completed` returns `[]`), date range filtering (`2026-10-11T00:00:00Z` to `2026-10-12T00:00:00Z` matches #14), and date range rejection (`after >= before`).
   - `get_order`: verified retrieval of live Order #14 (total ₹299.00, line item `URUMI-MUG-001`), clean 404 mapping for nonexistent ID `999999`, and verified zero PII in returned payload.
   - Write tools confirmed unactivated over live server.
4. **Baseline Data Preservation**:
   - Verified all 3 seeded products (10, 11, 12) remain intact via WP-CLI and live REST queries.
   - Verified Order #14 remains in `wc-processing` status with 1x `URUMI-MUG-001` (₹299.00) via WP-CLI.
5. **Secret & PII Log Sanitization**:
   - Logs verified during all test runs: zero plaintext consumer secrets, signed URLs, OAuth signatures, or customer PII in structured logs.

---

## 6. Gate G5: Write Tools Implementation & Verification

### Implementation Details
- **`create_product` Wiring (`apps/woocommerce-mcp/src/tools/index.ts` & `src/woocommerce/client.ts`)**:
  - Full schema validation with Zod (`CreateProductArgsSchema`):
    - `sku`: strictly validated with regex `^[A-Za-z0-9-_]+$` (1–64 characters); spaces and invalid characters rejected before dispatch.
    - `regular_price`: string matching `^\d+(\.\d{1,2})?$`; runtime check strictly enforces decimal parsed as a number greater than 0. Rejects `"0.00"` or negative amounts.
    - `status`: validated against enum (`draft`, `publish`, `pending`, `private`).
    - `manage_stock` and `stock_quantity`: constraint strictly enforced where specifying `stock_quantity` requires `manage_stock: true`. If `stock_quantity` is provided with `manage_stock: false` or omitted, the call is rejected immediately before making any upstream request.
  - Safe concurrency and conflict handling:
    - Pre-checks SKU existence via `getProductBySku(sku)`. Does not treat pre-check as an atomic guarantee.
    - Upstream duplicate-SKU conflicts (WooCommerce 400 `product_invalid_sku` / 409) mapped to `ConflictError` / `{ isError: true }` with clear explanation.
    - Zero automatic retries: `WooCommerceClient.execute` issues exactly one non-retried HTTP POST.
  - Response projection: output projected through `projectProduct()` returning minimal, model-safe object (`id`, `name`, `sku`, `price`, `regular_price`, `status`, `stock_status`, `categories`). Never returns raw upstream response or internal links.
- **`update_order_status` Wiring (`apps/woocommerce-mcp/src/tools/index.ts` & `src/woocommerce/client.ts`)**:
  - Strict input validation:
    - `order_id`: positive safe integer guard (`z.number().int().positive().safe()` and runtime check `Number.isSafeInteger(order_id) && order_id > 0`). Rejects floats, negative numbers, and zero before upstream calls.
    - `status`: validated against approved allow-list enum (`pending`, `processing`, `on-hold`, `completed`, `cancelled`, `failed`). Unapproved statuses rejected before upstream calls.
  - Minimal payload isolation: sends exclusively `{ status }` in PUT payload to WooCommerce REST API; never sends customer notes, addresses, or unrequested order fields.
  - No-op detection: fetches current order status via `getOrder(orderId)`. If `current.status === status`, returns immediately:
    `{ id: orderId, previous_status: current.status, status, updated: false }` without issuing an upstream PUT request.
  - Error mapping: maps nonexistent orders (`NotFoundError` / 404) to `{ isError: true }` with message `"order with ID ... not found in store catalog"`.
  - Zero automatic retries on PUT requests.
- **Test Isolation & Order #14 Protection Contract**:
  - Protected Order #14 is NEVER used for mutation testing.
  - Dedicated disposable test fixtures:
    - Products created during live testing use unique disposable SKUs (`URUMI-TEST-G5-${Date.now()}`). Created products are read back, verified, then permanently deleted via `client.deleteProduct()`.
    - Orders created during live mutation testing use dedicated disposable orders created via internal helper `client.createTestOrder()`. Status mutations are verified, no-op behavior verified, and the disposable order is permanently deleted via `client.deleteOrder()`.
- **Capability Boundary**:
  - The application strictly exposes only the approved 5 MCP tools.
  - The write handlers never accept arbitrary caller-supplied upstream paths or raw API payloads.

### Verification Evidence & Test Results
1. **Unit Tests (`apps/woocommerce-mcp/test/unit/tools.test.ts` + regression)**:
   - **Command**: `npm run test:unit --workspace=apps/woocommerce-mcp`
   - **Result**: 46/46 unit tests passing across 5 test suites.
   - Tested zero-price rejection, stock_quantity without manage_stock rejection, duplicate-SKU ConflictError mapping, float order ID rejection, negative order ID rejection, no-op status mutation detection, and 404 order mapping.
2. **MCP Protocol Transport Tests (`apps/woocommerce-mcp/test/protocol/write-tools.test.ts` + `read-tools.test.ts` + `handshake.test.ts`)**:
   - **Command**: `npm run test:protocol --workspace=apps/woocommerce-mcp`
   - **Result**: 35/35 checks passing over Streamable HTTP transport (`POST /mcp`).
   - Verified valid execution and response projections of `create_product` and `update_order_status` over protocol.
   - Verified pre-call rejection of invalid SKUs, non-decimal prices, zero price, stock constraints, unapproved status enums, negative order IDs, and float order IDs.
   - Verified protocol mapping of duplicate-SKU conflict, 404 not found, and upstream network errors to clean `isError: true` responses.
3. **Live WooCommerce Store Integration Tests (`apps/woocommerce-mcp/test/integration/write-tools.live.test.ts` + `read-tools.live.test.ts` + `client.live.test.ts`)**:
   - **Command**: `npm run test:integration --workspace=apps/woocommerce-mcp`
   - **Result**: 39/39 tests passing sequentially against live WordPress/WooCommerce cluster.
   - `create_product`: created disposable product `URUMI-TEST-G5-...` (₹249.99), verified minimal response projection, read back persisted state from database, verified duplicate SKU conflict rejection (409), permanently deleted product and confirmed readback returns `null`.
   - `update_order_status`: created disposable test order (ID 34), mutated status from `pending` to `on-hold`, verified persisted database state via readback, verified no-op detection on repeated `on-hold` call (`updated: false`), verified nonexistent order 404 mapping, permanently deleted disposable order and confirmed 404 on readback.
   - Verified that protected Order #14 was NEVER touched and remained untouched throughout all tests.
   - Verified that seeded products (10, 11, 12) remained completely untouched.
   - Verified that tool outputs contain zero consumer secrets, API keys, OAuth signatures, or customer PII.
4. **Post-Test Store Baseline Audit via WP-CLI**:
   - Products query (`wp post list --post_type=product`): exactly 3 products present (10, 11, 12); 0 temporary products left behind.
   - Orders query (`wp wc shop_order list`): exactly 1 order present (Order #14 in `processing` status, ₹299.00); 0 temporary orders left behind.

---

## 7. Gate G6: Docker Packaging, Helm Deployment & Network Security Verification
- **Status:** PASS
- **Date:** 2026-10-12
- **Activities:**
  - **Docker Packaging & Image Audit**:
    - Built multi-stage Docker image `urumi-woocommerce-mcp:1.0.0` (Digest: `sha256:d831a5b6b4c3b21c6d930eece6e484c4ccebcbbcdf9bf00ccea98c61eb9fee6a`).
    - Base runtime pinned: `node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1`.
    - Non-root execution: UID `10001` (`mcpuser`), GID `10001` (`mcpuser`).
    - Excluded `.dockerignore` paths: `node_modules`, `dist`, `src`, `test`, `.secrets`, `.env*`, `.git`, `.github`.
    - Filesystem audit verified `/app` contains strictly `dist/`, `package.json`, and production `node_modules/` (zero source `.ts` or test fixtures). Total image size: 187 MB.
    - Verified clean `SIGTERM` signal handling: container shuts down within milliseconds with exit code 0.
    - Imported into local k3d cluster: `k3d image import urumi-woocommerce-mcp:1.0.0 -c urumi`.
  - **Helm Chart Integration**:
    - Created `infra/helm/urumi-platform/templates/mcp-deployment.yaml`:
      - RollingUpdate deployment strategy (`maxSurge: 1`, `maxUnavailable: 0`).
      - Security context: `runAsNonRoot: true`, `runAsUser: 10001`, `runAsGroup: 10001`, `allowPrivilegeEscalation: false`, capabilities `drop: ["ALL"]`, `seccompProfile: RuntimeDefault`.
      - Probes: startup probe (`/health`, 10 failures x 3s = 30s budget), readiness probe (`/health`, 5s period), liveness probe (`/health`, 10s period).
      - Environment injection: `WOOCOMMERCE_CONSUMER_KEY` and `WOOCOMMERCE_CONSUMER_SECRET` injected strictly via `secretKeyRef` targeting `urumi-woocommerce-api`. Zero plaintext credentials in values or manifests.
    - Created `infra/helm/urumi-platform/templates/mcp-service.yaml`:
      - ClusterIP service on port 3000 (targetPort `http`).
      - Zero Ingress, NodePort, or hostPort rules.
    - Created `infra/helm/urumi-platform/templates/networkpolicy.yaml`:
      - `urumi-woocommerce-mcp-netpol`: Ingress allowed strictly from workloads labeled `app.kubernetes.io/component: gateway` and `test-client` on TCP port 3000; egress allowed to WordPress TCP port 80 and CoreDNS UDP/TCP port 53.
      - `urumi-wordpress-netpol`: Ingress allowed from Traefik (`kube-system`), MCP server (`mcp-woocommerce`), and `test-client` on TCP port 80; egress allowed to MariaDB TCP port 3306 and CoreDNS port 53.
      - `urumi-mariadb-netpol`: Ingress allowed strictly from WordPress (`app.kubernetes.io/component: wordpress`) on TCP port 3306.
    - Updated values profiles (`values.yaml`, `values-local.yaml`, `values-prod.yaml`):
      - `helm lint infra/helm/urumi-platform`: 0 chart errors.
      - `helm template` validated for both local and production-like profiles with immutable digest pinning.
  - **Cluster Rollout & Readiness**:
    - Upgraded release `urumi-store` to revision 3 in namespace `urumi`.
    - Pod `urumi-woocommerce-mcp-b4d8d4f99-vkpdb` reached 1/1 Running & Ready with all probes passing.
    - Zero disruption to existing `urumi-wordpress` and `urumi-mariadb-0` pods or persistent storage.
  - **Empirical NetworkPolicy Enforcement Verification**:
    - Verified K3s `kube-router` packet filtering actively running inside `k3d-urumi-server-0`.
    - Positive test: Pod with `component: test-client` reaches `http://urumi-woocommerce-mcp:3000/health` (HTTP 200).
    - Negative test 1 (MCP Ingress): Pod with `component: unauthorized` attempting to connect to `urumi-woocommerce-mcp:3000` is blocked with connection refused (exit code 7).
    - Negative test 2 (WP Ingress): Unauthorized pod attempting to connect to `urumi-wordpress:80` is blocked with connection refused (exit code 7).
    - Negative test 3 (MCP Egress): MCP pod attempting direct connection to MariaDB `urumi-mariadb:3306` is blocked (`ECONNREFUSED`).
    - Positive test 2 (MCP to WP): MCP pod reaches `urumi-wordpress:80/wp-json/` (HTTP 200).
    - Storefront accessibility: `http://shop.127.0.0.1.nip.io:8080/` loads via Traefik Ingress (HTTP 200).
  - **Full Regression Verification**:
    - Unit tests: 46/46 passed (`npm run test:unit --workspace=apps/woocommerce-mcp`).
    - Protocol tests: 35/35 passed (`npm run test:protocol --workspace=apps/woocommerce-mcp`).
    - Live integration tests: 39/39 passed (`npm run test:integration --workspace=apps/woocommerce-mcp`).
    - In-cluster E2E client verification: temporary pod `mcp-e2e-verifier` connected to deployed Service `http://urumi-woocommerce-mcp:3000/mcp`, discovered exact 5 tools, successfully ran `list_products` and `get_order` with zero PII exposure.
  - **Store State & Protected Baseline Preservation**:
    - Verified products 10 (`URUMI-MUG-001`), 11 (`URUMI-MOUSE-001`), 12 (`URUMI-NOTE-001`) remain intact and published.
    - Verified Order #14 remains in `processing` status (₹299.00) with zero mutation.
    - Confirmed zero temporary test fixtures or test pods remaining in the cluster.
