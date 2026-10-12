# Urumi AI FDE — Phase 3 Execution Roadmap
## Custom WooCommerce MCP Server: Technical Work Order, Contracts, Verification Plan, and Exit Gate

**Project:** Urumi — Kubernetes-Based MCP Gateway  
**Phase:** 3 — Custom WooCommerce MCP Server  
**Status:** Proposed work order; Phase 2 accepted based on the completion evidence supplied by the technical lead  
**Prepared:** 12 October 2026  
**Target execution window:** 13–14 October 2026, with a short preflight on 12 October  
**Repository:** <https://github.com/AdityaDRathore/MCP-Gateway-Kubernetes-Wcom>  
**Primary owner:** Implementation AI / engineering agent  
**Product manager:** Aditya + project-manager AI  

---

## 0. Executive decision

**Phase 3 objective:** Implement a custom TypeScript MCP server that exposes the live WooCommerce store's products and orders as five MCP tools over Streamable HTTP, runs inside the existing `k3d-urumi` Kubernetes cluster, reads its integration credentials from the existing Kubernetes Secret, and is reachable only through an internal Kubernetes Service and a verified ingress NetworkPolicy.

Phase 3 is not the gateway. It must not implement team-member API keys, upstream registration UI, tool aggregation, the dashboard, chat/LLM orchestration, CRM, or task-management MCP services. Those belong to later phases.

### Mandatory tool set

1. `list_products`
2. `create_product`
3. `list_orders`
4. `get_order`
5. `update_order_status`

This is the five-tool minimum explicitly required by the Urumi brief. The implementation must call the actual WooCommerce REST API, not an in-memory mock or direct database query. WooCommerce's recommended REST API is `/wp-json/wc/v3/`; the official reference documents product/order CRUD, ISO date filters, pagination, response codes, and monetary fields as decimal strings. [Official WooCommerce REST API](https://developer.woocommerce.com/docs/apis/rest-api/) · [Products](https://developer.woocommerce.com/docs/apis/rest-api/v3/products) · [Orders](https://developer.woocommerce.com/docs/apis/rest-api/v3/orders/)

### Phase 3 completion outcome

At the end of this phase, an MCP client must be able to discover the five tools and execute each one against the running store. A product created through `create_product` must appear in the live storefront. Orders must reflect actual WooCommerce data, including the existing baseline Order #14. `update_order_status` must mutate a real test order and confirm the result. Kubernetes must deploy the server from the unified Helm chart, with health probes, resource requests/limits, Kubernetes Secret references, no public Ingress route, and tested network restrictions.

---

## 1. Decision basis and current repository facts

This section records what was found in the project material / current default branch at preparation time. These are inputs to the implementation, not permission to skip the preflight checks.

### 1.1 Phase 2 assets to reuse

- Local Kubernetes context: `k3d-urumi`.
- Namespace: `urumi`.
- Store deployment: `urumi-wordpress`.
- Store Service: `urumi-wordpress`, `ClusterIP`, port 80.
- Database StatefulSet: `urumi-mariadb`, internal-only port 3306.
- WooCommerce base API route: `/wp-json/wc/v3/`.
- Existing Kubernetes Secret: `urumi-woocommerce-api` in namespace `urumi`.
- Secret keys: `consumer-key` and `consumer-secret`.
- WordPress integration user: `urumi-mcp-integration`, WooCommerce `shop_manager` role according to the Phase 2 execution log.
- Existing test products: `Urumi Test Mug` (SKU `URUMI-MUG-001`, ₹299), `Wireless Mouse Demo` (SKU `URUMI-MOUSE-001`, ₹799), and `Notebook Demo` (SKU `URUMI-NOTE-001`, ₹149).
- Existing baseline order: Order #14, COD, `processing`, total INR 299.00.
- Store and MariaDB persistence across pod replacement are reported as tested in `docs/phase-2/phase-2-execution-log.md`.
- Root monorepo uses npm workspaces for `apps/*` and `packages/*`, Node.js `v24.20.0`, and a committed root lockfile.
- Existing MCP compatibility spike is in `spikes/mcp-echo/`, using `@modelcontextprotocol/sdk` pinned to `1.32.1`, Zod, Express, and the tested stateless Streamable HTTP pattern.
- Existing Helm chart is `infra/helm/urumi-platform/`. The values tree already has an `upstreams.woocommerce` section and resource settings, but there are no `apps/mcp-woocommerce/*` source files on the current branch checked for this roadmap.

Source files inspected:
- [`scripts/bootstrap-store.sh`](https://github.com/AdityaDRathore/MCP-Gateway-Kubernetes-Wcom/blob/main/scripts/bootstrap-store.sh)
- [`docs/phase-2/store-deployment.md`](https://github.com/AdityaDRathore/MCP-Gateway-Kubernetes-Wcom/blob/main/docs/phase-2/store-deployment.md)
- [`docs/phase-2/phase-2-execution-log.md`](https://github.com/AdityaDRathore/MCP-Gateway-Kubernetes-Wcom/blob/main/docs/phase-2/phase-2-execution-log.md)
- [`docs/phase-2/image-lock.md`](https://github.com/AdityaDRathore/MCP-Gateway-Kubernetes-Wcom/blob/main/docs/phase-2/image-lock.md)
- [`docs/decisions/ADR-002-mcp-compatibility.md`](https://github.com/AdityaDRathore/MCP-Gateway-Kubernetes-Wcom/blob/main/docs/decisions/ADR-002-mcp-compatibility.md)
- [`infra/helm/urumi-platform/templates/wordpress-service.yaml`](https://github.com/AdityaDRathore/MCP-Gateway-Kubernetes-Wcom/blob/main/infra/helm/urumi-platform/templates/wordpress-service.yaml)
- [`infra/helm/urumi-platform/templates/wordpress-deployment.yaml`](https://github.com/AdityaDRathore/MCP-Gateway-Kubernetes-Wcom/blob/main/infra/helm/urumi-platform/templates/wordpress-deployment.yaml)

### 1.2 Important caveat: internal REST authentication must be proven

The Phase 2 REST helper at `infra/helm/urumi-platform/files/local-dev-rest-ssl.php` sets `$_SERVER['HTTPS'] = 'on'` only for the explicit local storefront hostnames (`shop.127.0.0.1.nip.io`, `localhost`, `127.0.0.1`) and `/wp-json/wc/` paths. It does **not** list the internal Service DNS name `urumi-wordpress.urumi.svc.cluster.local`. Therefore, it is not established that the current Basic-Auth workaround will function when the MCP pod calls the WordPress Service directly.

Do not assume the internal call works just because the host-side test through Ingress succeeded. Do not solve the issue by routing the MCP pod out through the public/local Ingress without first justifying it. A request from the MCP pod must be tested against the internal Service DNS name.

**Preferred implementation direction:** use the official `@woocommerce/woocommerce-rest-api` client (currently version `1.0.2` in its upstream package manifest) or another reviewed client that implements WooCommerce's documented OAuth 1.0a signing for plain HTTP. Its upstream source selects OAuth request parameters when the configured URL is HTTP and uses Basic Auth for HTTPS. This avoids sending the consumer secret in a Basic Authorization header over the cluster's unencrypted HTTP path. Pin the exact dependency and prove the behavior against this store before depending on it. The official WooCommerce docs say HTTP calls should use OAuth 1.0a; Basic Auth is documented for HTTPS. [Authentication docs](https://developer.woocommerce.com/docs/apis/rest-api/authentication) · [Official JS client source](https://github.com/woocommerce/woocommerce-rest-api-js-lib)

If the OAuth-signed request fails because the internal host differs from the WordPress site's canonical URL, stop and diagnose signature URL / Host behavior. Do not silently re-enable Basic Auth on plain HTTP, add a broad host allowlist, or leak credentials to query/debug logs. Record the tested, narrowly scoped solution in a Phase 3 ADR/runbook update. The existing helper remains local-development-only and must not be installed in production.

### 1.3 Protocol decision: reuse the verified stack, verify actual negotiation

- Keep Node.js 24 as pinned in `.nvmrc` and `package.json`.
- Start with the existing `@modelcontextprotocol/sdk@1.32.1` and compatible Zod dependency from the project baseline. Update the root lockfile using npm workspaces; do not create an independent lockfile for the app.
- Reuse the tested Streamable HTTP pattern from `spikes/mcp-echo`, while following the SDK's stateless server example and applicable resource lifecycle guidance. Do not copy the example mechanically without tests.
- Record the **observed** negotiated protocol version from the real client handshake. The ADR currently states `2024-11-05`, while the official current v1 SDK docs describe support through the `2025-11-25` protocol revision. Do not repeat a protocol-version claim without evidence from the installed dependency and actual handshake. This is a documentation verification task, not an automatic mandate to migrate SDK generations. [MCP TypeScript SDK v1 documentation](https://ts.sdk.modelcontextprotocol.io/)
- Use Streamable HTTP, not the deprecated legacy HTTP+SSE transport. Endpoint: `POST /mcp`.
- Use the `createMcpExpressApp` helper or the exact supported equivalent from the pinned SDK to retain host-header / DNS-rebinding safeguards. Configure accepted hosts narrowly and test it.

---

## 2. Scope control

### 2.1 In scope

1. `apps/mcp-woocommerce` TypeScript workspace package.
2. WooCommerce REST client configuration, timeout behavior, error mapping, and response normalization.
3. The five required MCP tools and input schema validation.
4. Stateless Streamable HTTP MCP server on `POST /mcp`.
5. Process health endpoints for Kubernetes probes.
6. Container image / Dockerfile and k3d local image import.
7. Helm Deployment and internal ClusterIP Service, configured through the existing unified chart and values files.
8. Kubernetes Secret references for consumer key/secret; no credential literals in manifests or code.
9. A narrowly scoped NetworkPolicy and evidence that the cluster's policy controller enforces it: only the future gateway pod selector may reach the MCP service, with the necessary egress to WordPress and DNS.
10. Unit tests, integration tests, MCP protocol tests, a controlled live-store verification, logging redaction, and Phase 3 documentation.
11. Updates to `docs/requirements-traceability.md`, `docs/architecture.md` if needed, and a Phase 3 ADR / runbook.

### 2.2 Explicitly out of scope

- Gateway implementation or aggregation; do not create `apps/gateway` just for this phase.
- React dashboard, members, admin roles, gateway key issuance/revocation, and persisted tool-call audit UI.
- LLM/chat agent, Gemini/Ollama integration.
- CRM and task MCP servers.
- `delete_product` or `create_order` as MCP tools; neither is in the required five-tool set.
- Direct MariaDB queries from MCP; all product/order operations must use WooCommerce REST API.
- Multi-store support, OAuth for downstream gateway clients, hosted MCP containers, multiple replicas, or broad observability stack.
- Production rollout or backup/restore; document known boundaries without claiming production readiness.

### 2.3 Non-negotiable constraints

- Do not reset, delete, or recreate the existing cluster, namespace, PVCs, store data, API keys, WordPress database, or Helm release as a shortcut.
- Do not modify or bind host port 80 or 3001; they are existing host-service invariants. Local public ingress remains on 8080/8443.
- Do not print Secret values or put real keys in command history, shell trace (`set -x`), test snapshots, or documentation.
- Do not commit `.secrets`, `.env`, generated credentials, or logs containing authorization material.
- Do not change `urumi-woocommerce-api` unless the technical lead explicitly authorizes a credential rotation. The existing credentials have already been validated and should be reused.
- Do not expose the MCP server using an Ingress. Only the storefront is public in this phase.
- No successful status may be reported unless the command or test was actually run and its result recorded.

---

## 3. Phase timeline and gates

The original master plan allocates 13–14 October to Phase 3. This is an aggressive schedule. Keep the five-tool core ahead of optional refinements; if the integration-auth spike is blocked, escalate immediately rather than spending a day on extra filters or output formatting.

| Work window | Task group | Exit result |
|---|---|---|
| 12 Oct (preflight only) | Gate P0: repo/store/secret/cluster facts, no destructive changes | Preconditions captured; internal auth risk reproduced or narrowed |
| 13 Oct morning | G1: package/config/client skeleton and internal API proof | Reproducible package, OAuth/REST connection proven from cluster context |
| 13 Oct afternoon | G2: five tool contracts + implementation | All five tools registered and unit-tested with deterministic fakes |
| 13 Oct evening | G3: MCP server + protocol checks | Client discovers and invokes tools over Streamable HTTP |
| 14 Oct morning | G4: Docker/Helm/Kubernetes integration | Pod Ready, ClusterIP works, no public MCP Ingress, NetworkPolicy tested |
| 14 Oct afternoon | G5: live integration and mutation tests | Each tool verified against actual WooCommerce data; disposable changes cleaned up |
| 14 Oct evening | G6: docs, evidence, regression and exit review | Acceptance gate passed, evidence committed by repository owner, Phase 4 handoff prepared |

**Manager rule:** If the P0 internal-auth proof has not passed by the end of 13 October morning, don't proceed to broader tool implementation on assumptions. Diagnose the actual server/client request flow first. If final completion slips, tell the project manager immediately and propose a specific scope/time correction; don't mark tasks complete from generated code alone.

---

## 4. Task 3.0 — Preflight and live baseline capture (P0)

### Goal
Verify the Phase 2 environment remains healthy and capture test data / secrets presence without disclosing secret values.

### Commands
Run from the repository root using the pinned runtime:

```bash
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$HOME/.local/bin:$PATH"
node -v
npm -v
git status --short
git log -5 --oneline
npm ci
npm run build

kubectl --context k3d-urumi version
kubectl --context k3d-urumi get nodes -o wide
kubectl --context k3d-urumi -n urumi get pods,svc,pvc,deploy,statefulset,ingress
kubectl --context k3d-urumi -n urumi rollout status deployment/urumi-wordpress --timeout=120s
kubectl --context k3d-urumi -n urumi rollout status statefulset/urumi-mariadb --timeout=120s
kubectl --context k3d-urumi -n urumi get secret urumi-woocommerce-api -o json | jq -r '.data | keys[]'
helm --kube-context k3d-urumi status urumi-store -n urumi
```

The Secret inspection command prints only key names, not their values. If `jq` is missing, use an equivalent that returns `.data` keys only. Never run `kubectl get secret ... -o yaml` into a public log or report.

Capture baseline read-only evidence:

```bash
kubectl --context k3d-urumi -n urumi get pods -o wide
kubectl --context k3d-urumi -n urumi get svc urumi-wordpress -o yaml
kubectl --context k3d-urumi -n urumi get networkpolicy
curl -sS -o /dev/null -w 'storefront_http=%{http_code}\n' http://shop.127.0.0.1.nip.io:8080/
```

Do not dump all pod env vars. Do not place consumer credentials in shell variables on the host unless there is a separately reviewed need; the preferred live API proof should run in-cluster and consume the Secret through `secretKeyRef`.

### P0 connection/authentication test

Before implementing tool handlers, verify the WooCommerce REST client can make an authenticated `GET /wp-json/wc/v3/products` from a Kubernetes workload using the **internal Store Service URL**, with the API key mounted using `secretKeyRef`. The test must validate:

- DNS resolves `urumi-wordpress.urumi.svc.cluster.local` from the caller pod.
- TCP/HTTP connectivity to Service port 80 works.
- The chosen WooCommerce client/auth mode returns HTTP 200 and at least the expected seeded products.
- An invalid credential produces a sanitized unauthorized error; do not change the live secret to test this. Use a unit/mock test for the negative path.
- The request does not rely on the public Ingress or host-side port-forward.
- No consumer secret is printed in the request URL, response output, command output, logs, or test artifacts.

For HTTP service-to-service calls, prefer the official client's OAuth 1.0a signing behavior and verify it in a live test. A client that only sends Basic Auth over HTTP is not acceptable for the final implementation. See the Phase 2 helper caveat in §1.2.

### Deliverable
`docs/phase-3/phase-3-preflight.md` (or add the results to the Phase 3 execution log) with exact observed context, pod state, Secret key names, endpoint, auth approach, HTTP status, and any blocker. Never include credential values.

### Acceptance criteria
- Current namespace/store/Secret are present and healthy.
- Root `npm ci` and `npm run build` succeed from the committed lockfile.
- Internal-Service REST authentication has an observed result, not an assumption.
- Phase 2 baseline values are not changed by preflight.

---

## 5. Task 3.1 — Create `apps/mcp-woocommerce` workspace package

### Goal
Add the custom server as a clearly separated, reproducible workspace package consistent with the Phase 1 architecture.

### Proposed file structure

```text
apps/mcp-woocommerce/
├── package.json
├── tsconfig.json
├── Dockerfile
├── src/
│   ├── config.ts
│   ├── server.ts
│   ├── http-app.ts
│   ├── woo/
│   │   ├── client.ts
│   │   ├── errors.ts
│   │   ├── normalize.ts
│   │   └── types.ts
│   └── tools/
│       ├── schemas.ts
│       ├── products.ts
│       ├── orders.ts
│       └── register-tools.ts
└── test/
    ├── config.test.js
    ├── schemas.test.js
    ├── normalize.test.js
    ├── woo-errors.test.js
    └── tools.test.js
```

The exact organization can be adjusted, but separate configuration, REST client, error normalization, tool definitions and server transport. Do not place all functionality in one 600-line file.

### Package/lockfile requirements

- Root `package.json` already includes `apps/*` as an npm workspace. Create the package at `apps/mcp-woocommerce/` so it is discovered automatically.
- Use a package name such as `@urumi/mcp-woocommerce` and set `private: true`.
- Use the existing Node 24 runtime and TypeScript conventions from `packages/shared` and `spikes/mcp-echo`.
- Pin the MCP SDK to `1.32.1` for Phase 3, matching the validated project dependency; keep Zod on a compatible pinned resolution.
- Add the official WooCommerce REST client as an exact, reviewed dependency (upstream package manifest inspected at version `1.0.2` when this roadmap was prepared) if the P0 auth test confirms its HTTP/OAuth path works. Do not upgrade to the newest unrelated library version without proving compatibility.
- If Express is used, align its version and types with the tested echo spike, not another framework for no reason.
- Avoid adding a database driver: the WooCommerce MCP server stores no durable business state of its own.
- Add package scripts for `build`, `start`, `test`, and a documented live-integration test path. Scripts must perform real checks and fail with non-zero status on failure.
- Update `package-lock.json` from the repository root using npm workspace commands. Do not create `apps/mcp-woocommerce/package-lock.json`.

Suggested command flow (adapt only if the workspace has changed):

```bash
# After the new package.json is present
npm install --workspace @urumi/mcp-woocommerce
npm run build --workspace @urumi/shared
npm run build --workspace @urumi/mcp-woocommerce
npm run build
npm test --workspace @urumi/mcp-woocommerce
```

### Configuration contract

Validate settings at process startup. Fail fast with a sanitized error if required configuration is absent/invalid. Suggested environment variables:

| Variable | Required | Purpose |
|---|---:|---|
| `PORT` | Yes/defaulted for container | MCP HTTP listener; use a non-privileged in-container port such as 3000 if consistent with the chart |
| `HOST` | Yes/defaulted for container | Bind inside the pod to `0.0.0.0` so the Service can reach it |
| `NODE_ENV` | Yes | `production` in container |
| `WOOCOMMERCE_URL` | Yes | Base URL of the internal WordPress Service, not the full `/wp-json/wc/v3` path if the chosen library appends that prefix |
| `WOOCOMMERCE_CONSUMER_KEY` | Yes | Populated from Secret key `consumer-key` |
| `WOOCOMMERCE_CONSUMER_SECRET` | Yes | Populated from Secret key `consumer-secret` |
| `WOOCOMMERCE_REQUEST_TIMEOUT_MS` | Yes/defaulted | Bound each upstream API operation; initial proposal 8,000 ms, adjustable after observed latency |
| `MCP_ALLOWED_HOSTS` | Yes | Narrow allowlist for the internal MCP Service hostname and any specific test host actually needed |

Validate that the configured store URL uses an allowed scheme (`http` in the current internal local cluster; `https` when the production design is established), includes no embedded username/password, has no query/fragment, and targets the expected base path. Do not hardcode credentials or silently fall back to public Ingress URLs.

### Acceptance criteria
- Workspace is recognized by root npm scripts.
- Clean `npm ci` using the root lockfile installs all dependencies.
- TypeScript builds without `any`-heavy or unchecked casts in the tool boundary.
- Missing required credentials fail startup without printing the missing value or any other secret.
- No `apps/mcp-woocommerce` code calls the MariaDB/MySQL database directly.

---

## 6. Task 3.2 — Implement a bounded WooCommerce REST client adapter

### Goal
Provide one tested adapter around the official WooCommerce REST API, used by all five tools. Avoid HTTP/auth/error behavior duplicated across the tool handlers.

### Required behavior

1. Use `/wp-json/wc/v3/` resources through the official API client, with the internal Kubernetes URL set through configuration.
2. Use a single bounded request timeout. Do not permit a stalled upstream call to hold an MCP request forever.
3. Use the tested authentication mode for the internal URL. Preferred for plain HTTP is OAuth 1.0a signing through the official library, which must be verified against the actual store. Do not send the consumer secret as Basic Auth over plain HTTP.
4. Preserve WooCommerce monetary values as decimal strings; do not coerce prices or totals through floating point unnecessarily. WooCommerce's REST docs describe decimal money fields as strings. [WooCommerce REST API](https://developer.woocommerce.com/docs/apis/rest-api/)
5. Use documented endpoint query parameters for search, category, status, dates and pagination. Product category filter maps to a category ID (the REST API parameter is `category`).
6. Bound collection size. Use `page >= 1` and a conservative maximum `per_page` (recommended cap: 50). Return pagination metadata rather than automatically fetching an unbounded number of pages.
7. For order date filtering, accept explicit ISO-8601/RFC3339 timestamps and map to WooCommerce's `after`/`before` fields with `dates_are_gmt=true` after normalization to UTC. Reject malformed dates and `after > before`. Do not make the tool guess what “today” means; natural-language time-window resolution belongs to the later chat agent. The later phase must use the store timezone that is actually observed/configured.
8. Implement a normalized error type that contains safe fields only: internal code, retryable flag, upstream HTTP status (if any), and safe message. Do not pass full Axios errors, request config, authorization header, OAuth parameters, or stack trace to an MCP client.
9. Never automatically retry a non-idempotent `POST /products` after a timeout; the server may have created a product even if the response was lost. Where a unique SKU was supplied, preflight for an existing SKU and return an explicit conflict rather than creating a duplicate. Document that callers should reconcile a timed-out create before retrying.
10. Avoid retry loops for `PUT` status updates; a bounded read-after-write verification is allowed if it is safe and tested.
11. Ensure product/order mappings handle optional/null fields and WooCommerce error payloads; never assume every property exists.

### Recommended internal adapter interface

The exact TypeScript names may differ, but keep a narrow, testable interface similar to:

```ts
interface WooCommercePort {
  listProducts(params: ListProductsParams): Promise<Page<ProductSummary>>;
  createProduct(params: CreateProductParams): Promise<ProductSummary>;
  listOrders(params: ListOrdersParams): Promise<Page<OrderSummary>>;
  getOrder(orderId: number): Promise<OrderSummary>;
  updateOrderStatus(orderId: number, status: AllowedOrderStatus): Promise<OrderStatusChange>;
}
```

Use this seam to inject deterministic fake clients into unit tests. MCP handlers should not instantiate HTTP clients independently.

### Error policy

| Scenario | Safe internal code / behavior | Tool response |
|---|---|---|
| Invalid tool arguments | `INVALID_ARGUMENT` | Error response; no WooCommerce request made |
| Missing config at startup | Fail fast; no listener becomes Ready | Process exits non-zero; no secret printed |
| WooCommerce 401 | `UPSTREAM_AUTH_FAILED` | Sanitized error; no credentials included |
| WooCommerce 403 | `UPSTREAM_FORBIDDEN` | Sanitized permission error; no credential details |
| WooCommerce 404 | `NOT_FOUND` | Safe “resource not found” error |
| Duplicate SKU / Woo validation response | `SKU_CONFLICT` or `UPSTREAM_VALIDATION_ERROR` | Safe field-level explanation where response is safe to expose |
| Connection refused / DNS failure | `UPSTREAM_UNAVAILABLE` | Clear, sanitized tool error |
| Request timeout | `UPSTREAM_TIMEOUT` | Clear timeout error; no automatic duplicate-making retry |
| WooCommerce 429 | `UPSTREAM_RATE_LIMITED` | Bounded error; preserve only safe retry guidance if available |
| WooCommerce 5xx | `UPSTREAM_ERROR` | Sanitized error, retryable true where appropriate |
| Unexpected response shape | `UPSTREAM_INVALID_RESPONSE` | Safe error; retain internal diagnostic with sensitive data removed |

Use the MCP SDK's supported tool-error mechanism (for example, `isError: true` on a tool result or its documented thrown-error handling) rather than turning every business/API error into an unhandled Express 500. Verify the exact behavior on the pinned SDK. Error results must be useful to clients and must not disclose server internals.

### Logging

Use structured logs with only allowlisted fields such as:

- timestamp, service name, tool name, operation (`list`, `create`, `get`, `update`), elapsed milliseconds, outcome, safe error code and HTTP status.
- A request/correlation ID if provided by middleware; validate/sanitize it before logging.

Never log:

- consumer key/secret, Secret values, `Authorization` headers, OAuth query parameters, full Axios request config, full request/response bodies, customer billing addresses/emails, or the complete order object.
- full query URLs if they may include OAuth parameters.

The Phase 3 logs are operational diagnostics only. Persistent user-attributed audit records belong to the gateway phase; do not build a second audit database in this server.

### Acceptance criteria
- HTTP client has a hard timeout and uses the verified internal auth approach.
- All errors have a tested safe mapping.
- Product prices and order totals remain decimal strings in normalized outputs.
- Collection sizes and date filters are bounded/validated.
- No request logs contain credentials or raw PII.

---

## 7. Task 3.3 — Lock down the five tool contracts

Design tool descriptions and input schemas as a public interface. They are consumed by MCP clients and eventually exposed by the gateway and LLM. Avoid vague names, unbounded result payloads, implicit side effects, and schema fields the API does not support.

### 7.1 `list_products`

**Purpose:** List products from the live WooCommerce catalog, with bounded filters and page size.

**Input schema (proposed):**

| Field | Type | Constraints / behavior |
|---|---|---|
| `search` | optional string | Trim; 1–200 chars if present |
| `categoryId` | optional positive integer | Map to WooCommerce query parameter `category`; category IDs are numeric IDs, not category names/slugs |
| `status` | optional enum | `publish`, `draft`, `pending`, `private`; default to `publish` for the storefront-oriented use case |
| `page` | optional integer | `>= 1`, default `1` |
| `perPage` | optional integer | `1–50`, default `10` |

**REST mapping:** `GET products` with `search`, `category`, `status`, `page`, and `per_page` where supplied.

**Normalized result:**

```json
{
  "items": [
    {
      "id": 10,
      "name": "Urumi Test Mug",
      "sku": "URUMI-MUG-001",
      "price": "299.00",
      "status": "publish",
      "permalink": "...",
      "stockStatus": "instock",
      "categoryIds": [1]
    }
  ],
  "page": 1,
  "perPage": 10,
  "totalItems": 3,
  "totalPages": 1
}
```

The example is illustrative; IDs/categories may differ on the live store. Populate `totalItems` and `totalPages` from `X-WP-Total` and `X-WP-TotalPages` when present, and handle missing headers without crashing. Exclude full descriptions and large image payloads unless needed. Only expose data returned by the live REST API.

**Acceptance tests:**
- No filters returns the seeded published products (including the mug, mouse and notebook).
- `search="Mouse"` returns the mouse when present.
- Category filtering uses the actual seeded category ID and returns only matching products.
- `status=publish` does not return drafts.
- Page/per-page boundaries work; `perPage=0`, `page=0`, and `perPage=51` fail validation without contacting WooCommerce.
- API errors are sanitized.

### 7.2 `create_product`

**Purpose:** Create a simple, published product so it becomes visible on the storefront. This is a required end-to-end assignment scenario.

**Input schema (proposed):**

| Field | Type | Constraints / behavior |
|---|---|---|
| `name` | string | Required, trimmed, 1–200 chars |
| `regularPrice` | decimal string | Required; non-negative; no exponent notation; at most two fractional digits; example `"799.00"` |
| `description` | optional string | Maximum 5,000 chars; plain text/HTML policy must be documented; don't allow arbitrary code execution |
| `sku` | optional string | Trimmed, max 100 chars; when supplied, check uniqueness before create and return conflict on duplicate |
| `categoryIds` | optional array of positive integers | Bound array size (for example, max 10); map to WooCommerce `categories: [{id}]` |

Do not accept caller-provided `id`, `price`, `permalink`, `total_sales`, arbitrary metadata, payment configuration or status transition flags. Set `type: "simple"`, `status: "publish"`, and `catalog_visibility: "visible"` server-side. `regular_price` is the writable API property; current `price` is returned by WooCommerce. Validate decimal values as strings to avoid floating-point rounding errors.

**REST mapping:** `POST products` with the normalized fields, `regular_price`, `type: simple`, `status: publish`, `catalog_visibility: visible`, and optional `categories` / `sku` / `description`.

**Normalized result:** `id`, `name`, `sku` (if set), `price` or `regularPrice` as a string, `status`, and `permalink`.

**Acceptance tests:**
- Create a disposable product with a unique name and SKU; assert HTTP create success through the MCP tool.
- Confirm `list_products` can find it and the product is `publish`.
- Confirm storefront HTML or the store's public product URL contains the new product.
- Negative test: empty name, negative/non-decimal price, price with more than two decimal places, overlong description, or invalid category array is rejected before a REST mutation.
- Duplicate SKU returns a safe conflict; the existing product is not silently overwritten.
- A simulated timeout does not trigger an automatic second POST.
- Cleanup is performed after verification with a controlled test cleanup method outside the public MCP tool set. Do **not** add `delete_product` as a sixth tool just to simplify testing.

### 7.3 `list_orders`

**Purpose:** Retrieve orders from the live store with optional status/customer/date filters and bounded pagination.

**Input schema (proposed):**

| Field | Type | Constraints / behavior |
|---|---|---|
| `status` | optional enum | `pending`, `processing`, `on-hold`, `completed`, `cancelled`, `refunded`, `failed`; use exact REST-supported values |
| `customerId` | optional positive integer | Map to WooCommerce `customer` filter |
| `after` | optional ISO-8601/RFC3339 timestamp | Absolute date-time; parse and normalize to UTC; reject invalid date |
| `before` | optional ISO-8601/RFC3339 timestamp | Absolute date-time; parse and normalize to UTC; reject if earlier than `after` |
| `page` | optional integer | `>=1`, default `1` |
| `perPage` | optional integer | `1–50`, default `10` |

**REST mapping:** `GET orders` with `after`, `before`, `dates_are_gmt=true`, `status`, `customer`, `page`, and `per_page` as supplied. Confirm the selected values against the version of WooCommerce running in the cluster.

**Privacy/data minimization:** Do not return the full WooCommerce order payload by default. Normalize to `id`, `number`, `status`, `dateCreated`, `dateCreatedGmt`, `total` as decimal string, `currency`, `paymentMethod`, `customerId`, and line-item summaries (`productId`, `name`, `quantity`, `total`). Exclude billing email, full street addresses, phone, order key, and raw metadata unless a later explicit requirement justifies them.

**Result:** bounded `items`, `page`, `perPage`, and pagination metadata when available.

**Acceptance tests:**
- The seeded Order #14 is present with status `processing`, total `"299.00"`, and COD payment method, regardless of page order.
- Date filters can find an order created within an explicit UTC interval and exclude one outside the interval.
- `after > before` fails before any upstream call.
- `perPage` cap is enforced; the tool does not recursively fetch all pages.
- No billing address/email/customer PII is present in default result output.
- A failed upstream request returns a sanitized MCP tool error.

**Important future integration note:** The later chat agent must resolve “today” into an explicit start/end interval using the store's actual configured timezone, then convert it to UTC. Phase 3 must not hardcode a timezone or parse natural language itself.

### 7.4 `get_order`

**Purpose:** Retrieve one order by numeric WooCommerce order ID.

**Input schema:**

- `orderId`: positive integer; reject strings, zero, negative numbers, decimals, `NaN`, or excessively large values.

**REST mapping:** `GET orders/{id}`.

**Normalized result:** same bounded order summary fields as `list_orders`, including line items and total, but not billing/shipping PII by default.

**Acceptance tests:**
- `orderId=14` returns the actual baseline order.
- Unknown ID maps to a safe `NOT_FOUND` result.
- Invalid IDs fail schema validation without an upstream request.
- Result contains no raw `order_key`, billing address, email, phone, or raw metadata.

### 7.5 `update_order_status`

**Purpose:** Change the status of an existing WooCommerce order and return the confirmed new state.

**Input schema (proposed constrained allowlist):**

- `orderId`: positive integer.
- `status`: enum `pending`, `processing`, `on-hold`, `completed`, `cancelled`. This intentionally limits the mutation surface to the states needed by the project; the full WooCommerce API supports additional statuses, but the MCP tool need not expose every one.

**REST mapping:** first retrieve the current order; if status already matches, return a no-op result (`changed: false`) without calling the update endpoint. Otherwise `PUT orders/{id}` with the allowed status, then verify the returned/current status. Do not automatically retry a status mutation after a network timeout without reconciling the order state.

**Normalized result:** `id`, `previousStatus`, `newStatus`, and `changed`.

**Acceptance tests:**
- Create or identify a disposable order (not baseline Order #14), update it to `on-hold`, and verify the status through a subsequent GET and WooCommerce Admin.
- If safe for the test order, restore it to the intended known status or record why it is retained as a test record.
- Invalid status values such as `trash`, `refunded`, `foo`, or empty string fail validation without upstream mutation.
- Unknown order ID returns `NOT_FOUND`.
- A no-op update to the same status reports `changed: false` and makes no PUT request.
- Order #14 remains the documented baseline unless the test plan explicitly says otherwise.

### 7.6 Tool description quality

Descriptions must explicitly say what the tool does, what it returns, what filters mean, the units/format for prices and dates, and whether it changes store state. Avoid descriptions that suggest arbitrary database access or unrestricted operations. Use stable tool names exactly as specified above in Phase 3; the gateway may add namespace prefixes in Phase 4.

### 7.7 Tool registration and result envelope

- Register exactly these five application tools. No hidden bonus tools.
- Validate input via SDK-supported Zod schemas.
- Serialize normalized result JSON as MCP text content for compatibility with the protocol revision verified in Phase 1. Do not introduce newer response fields without verifying the negotiated client protocol supports them.
- On known errors, use the pinned SDK's supported MCP tool-error response shape with `isError: true` (or its documented equivalent). Keep the message actionable but safe.
- Test with the project's pinned MCP SDK client and MCP Inspector. Record the version and actual negotiated protocol version.

---

## 8. Task 3.4 — Implement the HTTP server and health behavior

### Goal
Expose the tools over Streamable HTTP, with safe startup and request lifecycle behavior.

### Requirements

- MCP URL path: `/mcp`.
- Server listener binds to `0.0.0.0` inside the container, on the configured non-privileged port (proposed port 3000).
- MCP transport: `StreamableHTTPServerTransport`, stateless mode to match the verified Phase 1 design unless a demonstrated requirement needs sessions.
- Server/transport lifecycle follows the official example for the pinned SDK. Ensure response-close cleanup does not race the JSON-RPC response or close a server shared by another request.
- Use `createMcpExpressApp` from the pinned SDK if compatible with the existing Express app, to keep DNS-rebinding/Host validation safeguards. Configure `allowedHosts` to a small explicit set, including the internal MCP Service host used by the gateway (and only test hosts that are actually needed).
- Reject malformed requests safely, return protocol-compatible responses and handle SIGTERM gracefully.
- Request handlers must not log raw request bodies, credentials, OAuth query parameters or full WooCommerce error objects.
- Health endpoints must not require MCP protocol initialization:
  - `GET /health/live`: 200 when the process/event loop is responsive.
  - `GET /health/ready`: 200 if required configuration has loaded and the service can accept an MCP request; do not require a successful live WooCommerce request for liveness. A temporary WooCommerce outage should produce tool-level errors, not restart-loop the MCP pod.
- Add a bounded server shutdown path; close the listener and in-flight transports correctly.

### Acceptance tests
- Health endpoints return 200 when healthy, and the Kubernetes probes pass.
- Missing configuration prevents readiness/startup and produces a safe error.
- Unknown Host is rejected by the host-validation layer where applicable.
- MCP `initialize`, `tools/list`, and `tools/call` work through Streamable HTTP.
- The tool list contains exactly the five required tool names and correct input schemas.
- Server handles SIGTERM without leaving a stuck pod termination.

---

## 9. Task 3.5 — Add container image and Helm resources

### Goal
Deploy the MCP server using the existing unified Helm chart. It must not require host execution of the server or expose the upstream MCP service through public Ingress.

### 9.1 New/updated files

Add or update only the files required for the WooCommerce MCP workload, likely:

- `apps/mcp-woocommerce/Dockerfile`
- `infra/helm/urumi-platform/templates/mcp-woocommerce-deployment.yaml`
- `infra/helm/urumi-platform/templates/mcp-woocommerce-service.yaml`
- `infra/helm/urumi-platform/templates/mcp-woocommerce-networkpolicy.yaml`
- `infra/helm/urumi-platform/values.yaml`
- `infra/helm/urumi-platform/values-local.yaml`
- `infra/helm/urumi-platform/values-prod.yaml`
- `docs/phase-3/image-lock.md`

Keep paths in line with the existing chart conventions. No separate chart or Kustomize overlay.

### 9.2 Container build

- Use a verified Node.js 24 image compatible with the pinned runtime. Choose an exact published tag and, where practical, record its digest; verify the tag and `linux/amd64` support rather than assuming it exists.
- Use a multi-stage build if helpful to omit compilers/dev dependencies from the runtime image.
- Build the application from the repository root so npm workspace symlinks and the committed root lockfile resolve correctly.
- Run as a non-root user. Ensure the process only needs to bind to port 3000 and read environment variables.
- Do not bake consumer credentials or `.secrets` into any image layer.
- Set `NODE_ENV=production`, `HOST=0.0.0.0`, and `PORT=3000` through container configuration.
- Use a meaningful local image tag (example: `urumi-mcp-woocommerce:phase3`), build it, import it into the existing cluster with `k3d image import`, and use `imagePullPolicy: IfNotPresent` for the local profile. Verify the imported image is the one the Pod runs. For production values, make the registry/image reference configurable; do not claim a remote image is deployed unless it is pushed and successfully pulled.

Example shape (adapt the image tag and Dockerfile paths to actual implementation):

```bash
docker build -f apps/mcp-woocommerce/Dockerfile \
  -t urumi-mcp-woocommerce:phase3 .
k3d image import urumi-mcp-woocommerce:phase3 --cluster urumi
```

### 9.3 Helm values

Extend the existing `upstreams.woocommerce` settings, keeping the current local resource values as a starting estimate. Add only necessary fields (examples):

- `enabled`
- `image`
- `tag` or exact local image reference
- `containerPort`
- `servicePort`
- `storeUrl` / internal base URL
- `requestTimeoutMs`
- `allowedHosts`
- `resources`
- optional NetworkPolicy toggle only if the project has a real and documented reason to vary it by environment

Do not add the consumer key or secret to values files. Those are injected from Kubernetes Secret `urumi-woocommerce-api` using `secretKeyRef` and the exact existing keys `consumer-key` / `consumer-secret`.

### 9.4 Deployment contract

The Deployment should set:

- `replicas: 1` for this phase; the MCP service is stateless but no scaling requirement exists yet.
- Pod labels, including a stable component label that the future gateway Deployment can use, e.g. `app.kubernetes.io/component: mcp-woocommerce`. Use the same label in Service selectors and NetworkPolicy selectors.
- `imagePullPolicy` appropriate to local vs production configuration.
- Environment variables, with credentials sourced only from `secretKeyRef`.
- CPU/memory requests and limits using the existing values file; treat current values as initial estimates and verify real usage. Avoid artificially tiny memory values that cause restarts.
- `startupProbe`, `readinessProbe`, and `livenessProbe` (or at minimum the mandatory readiness and liveness probes; startup is useful if measured initialization requires it). Probe `/health/ready` and `/health/live` separately. Use a startup probe only with a threshold/time appropriate to the service's actual startup.
- non-root security settings where compatible with the selected runtime image; do not blindly add `readOnlyRootFilesystem` if the Node process genuinely needs writable paths. Prefer a read-only filesystem with no writable directories if validated.
- graceful termination settings if needed for request cleanup.

### 9.5 Service contract

Create a `ClusterIP` Service named consistently, proposed `urumi-mcp-woocommerce`, port `3000` target port `3000` (or service port 80 mapped to the named target port if that matches the chart conventions). The future gateway should use the full internal DNS name:

`http://urumi-mcp-woocommerce.urumi.svc.cluster.local:3000/mcp`

Use the **actual** `Service` name/port in the final docs. Do not create an Ingress, NodePort, or LoadBalancer for the MCP server.

### 9.6 Kubernetes Secret use

Environment variable mapping:

```yaml
env:
  - name: WOOCOMMERCE_CONSUMER_KEY
    valueFrom:
      secretKeyRef:
        name: urumi-woocommerce-api
        key: consumer-key
  - name: WOOCOMMERCE_CONSUMER_SECRET
    valueFrom:
      secretKeyRef:
        name: urumi-woocommerce-api
        key: consumer-secret
```

This is an illustration of the required mapping, not a complete Deployment manifest. Keep the secret in namespace `urumi` for the same-namespace workload. Kubernetes Secrets are not magically encrypted at rest; do not make a claim about encryption at rest that Phase 2 did not establish.

### 9.7 Network policy and “only gateway can call it”

The assignment says that the custom WooCommerce MCP server is internal-only and only the gateway should call it. `ClusterIP` plus no Ingress prevents normal outside-cluster routing, but does not by itself prevent arbitrary Pods in the same cluster from connecting.

K3s includes a NetworkPolicy controller, but policy behavior must be tested in this cluster. Add a narrowly scoped NetworkPolicy selected by the MCP pod label and permit ingress on the MCP port only from pods with the agreed future gateway label (for example, `app.kubernetes.io/component: gateway`) in the intended namespace. The Phase 4 gateway must use exactly that selector/namespace contract. If an egress policy is added, explicitly allow DNS and the WordPress Service on port 80; determine actual CoreDNS pod labels from the live cluster rather than guessing them.

**Required test:**
1. A temporary Pod with the future gateway selector can reach the MCP Service.
2. A temporary ordinary/unlabelled Pod in namespace `urumi` cannot reach the MCP Service.
3. The MCP Pod can resolve and reach the WordPress Service.
4. Health probes still pass with the policy enabled.
5. There is no Ingress rule or host port exposing the MCP server.

Use temporary test Pods that do not mutate data, and delete those test Pods after the test. This is an explicit NetworkPolicy needed to satisfy the access-boundary requirement, not an invitation to build a platform-wide deny-all policy during Phase 3.

### 9.8 Helm template verification

Run the checks against both values profiles:

```bash
helm lint infra/helm/urumi-platform
helm template test-local infra/helm/urumi-platform \
  -f infra/helm/urumi-platform/values-local.yaml > /tmp/urumi-phase3-local.yaml
helm template test-prod infra/helm/urumi-platform \
  -f infra/helm/urumi-platform/values-prod.yaml > /tmp/urumi-phase3-prod.yaml
```

Inspect the rendered resources. Confirm:

- The MCP Deployment and ClusterIP Service appear when enabled.
- Secret references refer to `urumi-woocommerce-api` and the exact two data keys.
- No credential literal or `Secret` data value appears in rendered non-Secret manifests.
- No MCP Ingress / NodePort / LoadBalancer is created.
- Store resources still render correctly and existing local/prod store image digests remain unchanged.
- The production profile has a valid configurable image reference, not a pretend locally loaded tag.
- Resource probes/requests/limits and NetworkPolicy selectors/ports are rendered as intended.

If the production image cannot yet be pulled because Phase 3 has no published image registry, record that clearly: manifest rendering is not production deployment proof. Do not invent a registry or claim production runtime verified.

### Acceptance criteria
- Build succeeds and image is actually loaded into `k3d-urumi`.
- `kubectl` shows the Deployment's Pod `Ready` with probes passing and no OOM/restart loop.
- The Service has only ClusterIP type and no external Ingress.
- The intended NetworkPolicy behavior is observed, not merely templated.
- Secret values never appear in manifests, reports, logs, or the Docker image.

---

## 10. Task 3.6 — Unit, contract and integration tests

### Goal
Test tool behavior at three distinct levels so an MCP handshake passing cannot conceal broken business logic.

### 10.1 Unit tests (no live cluster required)

Use a fake `WooCommercePort` / mock HTTP adapter and deterministic fixtures. At minimum test:

1. Valid and invalid `list_products` schemas.
2. Search/category/status/page-to-REST mapping.
3. Product response normalization with missing optional properties and decimal string price.
4. `create_product` always sends simple/published/visible defaults and never trusts caller-provided read-only fields.
5. Price strings reject negative amounts, exponent notation, empty values, and more than two fractional places.
6. Duplicate SKU maps to a safe conflict and does not result in a second POST.
7. Date parsing normalizes valid timestamps to UTC, rejects malformed dates, and rejects `after > before`.
8. Order list/get normalization excludes billing street address, email, phone, `order_key`, and raw metadata.
9. Order status allowlist rejects unsupported status values.
10. `update_order_status` performs no mutation when requested status already matches current status.
11. REST error mapping for 401, 403, 404, WooCommerce validation error, 429, 5xx, network failure, timeout and unexpected JSON.
12. Log serialization redacts auth/OAuth information and does not include raw upstream request config/body.
13. Startup config validation fails for missing URL/key/secret, malformed URL and invalid timeout.
14. Health endpoints report readiness based on application/config state and do not repeatedly hit WooCommerce on each liveness probe.
15. MCP server tool registry contains exactly the expected five tool names, with stable descriptions and schemas.

### 10.2 MCP protocol contract test

Use the existing pinned SDK client and exercise the real HTTP listener:

- missing/invalid host configuration rejected if the host-validation layer requires it;
- initialize succeeds and negotiated version is recorded;
- `tools/list` returns all five tools;
- each tool appears once with the intended input schema;
- `tools/call` invokes handlers and produces MCP-conformant JSON text output;
- known errors produce `isError: true` / documented equivalent rather than an unhandled 500;
- malformed JSON-RPC or invalid arguments produce a safe protocol error;
- client closes cleanly;
- server survives multiple sequential calls in stateless mode.

Do not mark “MCP works” based solely on `/health` or `curl /mcp`. The client must complete discovery and tool invocation.

### 10.3 Live integration tests against `k3d-urumi`

Run only after the Deployment and policy are Ready. Use a test plan that separates real mutations from read-only baseline assertions.

**Read-only:**
- `list_products` returns product IDs/names/SKUs/prices from the actual store.
- `list_orders` returns Order #14 with status `processing`, total `299.00`, currency `INR`, and payment method `cod`.
- `get_order(14)` returns the same live record.
- Date filter queries use explicit time range and verify the relevant order is included only when the interval covers it.

**Product mutation:**
- Create a disposable product with a unique `PHASE3-TEMP-...` SKU using `create_product`.
- Query it back with `list_products`; verify ID/status/price and storefront visibility.
- Delete only this disposable record through a controlled test cleanup method using the WooCommerce API/WP-CLI, not an MCP tool. Confirm cleanup succeeded and preserve the seeded products.

**Order status mutation:**
- Never use Order #14 as the first status-mutation target.
- Prefer create a separate disposable COD/order test record through a controlled test fixture or a deliberate storefront checkout, then update that order's status to `on-hold` and verify through `get_order` / WooCommerce Admin.
- Restore the status only if the test procedure is safe and side effects are understood; otherwise document the final test order and status. The baseline Order #14 should remain unchanged.

**Negative/infrastructure tests:**
- Unsupported order ID/status/invalid query does not mutate the store.
- Simulated 401 from a fake client maps correctly; never change the live Kubernetes credential just to cause an auth error.
- Stop WordPress temporarily only if the technical lead explicitly approves it and the rollback procedure is ready. Phase 3 needs a unit-level upstream failure test; killing the store is not required for routine acceptance because it interrupts the Phase 2 baseline.
- With NetworkPolicy active, the correctly labelled temporary gateway test Pod can connect; an ordinary unlabelled Pod cannot.
- After all tests, verify catalog product count/SKUs and Order #14 still match the baseline, except for any separately documented test order.

### 10.4 External MCP Inspector verification

The MCP server is intentionally internal-only. For Phase 3 debugging, an operator may use `kubectl port-forward` to connect MCP Inspector to the server for protocol verification. This is a privileged local debugging channel, not a public exposure and not the production architecture. Stop the port-forward after the test.

Because the later external client should connect to the **gateway**, do not configure final demo clients to bypass the gateway and use the WooCommerce MCP service directly. Phase 4 replaces this temporary inspection path with the gateway endpoint.

### Acceptance criteria
- Unit/contract tests execute and fail the build when a tested invariant breaks.
- MCP client test discovers and invokes the tools over Streamable HTTP.
- Live test evidence comes from the actual Kubernetes service and WooCommerce REST API.
- Mutation tests use disposable data; cleanup is recorded.
- Baseline products and Order #14 are retained and verified.

---

## 11. Task 3.7 — Documentation and requirement traceability

### Required documentation changes

1. `docs/phase-3/phase-3-execution-log.md`
   - Chronological work performed.
   - Exact commands, image tag/digest, build output and test output summaries.
   - Deployment rollout/pod/service/probe state.
   - Live tool results using fake/non-sensitive data only.
   - Test records and cleanup outcomes.
   - All failed attempts and resolutions, not only successes.
2. `docs/phase-3/woocommerce-mcp-server.md`
   - Purpose and boundaries.
   - Tool contract table with inputs/outputs, side effects, filters and error behavior.
   - REST endpoints used.
   - Authentication method for internal HTTP/HTTPS and why it is appropriate.
   - Timeout, pagination, date and privacy semantics.
   - How to run automated tests and connect to the internal server for local verification.
3. `docs/phase-3/image-lock.md`
   - Exact Node base image tag and digest if pinned, architecture, built application tag and how the local image was imported.
   - No claim that a production registry image exists unless it does.
4. Update `docs/requirements-traceability.md`
   - WMC-01 through WMC-08 statuses reflect actual implementation and evidence.
   - MCP protocol spike remains “protocol verified”; app-level tool tests must be listed separately.
   - `INF-04`/`INF-05` for the new workload are verified from live Kubernetes state only after probes/requests/limits are present in the running Pod.
   - Internal-only / caller NetworkPolicy requirement is not “verified” until both allowed and denied traffic tests pass.
5. Update `README.md`
   - Reproducible package install/build/test steps.
   - Deployment/upgrade commands and how the app image is imported to k3d.
   - How to run read-only tool calls and safe mutation tests.
   - Clearly state that direct MCP access in Phase 3 is for internal/test use; user clients go through the gateway once Phase 4 exists.
6. Update the architecture note only if a real design change was made. Create a short ADR if the internal authentication method or network boundary differs from the Phase 1 decision.

### Documentation quality rules

- Do not write “production-ready,” “fully secure,” or “guaranteed durable” based on local single-node test evidence.
- Keep actual observed values separate from planned settings.
- Never include consumer keys/secrets or a command transcript that prints them.
- Do not say Inspector is using the final external gateway endpoint in Phase 3; the gateway is not implemented yet.
- Clearly state that Store data uses `local-path`, no off-host backup/restore was proved, and this phase does not prove production TLS.

---

## 12. Consolidated test matrix

| ID | Test | Expected result | Type | Blocks Phase 3 exit? |
|---|---|---|---|---|
| P3-001 | Root clean install/build | `npm ci` + root build succeeds | Build | Yes |
| P3-002 | Missing required config | Server doesn't become ready; safe error only | Unit/startup | Yes |
| P3-003 | Internal WordPress DNS/connection | MCP workload resolves and reaches WordPress Service | Cluster integration | Yes |
| P3-004 | Valid internal REST authentication | REST read returns HTTP 200 using the approved auth method | Cluster integration | Yes |
| P3-005 | Invalid auth mapping | Mock 401 maps to sanitized `UPSTREAM_AUTH_FAILED`; no secret leaks | Unit | Yes |
| P3-006 | List tools | Exactly 5 required tools discovered | MCP protocol | Yes |
| P3-007 | `list_products` baseline | Three seeded products can be found | Live integration | Yes |
| P3-008 | `list_products` filters/paging | Search/category/status/page validated | Unit + live | Yes for core filter/search; all edge variations should pass tests |
| P3-009 | `create_product` success | Disposable product is created and published | Live integration | Yes |
| P3-010 | `create_product` invalid inputs | Rejected with no API mutation | Unit | Yes |
| P3-011 | `create_product` duplicate SKU | Conflict returned; no overwrite/duplicate | Unit + live where safe | Yes |
| P3-012 | Product cleanup | Disposable product deleted; seeded SKUs remain | Live integration | Yes |
| P3-013 | `list_orders` baseline | Order #14 appears with expected status/total/payment | Live integration | Yes |
| P3-014 | `list_orders` date filters | Explicit UTC bounds return expected records | Unit + live | Yes |
| P3-015 | `get_order(14)` | Expected order summary returned without sensitive PII | Live integration | Yes |
| P3-016 | `get_order` not found | Safe `NOT_FOUND` response | Unit/live | Yes |
| P3-017 | `update_order_status` | Separate test order status mutates and reads back correctly | Live integration | Yes |
| P3-018 | Invalid status | Rejected before REST mutation | Unit | Yes |
| P3-019 | Upstream timeout/5xx | Clear bounded MCP error, no secret/body leak | Unit | Yes |
| P3-020 | Streamable HTTP | Initialize, discovery, call and clean close work | MCP protocol | Yes |
| P3-021 | Host validation | Unexpected Host rejected as intended | Protocol/security | Yes |
| P3-022 | Helm local render | Store + MCP manifests render; no secret values | Helm | Yes |
| P3-023 | Helm prod render | Values render; image/policy configs are coherent | Helm | Yes |
| P3-024 | Live rollout/probes | MCP Pod becomes Ready and remains stable | Kubernetes | Yes |
| P3-025 | Service exposure | ClusterIP only; no MCP Ingress/NodePort/LoadBalancer | Kubernetes inspection | Yes |
| P3-026 | NetworkPolicy allow/deny | gateway-labelled Pod allowed, ordinary Pod denied | Cluster security | Yes |
| P3-027 | Secret/log safety | no credentials in git diff, image, logs, docs, API outputs | Security review | Yes |
| P3-028 | Baseline retained | Seeded products and Order #14 unchanged after test cleanup | Regression | Yes |
| P3-029 | Documentation traceability | status and evidence links accurate | Review | Yes |

---

## 13. Troubleshooting and guardrails

### 13.1 Internal API authentication returns 401

1. Confirm the MCP Pod uses the existing Secret references and exact key names (`consumer-key`, `consumer-secret`) without revealing values.
2. Confirm the request targets `http://urumi-wordpress.urumi.svc.cluster.local` (or the verified Service FQDN) and path composition is not duplicating `/wp-json/wc/v3`.
3. Confirm the client selected OAuth 1.0a on HTTP. The official WooCommerce JS client source indicates HTTP uses OAuth request parameters; Basic Auth is used for HTTPS.
4. Inspect only safe status/error code and WordPress/WooCommerce error code. Do not log complete URLs with auth query parameters.
5. If the OAuth signature is rejected, compare the request URL and Host the WooCommerce verifier expects against the site's canonical API URL. Test the exact fix. Do not fall back silently to sending Basic credentials over plain HTTP.
6. Do not alter site URL, reissue credentials, widen the helper hostname list, or reinstall plugins without a reviewed reason and a recorded before/after state.

### 13.2 MCP Inspector cannot reach the service

- Confirm the service is ClusterIP and the pod is Ready.
- For a one-off local Inspector test, use a short-lived `kubectl port-forward` and stop it after the test.
- If NetworkPolicy is active, admin port-forward behavior may differ from a normal Pod-to-Service connection. Use a temporary Pod with the agreed gateway label to test the real in-cluster allowed path.
- Do not create an Ingress just to make Inspector convenient.

### 13.3 Pod OOMKilled or restarts

- Check `kubectl describe pod`, previous logs, current `resources` and `kubectl top pods` if metrics are available.
- Don't guess a larger limit without measuring the actual usage and host memory pressure.
- The store already has a 512Mi WordPress limit following the Phase 2 WP-CLI OOM issue; do not re-tune it for MCP-server problems without evidence.
- If the MCP pod is OOMKilled, adjust only its own values and document the measured peak.

### 13.4 Product appears created but response timed out

- Do not retry the POST automatically.
- If the caller provided SKU, reconcile through `list_products` or the REST client by SKU.
- If a duplicate exists, return conflict and let the operator clean the disposable test item intentionally.
- Record this as an ambiguous outcome rather than reporting an unconditional failure or success.

### 13.5 NetworkPolicy denies traffic

- Inspect actual pod labels and policy `podSelector`/`from` selectors.
- Inspect K3s network policy controller status and confirm it is not disabled.
- Verify DNS policy if the MCP pod is restricted on egress.
- Do not remove the policy just to make the test pass. Fix the agreed label/namespace/port contract and prove both allow and deny cases again.

### 13.6 Helm rollout breaks the store

- Stop and capture `helm history`, `helm status`, events, and the exact rendered diff.
- Do not delete PVCs or reinstall the whole namespace.
- Use a controlled Helm rollback only after inspecting the revision and verifying the prior values/manifests; store data must remain intact.
- Recheck Store/PVC/product/order baseline after recovery.

---

## 14. Phase 3 security and operational review

Before exit, answer each question with evidence or an explicit limitation:

1. Where are WooCommerce Consumer Key/Secret stored? (Kubernetes Secret `urumi-woocommerce-api` in namespace `urumi`.)
2. Which Pod can read them? (Only the MCP server's container through `secretKeyRef`; the public browser/gateway user never receives them.)
3. Are they present in source, values files, image layers, logs or tool results? (Must be no; verify rather than infer.)
4. What auth mode is used for internal HTTP? (Record the exact tested OAuth 1.0a/client behavior; do not send Basic secret over plain HTTP.)
5. Is traffic encrypted inside the cluster? (No, not established by this local HTTP design; OAuth signing avoids sending the consumer secret but does not encrypt the HTTP payload. Record that TLS/service-mesh encryption is not implemented in Phase 3.)
6. Can a normal in-cluster Pod call the MCP Service? (Must be denied by the tested NetworkPolicy.)
7. Can the future gateway-labelled Pod call the MCP Service? (Must be allowed.)
8. Does the MCP server expose any public route or ingress? (Must be no.)
9. Does the MCP server ever return the full order record or personal billing data? (Must be no by default.)
10. What does the server log on failure? (Safe code/status/operation and latency, not requests, credentials or raw payloads.)
11. Can an MCP tool mutate the database directly or do arbitrary REST calls? (No; only the five narrow tools are registered.)
12. Does this phase claim production readiness? (No.)

### Known boundaries to preserve

- The store is running in a local, single-node `k3d` environment with `local-path` storage.
- The environment is local HTTP; Phase 3 does not create production TLS or prove off-host backup/restore.
- `local-dev-rest-ssl.php` must remain local-development-only and must not be installed for production.
- WordPress and MariaDB remain single replica.
- The gateway/dashboard/chat and other two MCP services are not implemented yet.
- A NetworkPolicy limits Pod traffic in the local cluster, but the full platform threat model and RBAC hardening belong to later phases.

---

## 15. Phase 3 acceptance gate — manager's Go / No-Go decision

Do not authorize Phase 4 until every mandatory gate is checked with actual evidence. An AI-generated report or rendered YAML alone is not evidence of a live test.

### Gate A — Code and build
- [ ] `apps/mcp-woocommerce` workspace exists with clear module boundaries.
- [ ] Root `npm ci`, root build and server workspace tests pass from committed lockfile.
- [ ] MCP SDK and WooCommerce client versions are pinned / recorded; root lockfile updated.
- [ ] The source is a custom MCP server; no prebuilt WooCommerce MCP server or plugin was installed.

### Gate B — WooCommerce REST boundary
- [ ] Internal Service DNS works from the MCP Pod.
- [ ] REST auth path was proved from the in-cluster workload using the actual configured client and exact auth mode.
- [ ] The consumer secret is not transmitted through Basic Auth on plain HTTP and never appears in logs.
- [ ] All product/order REST calls use `/wp-json/wc/v3` via the adapter; no direct DB access.
- [ ] Timeout/error mapping is tested and bounded.

### Gate C — MCP protocol and tool contracts
- [ ] Streamable HTTP works with the project's pinned SDK.
- [ ] Actual protocol negotiation/version is recorded.
- [ ] Exactly `list_products`, `create_product`, `list_orders`, `get_order`, and `update_order_status` are exposed.
- [ ] All schemas enforce the documented validation and bounds.
- [ ] Tool results use normalized/minimized fields, preserve price strings, and avoid billing PII.
- [ ] Known API failures return clean tool errors rather than raw stack traces or unhandled process failures.

### Gate D — Live functional proof
- [ ] All three seeded products remain available from `list_products`.
- [ ] A product was created through `create_product`, queried back and seen on the storefront.
- [ ] The disposable product cleanup was verified.
- [ ] Order #14 is returned by `list_orders` and `get_order` with the known baseline fields.
- [ ] `list_orders` date filtering works with explicit ISO timestamps.
- [ ] A separate test order was successfully updated and read back via `update_order_status`.
- [ ] Order #14 and the seeded products remain unchanged after testing.

### Gate E — Kubernetes/Helm/private networking
- [ ] Container image builds and is imported into the intended cluster.
- [ ] Deployment is Ready; probes pass; CPU/memory requests and limits exist.
- [ ] Credentials come from Secret references and not Helm values literals.
- [ ] Service is ClusterIP only; no MCP Ingress, NodePort or LoadBalancer exists.
- [ ] NetworkPolicy tests prove gateway-selector allow and ordinary-Pod deny.
- [ ] The app can reach WordPress and DNS through any applied egress restrictions.
- [ ] Local and production values both render cleanly; existing store resources and image digest values are unchanged.

### Gate F — Evidence and docs
- [ ] Phase 3 execution log includes commands run, meaningful outputs, failures and resolutions.
- [ ] Runbook explains how to reproduce deployment and tests without secrets.
- [ ] Requirements traceability statuses match observed evidence.
- [ ] Security review questions in §14 have explicit answers.
- [ ] `git diff` reviewed; no secret values, debug print statements, test mutation leftovers, generated `dist`, or unintended Phase 2 changes.

**Exit decision:**
- **GO** only when all mandatory checklist items above pass.
- **NO-GO** if internal API authentication is unresolved, any of the five tools does not work against real WooCommerce, a mutation lacks a verification/cleanup record, the MCP endpoint is unintentionally public, NetworkPolicy access is not tested, or the source/logs expose credentials/PII.

---

## 16. Required implementation-agent final report

The implementation AI must return this exact report structure at the end of Phase 3:

1. **Summary:** Completed / blocked / not started; no generic claims such as “fully production ready.”
2. **Commits/files changed:** exact paths with a brief purpose for each meaningful change. The repository owner retains control over staging/commit/push unless they explicitly delegate it.
3. **Dependency versions:** Node/npm, MCP SDK, Zod, WooCommerce REST client, Node base image tag/digest and image tag imported into k3d.
4. **Internal authentication proof:** exact internal base URL (no credentials), auth method, successful HTTP status, number of products returned, sanitized negative-test outcome, observed host/signature issue if any, actual negotiated MCP protocol version.
5. **Tool contract table:** name, required arguments, side effects and result fields.
6. **Automated tests:** commands and pass/fail counts, test names, proof that tests fail when expected conditions are broken.
7. **Live MCP tests:** each of the five tools, sanitized input/result summary, whether result was read-only or mutating.
8. **Store regression:** three seeded SKUs retained, Order #14 status/total unchanged, temp product/order cleanup state.
9. **Kubernetes:** release revision, image, pod readiness/restarts, Service type/port, probes, resource requests/limits, Secret references (names/keys only), NetworkPolicy allow/deny evidence, confirmation that no MCP Ingress exists.
10. **Commands and outputs:** exact commands actually executed; include failures rather than deleting them from the narrative.
11. **Security report:** confirmation of no credentials in logs/source/image/results, PII minimization, internal HTTP limitation, and known remaining risk.
12. **Documentation:** links/paths for `docs/phase-3/*`, README and traceability updates.
13. **Unresolved issues / risks:** named owner, impact, mitigation and whether each blocks Phase 4.
14. **Recommendation:** Go / No-Go against §15 with a per-gate evidence list.

---

## 17. Copy-ready work order for the implementation AI

> Paste this section into the coding AI responsible for modifying the repository. Its scope is intentionally limited to Phase 3.

### Work order: Phase 3 — Custom WooCommerce MCP Server

**Role:** You are the senior implementation engineer. Implement only the custom WooCommerce MCP server and the minimal Helm/Kubernetes resources needed to deploy it. The product manager has already approved Phase 2 and frozen the Phase 3 scope.

**Repository:** `https://github.com/AdityaDRathore/MCP-Gateway-Kubernetes-Wcom`  
**Execution window:** 13–14 October 2026.  
**Runtime:** Node.js 24 pinned by repository.  
**Cluster:** `k3d-urumi`, namespace `urumi`.  
**Store Service:** `urumi-wordpress:80` (verify live before using).  
**API Secret:** `urumi-woocommerce-api`, keys `consumer-key` and `consumer-secret` (verify names only; never print values).  
**Baseline:** seeded products `URUMI-MUG-001`, `URUMI-MOUSE-001`, `URUMI-NOTE-001`; Order #14 is `processing`, INR 299.00, COD.  

#### Non-negotiable rules

1. Start with the P0 preflight. Inspect working tree, Node/npm versions, cluster context, Services/Pods/PVCs, Helm release and Secret key names. Preserve all existing store data and Git changes.
2. Do not delete/recreate the cluster, namespace, PVCs, database, API Secret, WordPress deployment or Helm release. Do not change host ports 80 or 3001.
3. Do not expose the MCP server by Ingress. Implement ClusterIP-only networking and prove that only the future gateway-labelled Pod is allowed by NetworkPolicy.
4. Create `apps/mcp-woocommerce` as an npm workspace using the repository's locked stack. Do not create a separate lockfile.
5. Implement exactly the required five tools: `list_products`, `create_product`, `list_orders`, `get_order`, `update_order_status`.
6. Use the WooCommerce REST API `/wp-json/wc/v3`; do not read/write MariaDB directly and do not install an existing WooCommerce MCP server/plugin.
7. Before implementing all tools, prove an authenticated REST request from a Kubernetes workload through the internal `urumi-wordpress` Service. The Phase 2 local SSL helper only allowlists public local hostnames, so do not assume it enables Basic Auth for internal Service DNS. Prefer the official WooCommerce JS client and its OAuth 1.0a behavior for HTTP only after a real in-cluster proof. WooCommerce's official docs specify OAuth 1.0a for HTTP and Basic Auth for HTTPS. Never send the consumer secret as Basic Auth over plain HTTP.
8. Use the pinned MCP SDK version `1.32.1` initially. Follow its actual supported stateless Streamable HTTP example. Record the protocol revision observed in the real handshake; do not rely solely on the existing ADR's stated version.
9. Validate inputs using Zod. Bound search, page/per-page, descriptions, decimal prices, IDs, status enums and date filters. Preserve monetary values as strings. Never automatically retry a timed-out create-product POST.
10. Return normalized data only. Do not expose full billing/shipping addresses, customer email/phone, order keys or raw metadata. Map errors to safe tool errors.
11. Store consumer key/secret only in existing Kubernetes Secret references; do not commit secrets, place them in values files, print environment dumps, or log raw URLs/OAuth parameters/request bodies.
12. Add health endpoints and meaningful liveness/readiness probes. A temporary WooCommerce outage must not cause a tight liveness restart loop.
13. Add the MCP Deployment, ClusterIP Service, narrowly scoped NetworkPolicy and values needed to the existing Helm chart. Preserve the current WordPress/MariaDB image digests and settings. Build a Node 24 image as a non-root user, import it into the existing k3d cluster, and verify that the actual Pod runs it.
14. Test every tool against the live store. Use a disposable product/order for mutation tests. Do not mutate Order #14 as the status test target, and clean up temporary products. Verify baseline products and Order #14 remain intact.
15. Run unit tests, protocol tests, `helm lint`, both local/prod `helm template` renders, cluster rollout/probe checks, Service inspection, NetworkPolicy allow/deny checks, and log/secret scans.
16. Do not implement gateway, dashboard, chat/LLM, CRM/tasks servers or optional features.
17. Do not claim success for commands/tests not actually executed. If blocked, document the exact failure and stop on that dependency rather than generating assumptions.

#### Required output artifacts

- `apps/mcp-woocommerce/` source, tests, package manifest, TypeScript config and Dockerfile.
- Minimal Helm templates for MCP Deployment, ClusterIP Service and NetworkPolicy; updates to current values files.
- `docs/phase-3/phase-3-preflight.md` (or equivalent preflight evidence).
- `docs/phase-3/phase-3-execution-log.md`.
- `docs/phase-3/woocommerce-mcp-server.md`.
- `docs/phase-3/image-lock.md`.
- Updated `docs/requirements-traceability.md` and README.
- ADR update if the actual auth/protocol/network decision differs from Phase 1.

#### Definition of done

- Clean root `npm ci` and build pass.
- Authenticated internal REST request passes using the exact configured client/auth mode; no secret leaks.
- MCP Inspector / pinned SDK client can initialize, list the five tools and invoke them over Streamable HTTP.
- All five tools pass tests and their live-store operations succeed.
- The new product mutation is visible on the storefront and disposable data is cleaned up.
- Order #14 is still unchanged and queryable.
- Order status update passes against a distinct test order.
- Helm lint/local render/production render pass.
- The MCP Deployment is Ready, probes pass, resource requests/limits exist, and the Service is ClusterIP only.
- NetworkPolicy allows the gateway selector and denies an ordinary Pod; the MCP server has no public Ingress.
- Docs and traceability distinguish verified from planned functionality.
- No credentials or unnecessary PII appear in outputs or logs.
- Final report follows Section 16 and recommends Go/No-Go against Section 15.

---

## 18. Official technical references

These sources support protocol and REST behavior. The implementation AI must still confirm all behaviors with the exact locked package and live store before relying on them.

1. WooCommerce REST API overview: <https://developer.woocommerce.com/docs/apis/rest-api/> — API v3 path, response formats, default pagination, `per_page` / `page`, total headers, dates and common errors.
2. WooCommerce authentication: <https://developer.woocommerce.com/docs/apis/rest-api/authentication> — REST API keys, role/permissions, Basic Auth over HTTPS, OAuth 1.0a for HTTP.
3. WooCommerce Products API: <https://developer.woocommerce.com/docs/apis/rest-api/v3/products> — writable fields such as `name`, `regular_price`, `status`, `sku`, category IDs and query parameters.
4. WooCommerce Orders API: <https://developer.woocommerce.com/docs/apis/rest-api/v3/orders/> — statuses, `after` / `before`, `dates_are_gmt`, pagination and order fields.
5. Official WooCommerce JavaScript client: <https://github.com/woocommerce/woocommerce-rest-api-js-lib> — official client API surface, timeout option and HTTP OAuth request behavior in the inspected source.
6. MCP TypeScript SDK v1 docs: <https://ts.sdk.modelcontextprotocol.io/> and <https://ts.sdk.modelcontextprotocol.io/server> — `McpServer`, tools, Streamable HTTP, stateless server example and supported SDK generation.
7. Kubernetes probes: <https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/> — intended semantics and probe safety.
8. K3s networking services: <https://docs.k3s.io/networking/networking-services> — built-in Traefik, DNS and embedded NetworkPolicy controller.

---

## 19. Product manager’s final instruction

Build the smallest complete, real, well-tested WooCommerce MCP server. Do not confuse a passing echo test with a working store integration, a rendered Helm manifest with a running workload, or a pod's `Running` state with a functioning protocol endpoint. Keep the store's baseline safe, use the credentials correctly, test the internal network boundary, and deliver evidence that each required tool behaves as documented.

**Phase 4 is authorized only after the Phase 3 exit gate passes.**
