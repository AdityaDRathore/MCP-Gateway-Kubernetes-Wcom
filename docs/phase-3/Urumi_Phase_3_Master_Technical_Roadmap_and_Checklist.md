# Urumi Phase 3 Master Technical Roadmap & Execution Checklist

## Custom WooCommerce MCP Server on Kubernetes

**Document type:** Technical-head implementation contract,
dependency-gated roadmap, acceptance plan, and coding-AI work order\
**Project:** Urumi --- Team MCP Gateway on Kubernetes with WooCommerce\
**Phase:** 3 --- Custom WooCommerce MCP Server\
**Target namespace:** `urumi`\
**Repository:** `AdityaDRathore/MCP-Gateway-Kubernetes-Wcom`\
**Status:** Proposed execution baseline; workers must verify live
repository/runtime facts\
**Audience:** Technical head, implementation AI, engineering workers,
reviewer, Product Manager\
**Rule:** Do not begin Phase 4 gateway work until the Phase 3 exit gate
passes.

------------------------------------------------------------------------

# 1. Purpose and operating rules

This roadmap translates the Product Manager's Phase 3 plan into an
ordered, testable engineering contract. It specifies scope,
architecture, file-level responsibilities, security requirements, tests,
evidence, and objective go/no-go gates.

The deliverable is a **real TypeScript MCP server** that exposes exactly
five tools and calls the live WooCommerce REST API:

1.  `list_products`
2.  `create_product`
3.  `list_orders`
4.  `get_order`
5.  `update_order_status`

The server must run inside Kubernetes, use the existing WooCommerce
store and integration Secret, remain private to the cluster, and be
deployed through the existing unified Helm chart.

## How workers must execute this roadmap

-   Execute gates in order. Do not skip a gate because a later task
    appears easy.
-   Inspect the current branch, package lock, MCP spike, chart, ADRs,
    and live cluster before changing files.
-   Preserve Phase 2 state: the three seeded products and Order #14.
-   Record actual commands, exit codes, test counts, HTTP statuses,
    image digests, and relevant sanitized logs. Never fabricate
    evidence.
-   If a dependency is blocked, stop dependent work and report the
    blocker, evidence, options, security trade-offs, and recommended
    decision.
-   Update documentation and traceability in the same change set as the
    implementation.
-   Never place consumer credentials, Authorization headers, order keys,
    receipt URLs, customer addresses, email, phone, or other PII in
    logs, screenshots, commits, or reports.
-   Do not add Phase 4 gateway, chat UI, dashboard, generic proxy,
    direct database access, or unrequested MCP tools.

## Conflict resolution

The current repository, pinned package lock, actual Helm values, live
Kubernetes objects, approved ADRs, and verified runtime behavior are
authoritative evidence. If they conflict with this document:

1.  Capture the conflict and exact evidence.
2.  Determine whether the roadmap is stale or implementation drifted.
3.  Follow approved ADRs and explicit assignment requirements over
    convenience.
4.  Do not silently change the SDK, authentication boundary, public
    exposure, or persistent store.
5.  Record material deviations in a decision record and update the
    roadmap.

# 2. Executive outcome and scope

## 2.1 Definition of success

Phase 3 is complete only when an independent reviewer can deploy the
server, discover exactly five tools through MCP, call each tool against
the actual WooCommerce API, observe correct success and safe failure
behavior, verify live mutations by reading the objects back, prove
cleanup works, and verify that the MCP server is not publicly exposed.

A TypeScript build, unit tests with mocks, a healthy pod, or a
successful `helm lint` alone is not acceptance evidence.

## 2.2 In scope

-   A purpose-built TypeScript MCP server.
-   The existing pinned MCP SDK and approved Phase 1 transport.
-   Exactly five WooCommerce tools.
-   A typed/validated WooCommerce REST API client.
-   Strict input validation, bounded outputs, safe errors, and redacted
    structured logs.
-   A verified authentication method for in-cluster requests.
-   Docker image, Helm Deployment, ClusterIP Service, probes, resource
    settings, Secret references, security context, and NetworkPolicy
    where enforceable.
-   Unit, protocol, failure-path, Kubernetes, and live integration
    tests.
-   Documentation, traceability, execution log, and completion report.

## 2.3 Explicitly out of scope

-   Team MCP gateway or multi-tenant gateway (Phase 4).
-   Chat interface, dashboard, frontend, or agent.
-   Generic arbitrary REST proxy or caller-selected upstream URL.
-   Direct MariaDB/WordPress database queries from the MCP app.
-   Public Ingress, NodePort, LoadBalancer, or hostPort for the MCP
    service.
-   OAuth for end users or a new identity provider.
-   Production HA redesign of the local single-node store.
-   Unapproved SDK migration, broad dependency upgrade, database
    migration, or secrets platform migration.

# 3. Existing baseline and integration contract

## 3.1 Phase 1 facts to verify

The known baseline includes Node.js `v24.20.0` pinned by `.nvmrc`, npm
workspaces, TypeScript base configuration, shared package
`@urumi/shared`, MCP SDK previously pinned at
`@modelcontextprotocol/sdk@1.32.1`, a Streamable HTTP MCP transport
spike, protocol revision `2024-11-05` recorded in that spike, and the
unified Helm chart at `infra/helm/urumi-platform`.

These are baseline clues, not permission to skip verification. Inspect
the lockfile and spike. The installed SDK API and tested behavior are
authoritative. Do not upgrade the SDK casually or copy examples from a
different version.

## 3.2 Phase 2 store contract

  -----------------------------------------------------------------------------------------
  Contract item                       Expected value
  ----------------------------------- -----------------------------------------------------
  Kubernetes namespace                `urumi`

  Helm chart                          `infra/helm/urumi-platform`

  WordPress Service                   `urumi-wordpress`

  WordPress Service port              `80/TCP`

  Internal base URL                   `http://urumi-wordpress.urumi.svc.cluster.local:80`

  REST prefix                         `/wp-json/wc/v3`

  Integration Secret                  `urumi-woocommerce-api`

  Secret keys                         `consumer-key`, `consumer-secret`

  Integration user                    `urumi-mcp-integration`

  Integration role                    `shop_manager`

  Seeded product                      `Urumi Test Mug`, SKU `URUMI-MUG-001`, ID previously
                                      observed as `10`

  Seeded product                      `Wireless Mouse Demo`, SKU `URUMI-MOUSE-001`, ID
                                      previously observed as `11`

  Seeded product                      `Notebook Demo`, SKU `URUMI-NOTE-001`, ID previously
                                      observed as `12`

  Protected baseline order            Order `14`, previously `processing`, INR `299.00`,
                                      COD
  -----------------------------------------------------------------------------------------

Previously observed numeric IDs may differ after a fresh bootstrap. Use
SKU to identify seeded products; on the existing stateful cluster, query
Order #14 and record its current baseline. Never assume auto-increment
IDs are portable across rebuilds.

## 3.3 Required preflight inventory

Before coding, run and record:

``` bash
git status --short
git log -8 --oneline --decorate
node --version
npm --version
npm ls @modelcontextprotocol/sdk --depth=0
cat .nvmrc
cat package.json
find apps packages spikes infra/helm/urumi-platform -maxdepth 4 -type f | sort
helm lint infra/helm/urumi-platform
helm template phase3-baseline infra/helm/urumi-platform \
  -f infra/helm/urumi-platform/values-local.yaml
kubectl --context k3d-urumi -n urumi get deploy,statefulset,pod,svc,ingress,networkpolicy,pvc
kubectl --context k3d-urumi -n urumi get secret urumi-woocommerce-api
```

The Secret command must not include `-o yaml`, `jsonpath`, or any
operation that prints Secret data.

Capture: - Git branch, clean/dirty state, and current commit. - Store
pod health and PVC bindings. - WordPress/MariaDB Service types and
ports. - Existing ingress and host-port invariants. - The three seeded
products' SKU, status, and price. - Order #14 status, total, currency,
and payment method. - Helm release/revision, values profile, and current
image references. - Presence of `urumi-woocommerce-api`, without
exposing its data.

## 3.4 Data-preservation invariants

-   Do not delete/recreate `urumi-wordpress-pvc` or `urumi-mariadb-pvc`.
-   Do not reinstall WordPress or rerun destructive DB initialization.
-   Do not delete, refund, cancel, or otherwise alter Order #14 as an
    unapproved test side effect.
-   Do not rename, delete, or change the SKU of any seeded product.
-   Create tests with unique disposable SKUs and clean them up.
-   Prefer a disposable test order for `update_order_status`. If no safe
    disposable order can be created, obtain approval before a reversible
    mutation of Order #14 and guarantee restoration in cleanup.
-   Record before/after state. If cleanup fails, mark the gate FAIL and
    report the exact disposable test object for safe manual cleanup.

# 4. Target architecture and request flow

``` text
MCP client / acceptance harness
          |
          | MCP over the approved Phase 1 transport
          v
+------------------------------------------------+
| Kubernetes namespace: urumi                    |
|                                                |
|  Deployment: urumi-woocommerce-mcp             |
|  - MCP SDK and transport                       |
|  - exactly five explicit tools                 |
|  - input validation                            |
|  - WooCommerce API client                       |
|  - output projection and safe error mapping     |
|  - structured redacted logging                 |
|                   |                            |
|                   | internal HTTP/TLS, approved |
|                   v                            |
|  Service: urumi-wordpress:80                    |
|  /wp-json/wc/v3                                 |
|                   |                            |
|                   v                            |
|          existing MariaDB workload             |
+------------------------------------------------+

The MCP server must have no public Ingress, LoadBalancer, NodePort, or hostPort.
```

## 4.1 Request lifecycle

1.  MCP client connects through the approved transport.
2.  SDK handles initialization and protocol negotiation.
3.  Client calls `tools/list`.
4.  Client invokes a named tool with JSON arguments.
5.  Server validates input strictly.
6.  Tool calls a specific typed method on the WooCommerce API client.
7.  Client authenticates to the internal WordPress Service using the
    approved method.
8.  WooCommerce validates credentials and permissions.
9.  Server checks HTTP status, validates response shape, and projects
    only approved fields.
10. Server returns bounded structured output or a safe error.
11. Logs record tool name, duration, status category, and correlation ID
    where available---never credentials, raw auth headers, or
    unnecessary customer data.

## 4.2 Transport decision

Reuse the transport proven in Phase 1 and supported by the pinned SDK.
Before implementation, verify: - Server construction and initialization
API. - Streamable HTTP lifecycle and request handling. - Supported
protocol revision and behavior when a client offers another version. -
Session/state behavior for the chosen configuration. - Correct handling
of `initialize`, `tools/list`, and `tools/call`. - Graceful cleanup on
shutdown. - How health checks can be served without corrupting MCP
responses.

Prefer the smallest configuration consistent with the existing spike. Do
not hand-implement MCP JSON-RPC if the SDK provides it. A health route
is an operational HTTP endpoint, not an MCP tool.

# 5. Five-tool specification

## 5.1 Shared contract

The five names below are immutable. Register exactly these tools; no
generic `woocommerce_request`, debug tool, SQL tool, or admin tool.

Shared rules: - Strict schema validation at the MCP boundary. - Reject
unknown fields unless there is a documented, deliberate reason not to. -
Never accept caller-controlled URL, host, HTTP method, headers,
arbitrary path, or raw WooCommerce payload. - Bound pagination, string
lengths, nested arrays, and response sizes. - Keep responses stable and
model-friendly. - Never expose credentials, raw Authorization headers,
stack traces, or unfiltered upstream bodies. - For writes, return real
IDs and summary fields from WooCommerce. - Tool descriptions must
disclose meaningful side effects.

## 5.2 `list_products`

**Purpose:** List products from live WooCommerce.

**Input contract:**

``` json
{
  "page": 1,
  "per_page": 10,
  "search": "optional string",
  "sku": "optional string",
  "status": "optional enum: publish | draft | pending | private"
}
```

Defaults: `page=1`, `per_page=10`; hard maximum `per_page=50` (or lower
if chosen and documented). Page must be a positive integer. Trim and
bound strings. Verify installed WooCommerce SKU-filter semantics; do not
silently fetch an unbounded catalog if filtering differs from
expectations.

**API:** `GET /wp-json/wc/v3/products`.

**Output projection:** `id`, `name`, `sku`, `type`, `status`, `price`,
`regular_price`, `stock_status` if available, and bounded category
summaries `{id,name}`. Include currency only if reliably available;
otherwise document that the price is in store currency. Omit arbitrary
metadata, HTML descriptions, full image collections, and large nested
objects.

**Tests:** defaults, three seeded SKUs, valid search/SKU/status filters,
page/size bounds, wrong types, unsupported status, overlong strings,
upstream 401/403/5xx, timeout, malformed response, and proof invalid
inputs do not call upstream.

## 5.3 `create_product`

**Purpose:** Create a simple product in live WooCommerce.

**Input contract:**

``` json
{
  "name": "required string",
  "sku": "required string",
  "regular_price": "required decimal string",
  "description": "optional plain text",
  "status": "optional enum: draft | publish",
  "manage_stock": "optional boolean",
  "stock_quantity": "optional non-negative integer"
}
```

Validation: - `name`: trimmed, non-empty, 1--120 characters. - `sku`:
trimmed, non-empty, bounded, no control characters; apply a documented
safe format. Do not silently normalize case unless specified. -
`regular_price`: decimal string; reject negative values, exponent
notation, NaN/Infinity, currency symbols, and malformed input. Preserve
decimal strings to avoid binary floating-point errors. - `description`:
plain text preferred; bounded length. - `status`: default `draft` unless
requirements explicitly need publish; publishing is a real side
effect. - If `stock_quantity` is present, require `manage_stock=true` or
document a strict alternative. - Reject unknown properties and fields
such as caller-supplied `id`, arbitrary metadata, external images, tax
class, arbitrary attributes, and raw payload.

**API:** `POST /wp-json/wc/v3/products`, sending only allow-listed
fields.

On success validate response and return `{id,name,sku,status,price}`.
Duplicate SKU must become a safe conflict, never silently overwrite. Do
not retry after ambiguous timeout: creation may already have succeeded.
Return an "outcome unknown; verify by SKU" error if necessary.

**Tests:** valid create + read-after-write, missing/blank/overlong
fields, invalid prices, invalid status, wrong types, unknown field,
duplicate SKU, upstream failure, secret/PII absence, cleanup of
disposable product, and proof zero test products remain.

## 5.4 `list_orders`

**Purpose:** List live WooCommerce orders with minimal personal data.

**Input contract:**

``` json
{
  "page": 1,
  "per_page": 10,
  "status": "optional allowed WooCommerce status",
  "after": "optional ISO-8601 timestamp",
  "before": "optional ISO-8601 timestamp"
}
```

Default page/size: `1/10`; maximum 50 or lower. Validate timestamps and
require `after < before` when both are supplied. Verify status-filter
semantics with installed WooCommerce.

**API:** `GET /wp-json/wc/v3/orders`.

**Privacy:** Output only `id`, `status`, `currency`, `total`,
`date_created` where available, payment method if needed, and bounded
line item summaries (product ID, name, quantity, SKU if available).
Never return billing/shipping address, email, phone, IP, user agent,
customer note, or full customer object.

**Tests:** Order #14 appears on existing cluster, status filter, date
validation, pagination bounds, no PII, upstream auth/error handling, and
invalid inputs rejected before upstream call.

## 5.5 `get_order`

**Purpose:** Retrieve one order by ID.

**Input:** `{"order_id":14}`.

Validate a positive safe integer; reject strings, decimals, zero,
negative values, arrays, objects, and unsafe integers.

**API:** `GET /wp-json/wc/v3/orders/{order_id}`.

Return only a detail summary: `id`, `status`, `currency`, `total`,
creation date, payment method, and bounded line items. Exclude
billing/shipping address, email, phone, IP, user agent, customer note,
and raw metadata. Missing order must map to a safe not-found error.

**Tests:** Order #14 status/total, unknown ID, invalid IDs without
upstream call, PII exclusion, and upstream 401/403/429/5xx/malformed
JSON.

## 5.6 `update_order_status`

**Purpose:** Change one order's status, and nothing else.

**Input:** `{"order_id":123,"status":"processing"}`.

Allow only statuses confirmed by the installed WooCommerce version.
Safer initial allow-list: `pending`, `processing`, `on-hold`,
`completed`, `cancelled`, `failed`. Exclude `refunded` unless explicitly
required and approved; a status change is not the same as issuing a
financial refund.

**API:** `PUT /wp-json/wc/v3/orders/{order_id}` with an allow-listed
status only.

Return `{id,previous_status,status,updated:true}` only after validating
the upstream response. Define/test behavior when requested status
already matches. Never change totals, line items, payment fields,
customer details, refunds, or other order properties. Do not blindly
retry after an ambiguous timeout because WooCommerce
hooks/emails/integrations may run.

**Tests:** live status mutation and read-after-write, invalid status/ID,
missing order, no-op behavior, mutation timeout semantics, and
guaranteed cleanup. Prefer disposable order. Order #14 must remain at
its baseline state.

# 6. Blocking authentication investigation

## 6.1 Why this is the first technical gate

Phase 2's `local-dev-rest-ssl.php` is a local development helper. Its
documented hostname allow-list includes `shop.127.0.0.1.nip.io`,
`localhost`, and `127.0.0.1`; the future MCP server calls
`urumi-wordpress.urumi.svc.cluster.local`. Do not assume the helper
permits the internal hostname.

Basic authentication sends a Base64 representation of
`consumer-key:consumer-secret`; Base64 is not encryption. Setting
`$_SERVER['HTTPS']='on'` is an application-level signal and does not
encrypt the HTTP path.

**Do not implement all handlers until an authentication method is
verified against the live internal Service.**

## 6.2 Gate A: internal connectivity

From a temporary pod in namespace `urumi`, using a pinned diagnostic
image: 1. Resolve `urumi-wordpress.urumi.svc.cluster.local`. 2. Connect
to Service port 80. 3. Request `/wp-json/`. 4. Request
`/wp-json/wc/v3/products` without credentials and record the status. 5.
Confirm requests use internal Service DNS, not public ingress. 6. Never
print credentials; delete the diagnostic pod afterward.

## 6.3 Gate B: test authentication candidates

With tightly controlled output, test: - Basic auth over internal HTTP
with the existing helper unchanged. - Basic auth when the internal
hostname is used and helper is active. - OAuth 1.0a signing over HTTP
against the installed WooCommerce version. - Internal TLS feasibility
without disabling certificate verification or introducing an unapproved
trust bypass.

For OAuth, verify actual WooCommerce behavior: signature base URL, query
parameter canonicalization, URL encoding, clock handling, and how
WordPress perceives the request URL. Do not choose OAuth merely because
a document mentions it.

## 6.4 Decision options

**Option A --- internal TLS (preferred if feasible):** Establish
verified TLS between MCP and WordPress; validate hostname and
certificate chain; use supported HTTPS Basic auth; do not disable
verification.

**Option B --- verified OAuth 1.0a over HTTP:** Use only after live
end-to-end proof. Prefer a maintained compatible library. Document that
OAuth authenticates but does not encrypt request contents; constrain it
to the cluster network and state the limitation.

**Option C --- constrained local-development compatibility adaptation:**
Only after explicit technical-head approval if A/B are not feasible. Do
not indiscriminately broaden the helper allow-list or treat a spoofable
Host header as proof of a trusted connection. Document that `HTTPS=on`
is not encryption. This is a development exception, not production
architecture.

**Option D --- stop and escalate:** If no acceptable method is verified,
report evidence/options and stop dependent implementation.

## 6.5 Authentication acceptance

-   Internal Service DNS is used.
-   No public Ingress URL is used by runtime API calls.
-   Correct credentials succeed; missing/invalid credentials fail
    safely.
-   Permission failures are tested.
-   Method is documented and tested against the installed WooCommerce
    version.
-   TLS verification is not disabled.
-   Credentials never appear in source, values, ConfigMaps, logs, tool
    results, or committed files.
-   Security limits of any HTTP-based solution are stated accurately.

# 7. Application structure and coding standards

## 7.1 Recommended structure

Adapt to the existing monorepo rather than duplicating conventions:

``` text
apps/woocommerce-mcp/
  package.json
  tsconfig.json
  src/
    index.ts                 # process entrypoint and lifecycle
    server.ts                # MCP server and transport wiring
    config.ts                # validated configuration
    tools/
      index.ts               # exact five-tool registry
      list-products.ts
      create-product.ts
      list-orders.ts
      get-order.ts
      update-order-status.ts
    woocommerce/
      client.ts              # authenticated HTTP client
      schemas.ts             # upstream response validation
      errors.ts              # typed upstream/domain errors
      mappers.ts             # bounded output projection
    validation/
      common.ts
      products.ts
      orders.ts
    http/
      health.ts
    logging/
      logger.ts
  test/
    unit/
    protocol/
    integration/
  Dockerfile
  .dockerignore
```

This is a suggested layout, not a requirement to duplicate existing
modules. Keep the implementation small and testable.

## 7.2 Module responsibilities

**`config.ts`** - Validate required environment at startup. - Fail
clearly if Secret-derived credentials are missing. - Accept only the
expected upstream host/scheme and fixed API prefix. - Do not log secret
environment variables. - Do not permit caller-controlled upstream URL. -
Make insecure development mode explicit, not the default.

**WooCommerce client** - Own all upstream requests and authentication. -
Expose only typed methods needed by the five tools. - Apply timeout and
response-size limits. - Validate response shapes. - Centralize HTTP
status/error handling. - Never expose raw response bodies without size
limits/redaction. - Never fall back to public ingress.

**Tool modules** - Validate input. - Call one specific API-client
method. - Map the response to stable output. - Convert known errors to
safe MCP errors. - Contain no Kubernetes/filesystem logic.

**Logger** - Structured one-event-per-line logs. - Include timestamp,
severity, service, tool name, duration, upstream status category, and
correlation ID where possible. - Never log Authorization headers,
credentials, OAuth signatures, raw customer/order payloads, or full
environment. - Sanitize user-controlled values to prevent log injection.

## 7.3 Dependencies and TypeScript

-   Use existing npm workspaces and lockfile.
-   Keep the MCP SDK pinned unless a blocker is demonstrated and
    approved.
-   Add only dependencies needed for schema validation, HTTP, logging,
    and the selected authentication.
-   Prefer existing packages if suitable.
-   Review license, maintenance, version lock, and security posture of
    added dependencies.
-   Use `unknown` at untrusted boundaries and narrow through validation;
    avoid `any`.
-   No runtime code download or dynamic install during container
    startup.
-   Review lockfile changes before committing.

# 8. API client behavior

## 8.1 URL construction

-   Use the internal WordPress Service base URL by default:
    `http://urumi-wordpress.urumi.svc.cluster.local:80`, unless verified
    current deployment conventions differ.
-   Fixed API prefix `/wp-json/wc/v3`.
-   Build paths from known endpoint constants.
-   Encode only validated query values and numeric IDs.
-   Reject absolute URLs, path fragments, `../`, host overrides, or
    arbitrary methods.
-   Do not fall back to public ingress if internal DNS fails.
-   Authentication/signature host must match the actual request URL.

## 8.2 Timeouts and bounded work

Initial tuning target: 5-second connection timeout and 10-second total
request timeout, adjusted only with evidence. Bound response sizes
(initial target 1 MiB for list endpoints), page size, and nested arrays.

-   No automatic retry for POST create or ambiguous PUT update.
-   For safe GETs, at most one retry may be considered for transient
    failures, documented and bounded.
-   Avoid unbounded request queues.
-   Respect cancellation where supported.
-   Reuse an appropriate HTTP client rather than creating unnecessary
    clients per call.
-   Ensure one slow upstream call does not unnecessarily block unrelated
    calls.

## 8.3 Error mapping

  -----------------------------------------------------------------------
  Upstream condition                  Safe MCP-facing behavior
  ----------------------------------- -----------------------------------
  400                                 Validation/upstream rejection; no
                                      raw HTML

  401                                 Authentication configuration error;
                                      no credentials

  403                                 Permission denied

  404                                 Domain not-found error

  409/SKU conflict                    Duplicate/conflict error where
                                      detectable

  429                                 Rate limited; retry only if policy
                                      permits

  5xx                                 Upstream unavailable with safe
                                      status/correlation ID

  Timeout                             Timeout; mutation outcome may be
                                      unknown

  DNS/connect failure                 Upstream unreachable; no public
                                      fallback

  Invalid JSON/schema                 Upstream protocol/response error;
                                      no raw body

  Unexpected internal error           Generic client error; sanitized
                                      diagnostic in logs
  -----------------------------------------------------------------------

WooCommerce error bodies can vary. Parse only known bounded fields such
as `code`, `message`, and status. Sanitize any upstream message. Never
echo arbitrary HTML or unbounded bodies.

## 8.4 Currency and pagination

-   Preserve WooCommerce decimal strings; do not use binary floating
    point for currency.
-   Do not compute order totals from line items; use upstream canonical
    total.
-   Treat INR as current store configuration, not a hardcoded
    calculation assumption.
-   Default page size 10; hard maximum 50 or lower.
-   Positive integer page.
-   Do not automatically crawl all pages.
-   Return total/page metadata only if supported by verified response
    headers.
-   Keep response summaries and byte size bounded.

# 9. MCP protocol acceptance

-   Server has a stable name, e.g. `urumi-woocommerce-mcp`, and version
    from package metadata.
-   SDK handles initialization and protocol negotiation.
-   Exactly five tools are registered.
-   `tools/list` schemas are valid and descriptions explain
    effects/constraints.
-   Valid calls return expected SDK result shape; errors are
    distinguishable from success.
-   No extra debug/admin/generic proxy tool.
-   Unknown tool is rejected safely.
-   Invalid inputs do not crash the process.
-   Malformed protocol messages are rejected safely.
-   Multiple sequential calls work.
-   Concurrent calls do not leak/corrupt data between requests.
-   Client disconnect and SIGTERM do not cause unhandled rejections or
    leaked sockets.
-   No diagnostic output contaminates the MCP protocol stream.
-   Transport session behavior is tested for the actual selected
    configuration.

# 10. Kubernetes and Helm

## 10.1 Required resources

Add to the existing unified chart: - Deployment, initially one
replica. - ClusterIP Service. - Secret references to
`urumi-woocommerce-api`. - Container port for the MCP transport. -
Startup/readiness/liveness probes appropriate to the implementation. -
CPU/memory requests and limits. - Security context. - NetworkPolicy if
the CNI supports enforcement. - ConfigMap only for non-secret
configuration. - Labels/selectors consistent with existing Helm helpers.

Suggested workload/service name: `urumi-woocommerce-mcp`. Follow
existing chart naming conventions if they differ, and document final
names.

## 10.2 Container build and hardening

-   Multi-stage Docker build where practical.
-   Compile TypeScript during build.
-   Runtime image contains only compiled output and runtime
    dependencies.
-   Add `.dockerignore`.
-   Exclude `.git`, tests, local `.secrets`, `.env`, kubeconfig, Docker
    socket, and unrelated workspaces.
-   Pin a supported Node 24 base image; record digest under the
    project's image-lock policy.
-   Do not use floating `latest`.
-   Run as non-root with fixed unprivileged UID/GID where feasible.
-   Set read-only root filesystem if compatible; use explicit writable
    `emptyDir` only where necessary.
-   Drop Linux capabilities, `allowPrivilegeEscalation: false`, and
    `seccompProfile: RuntimeDefault` where supported.
-   Handle SIGTERM and set a suitable termination grace period.
-   Never bake credentials into image layers/build args.

## 10.3 Environment and Secret contract

Non-secret configuration may include: - `NODE_ENV=production` - `PORT`,
bind host - `WOOCOMMERCE_BASE_URL` - fixed API prefix - request timeout,
maximum page size, log level, explicit environment mode

Secrets: - `WOOCOMMERCE_CONSUMER_KEY` from Secret key `consumer-key` -
`WOOCOMMERCE_CONSUMER_SECRET` from Secret key `consumer-secret`

Do not put secret literals in Helm values. If a Secret key is absent,
fail clearly without dumping environment.

## 10.4 Resource starting point

Initial starting point only: - Requests: CPU `50m`, memory `64Mi` or
`128Mi`. - Limits: CPU `250m`, memory `256Mi` or `384Mi`.

Measure actual peak usage and confirm WordPress/MariaDB retain
sufficient host capacity. Record final values and reason.

## 10.5 Probes

-   Startup probe tolerates initialization.
-   Readiness confirms the server can accept work; do not make it fail
    merely because WooCommerce is temporarily unavailable.
-   Liveness detects a wedged process, not upstream downtime.
-   Probes must not mutate the store.
-   Do not return a fake healthy response when application
    initialization failed.
-   Health endpoints are not MCP tools and must not disclose
    configuration/secrets.

## 10.6 NetworkPolicy

If enforcement is supported: - Select only MCP pods. - Allow ingress
only from approved client/test pod or namespace labels. - Allow DNS
egress and WordPress Service/endpoints on the approved port. - Deny
unrelated egress, including direct MariaDB access. - Avoid breaking
existing WordPress-to-MariaDB and ingress-to-WordPress paths. - Test
positive and negative connectivity.

NetworkPolicy enforcement depends on CNI. A rendered policy is not
proof. If local k3d does not enforce it, document the limitation and do
not claim isolation is proven by policy alone.

## 10.7 Private exposure gate

-   MCP Service is `ClusterIP`.
-   No MCP Ingress, LoadBalancer, NodePort, or hostPort.
-   No k3d host port mapping for MCP.
-   In-cluster approved client can reach it.
-   Host direct access is unavailable except an explicit temporary
    port-forward for testing.
-   Unapproved pod is denied if policy enforcement is enabled.
-   Existing store Ingress is unchanged.
-   MariaDB remains unexposed.
-   Do not touch existing host ports 80, 3001, 8080, or 8443.

# 11. Security requirements

## 11.1 Secrets and least privilege

-   Consume the existing Secret via `secretKeyRef`.
-   Do not rotate/create duplicate long-lived credentials without
    approval.
-   Never print credentials or auth headers.
-   Do not commit `.secrets/` or `.env`.
-   Test failure output for redaction.
-   Kubernetes Secret values are base64-encoded and are not
    automatically encrypted at rest in every cluster; restrict RBAC and
    state the control accurately.
-   Verify current `shop_manager` permissions support required calls.
    Document role breadth; consider a narrower role only if feasible
    without unapproved scope.
-   Never implement arbitrary endpoint forwarding or direct SQL.
-   Do not allow tools to modify customer details, totals, line items,
    refunds, payment data, or arbitrary metadata.

## 11.2 Input and response safety

-   Validate type, bounds, enum, format, and unknown keys.
-   Prevent host override, path traversal, and arbitrary endpoint
    construction.
-   Bound strings, arrays, pages, and response bytes.
-   Avoid unsafe merges of untrusted objects.
-   Sanitize user-controlled log fields.
-   Reject unsupported control characters in SKUs where appropriate.
-   Never return unnecessary PII.
-   Use fictional test data.
-   Never save raw order API responses as fixtures.

## 11.3 Dependencies and runtime

-   Pin dependencies through lockfile.
-   Run approved dependency vulnerability checks; triage findings rather
    than blindly upgrading the MCP SDK.
-   Run non-root.
-   Do not mount Docker socket, host filesystem, or kubeconfig.
-   Do not grant Kubernetes API permissions unless a proven need exists;
    this server should not need them.
-   Keep debug endpoints disabled.

# 12. Test strategy and harness

## 12.1 Test layers

1.  Static checks: format, lint, type-check, build.
2.  Unit tests: schemas, mapping, status policy, URL construction, error
    conversion, redaction.
3.  Protocol tests: initialize, tools/list, valid/invalid tool calls,
    unknown tool.
4.  API-client tests: mock HTTP server for statuses, timeouts,
    malformed/oversized response and redaction.
5.  Live integration tests: mandatory for final acceptance.
6.  Kubernetes tests: Helm lint/render, rollout, probes, Secret
    injection, service exposure, policy enforcement.
7.  Regression/data preservation: seeded SKUs and Order #14
    before/after.

Mocks are useful for failure-path testing; they do not replace live
acceptance.

## 12.2 Integration harness

Provide a repeatable script such as `scripts/test-phase3-integration.sh`
that: - Verifies cluster context/namespace before acting. - Verifies
WordPress and MCP readiness. - Captures baseline product
SKU/status/price and Order #14 status/total. - Connects through MCP
protocol from an approved in-cluster client or temporary test pod. -
Runs initialize and tools/list. - Executes all five tools. - Creates a
unique disposable product. - Verifies it by subsequent MCP read and/or
direct authenticated REST read. - Cleans it up via a test-only REST
cleanup path; do not add a sixth production MCP tool. - Tests
`update_order_status` against a disposable order where feasible. - If
Order #14 must be used, requires approval and guarantees restoration. -
Confirms all three seeded SKUs remain unchanged. - Confirms Order #14
baseline remains unchanged. - Emits sanitized pass/fail output. - Exits
nonzero if cleanup fails or protected data changes.

## 12.3 Cleanup safety

-   Generate a unique run ID.
-   Use a mode-0600 temporary file only if cleanup state must survive
    commands.
-   Use a shell `trap` or equivalent guaranteed cleanup.
-   Before deletion, verify the disposable SKU/ID belongs to the current
    test run.
-   Never delete based only on a broad prefix.
-   Never delete seeded SKUs.
-   If cleanup fails, report exact disposable IDs/SKUs and a safe manual
    cleanup command; do not print credentials.

## 12.4 Failure injection

Test, in an isolated mock or disposable environment as appropriate: -
Wrong/missing credentials. - Missing Secret key or empty env var. -
WordPress unavailable, DNS failure, wrong host. - 401, 403, 404, 429,
500, 503. - GET timeout. - Create timeout after request may have reached
WooCommerce. - Malformed JSON and oversized body. - Invalid MCP
arguments. - Client disconnect during request. - SIGTERM while idle and
while a request is active. - NetworkPolicy blocking MCP-to-WordPress. -
Unapproved client attempting to reach MCP Service.

# 13. Ordered execution plan and gates

## G0 --- Repository, environment, and data preflight

**Tasks** 1. Inspect branch and working tree. 2. Read Phase 1 ADRs, MCP
spike, Phase 2 runbook, execution log, image lock, traceability. 3.
Confirm SDK and package versions from lockfile. 4. Confirm chart
structure and values precedence. 5. Confirm Kubernetes context and
namespace. 6. Confirm WordPress/MariaDB health and PVCs. 7. Record
seeded SKUs and Order #14 baseline. 8. Confirm Secret object exists
without reading its data. 9. Record port invariants and current image
digests. 10. Report any discrepancies.

**Exit:** baseline report exists; store is healthy; protected data is
recorded; no destructive change is needed.

**Stop if:** wrong cluster, missing data/Secret, unknown dirty changes,
port conflict, or chart drift that could overwrite the store.

## G1 --- Internal authentication spike (blocking)

**Tasks** 1. Prove internal DNS, TCP, and WordPress REST reachability.
2. Test no-credential and invalid-credential behavior. 3. Test current
helper with internal hostname. 4. Verify OAuth 1.0a behavior if
considered. 5. Evaluate internal TLS. 6. Compare confidentiality,
integrity, trust boundary, effort, and production suitability. 7. Write
and review an authentication decision record.

**Exit:** one approved authentication path works end-to-end; valid
credentials succeed, invalid credentials fail; redaction is verified;
decision recorded.

**Stop if:** the plan disables TLS verification, misrepresents Base64 as
encryption, broadens helper trust without controls, or selects OAuth
without live verification.

## G2 --- Application skeleton

**Tasks** 1. Create/extend app workspace. 2. Add strict TypeScript
config. 3. Add validated config, MCP server/transport, logger, health
check, graceful shutdown. 4. Add scripts for build, type-check, lint,
tests. 5. Prove initialization and tool discovery with the pinned SDK.
6. Do not add real mutations yet.

**Exit:** clean-clone install/build works; protocol test passes; health
check is safe; no Phase 4 code.

## G3 --- WooCommerce client

**Tasks** 1. Fixed internal base URL and REST prefix. 2. Approved auth
mechanism. 3. Timeout and response-size bounds. 4. Typed methods for
only required endpoints. 5. Upstream error mapping and response schema
validation. 6. Redacted structured logging. 7. Mock-server tests for
error/timeout/invalid JSON. 8. Prove no direct DB and no public URL
fallback.

**Exit:** live authenticated GET succeeds; invalid credentials fail;
safe errors/redaction pass.

## G4 --- Read tools

Implement `list_products`, `list_orders`, `get_order`.

For each: strict schema, output projection, unit tests, MCP protocol
test, live integration test, PII exclusion.

**Exit:** all three read tools work live; three seeded SKUs are visible;
Order #14 status/total match baseline; invalid inputs make no upstream
request; order outputs omit PII.

## G5 --- Write tools

Implement `create_product` and `update_order_status`.

For each: allow-listed fields/statuses, duplicate SKU behavior, no
unsafe retries, disposable fixture plan, cleanup, and read-after-write
verification.

**Exit:** create changes live store and returns actual ID; status update
changes approved test order and is confirmed by read; cleanup succeeds;
protected baseline data is preserved.

## G6 --- Container and Helm deployment

**Tasks** 1. Add Dockerfile and `.dockerignore`. 2. Build minimal
runtime image. 3. Run non-root with least privilege. 4. Pin image
reference/digest and document it. 5. Add Deployment, ClusterIP Service,
Secret references, resources, probes, security context, and
NetworkPolicy where enforceable. 6. Render/lint local and prod values.
7. Inspect manifests for secret leaks and public exposure. 8. Deploy to
confirmed cluster. 9. Verify rollout and actual running image digest.
10. Verify store remains healthy.

**Exit:** lint/render pass; pod Ready; Secret refs resolve; no public
exposure; network boundary tested; store unchanged.

## G7 --- Full end-to-end acceptance

**Tasks** 1. Run all five tools through MCP protocol. 2. Run
invalid-input and upstream-failure tests. 3. Verify exact five-tool
registry. 4. Verify private boundary and policy enforcement. 5. Scan
logs/artifacts for secrets and PII. 6. Measure resource use. 7. Test
restart and graceful shutdown. 8. Re-check seeded products and Order
#14. 9. Verify cleanup. 10. Review docs against actual behavior.

**Exit:** all hard blockers in Section 15 pass; no unexplained failure;
no unresolved critical/high issue without explicit acceptance.

## G8 --- Documentation, handoff, and sign-off

Deliver: - Architecture document. - Five-tool contract. - Authentication
decision/ADR. - Deployment runbook. - Integration test runbook. -
Execution log. - Completion report. - Updated README, image lock,
requirements traceability.

**Exit:** independent reviewer can deploy, discover tools, run tests,
understand auth boundary, and clean up without hidden steps. Product
Manager receives evidence-based GO/NO-GO recommendation.

# 14. Helm and runtime checks

Run:

``` bash
helm lint infra/helm/urumi-platform
helm template phase3-local infra/helm/urumi-platform \
  -f infra/helm/urumi-platform/values-local.yaml > /tmp/phase3-local.yaml
helm template phase3-prod infra/helm/urumi-platform \
  -f infra/helm/urumi-platform/values-prod.yaml > /tmp/phase3-prod.yaml
```

Review rendered manifests for: - One MCP Deployment and ClusterIP
Service. - Correct labels, selectors, ports, image reference and
digest. - Secret references target `urumi-woocommerce-api`. - No secret
literals in rendered YAML. - No MCP Ingress, LoadBalancer, NodePort, or
hostPort. - Resource requests/limits, probes, and security context. -
NetworkPolicy selectors and intended ingress/egress. - Existing
WordPress/MariaDB names, selectors, PVCs, and services unchanged. -
Local/prod differences intentional.

Deployment verification:

``` bash
kubectl --context k3d-urumi -n urumi rollout status deployment/urumi-woocommerce-mcp --timeout=180s
kubectl --context k3d-urumi -n urumi get deploy,pod,svc
kubectl --context k3d-urumi -n urumi describe deployment urumi-woocommerce-mcp
kubectl --context k3d-urumi -n urumi logs deployment/urumi-woocommerce-mcp --since=10m
```

Review logs before sharing. Never use `kubectl describe secret` or print
Secret data as evidence.

## Rollback

-   Record current Helm revision before deploy.
-   Prefer rolling back the application-only release if safe, then
    verify it does not remove/change store resources.
-   Do not use `helm uninstall` as routine rollback.
-   If a Phase 3 NetworkPolicy breaks existing traffic, roll back only
    that policy and revalidate store traffic.
-   If a DB migration or persistent-store change appears necessary,
    stop; Phase 3 should not require schema changes.
-   Document rollback commands and prove WordPress, MariaDB, and PVCs
    remain healthy.

# 15. Acceptance checklist and go/no-go

## 15.1 Hard blockers --- all must pass

-   [ ] Phase 2 baseline recorded and preserved.
-   [ ] Internal authentication verified against live WooCommerce.
-   [ ] No unapproved Basic consumer credentials over unencrypted HTTP.
-   [ ] Runtime uses internal WordPress Service, not public ingress.
-   [ ] Exactly five MCP tools registered.
-   [ ] All five invoke live WooCommerce REST API.
-   [ ] `list_products` finds the three seeded SKUs.
-   [ ] `create_product` creates a real disposable product and returns
    its real ID.
-   [ ] `list_orders` works and includes Order #14 on existing store.
-   [ ] `get_order` returns expected Order #14 status/total and no PII.
-   [ ] `update_order_status` changes an approved test order and
    read-after-write confirms it.
-   [ ] Invalid inputs rejected before upstream mutation.
-   [ ] Unauthorized/insufficient-permission behavior tested.
-   [ ] Ambiguous mutation timeout does not trigger blind retry.
-   [ ] Cleanup succeeds; no disposable records remain.
-   [ ] Seeded products and Order #14 retain baseline state.
-   [ ] MCP Service is ClusterIP only; no public exposure.
-   [ ] Network isolation demonstrated to degree supported; gaps
    disclosed.
-   [ ] No secret in Git, manifests, logs, or tool output.
-   [ ] Unit, protocol, and live integration tests pass.
-   [ ] Helm lint/render pass for local and prod.
-   [ ] Non-root container, security context, resources, and probes
    present.
-   [ ] Runbook and traceability match implementation.
-   [ ] No Phase 4 implementation started.

Any unchecked hard blocker means **NO-GO for Phase 4**.

## 15.2 Quality criteria

-   [ ] Clean-clone `npm ci` and build work.
-   [ ] Dependency audit run; introduced critical/high issues resolved
    or explicitly accepted.
-   [ ] Structured logs include tool, duration, status category,
    correlation ID where available.
-   [ ] Response size and pagination bounded.
-   [ ] Graceful shutdown/restart tested.
-   [ ] Resource use measured within host budget.
-   [ ] Failure artifacts safe to share.
-   [ ] Rollback rehearsed or documented with verified resource
    preservation.
-   [ ] Changes committed with meaningful messages.

## 15.3 Gate table

  -----------------------------------------------------------------------
  Gate                    Evidence                Decision
  ----------------------- ----------------------- -----------------------
  G0 Baseline             Repo/cluster inventory  Go / Stop
                          and protected data      
                          baseline                

  G1 Auth                 Internal connectivity,  Go / Stop
                          correct/incorrect       
                          credential results,     
                          decision record         

  G2 Skeleton             Clean build, protocol   Go / Stop
                          test, safe health check 

  G3 API client           Live authenticated      Go / Stop
                          read, failure/redaction 
                          tests                   

  G4 Read tools           Three read tools live,  Go / Stop
                          no PII                  

  G5 Write tools          Mutations confirmed,    Go / Stop
                          cleanup, baseline       
                          preserved               

  G6 Deployment           Helm, image, private    Go / Stop
                          Service,                
                          probes/security context 

  G7 Acceptance           All hard blockers and   Accept / Reject
                          evidence bundle         

  G8 Phase 4              Technical head +        Authorized / Not
                          Product Manager         authorized
                          approval                
  -----------------------------------------------------------------------

# 16. Risks and escalation

## Highest risks

1.  **Authentication mismatch:** local helper may not work with internal
    Service hostname; HTTP Basic is not encrypted.
2.  **SDK/transport drift:** examples may not match pinned SDK/protocol.
3.  **Accidental exposure:** chart change adds Ingress or host port.
4.  **Mutation damage:** status test alters Order #14 or triggers hooks.
5.  **Secret leakage:** shell traces, raw HTTP logs, test errors, or
    Helm values expose credentials.
6.  **PII leakage:** order tools return customer information
    unnecessarily.
7.  **False acceptance:** mocks or healthy pod are mistaken for live
    end-to-end proof.
8.  **NetworkPolicy illusion:** policy renders but CNI does not enforce
    it.
9.  **Image drift:** deployed pod runs an older image than tested
    source.
10. **Scope creep:** gateway/dashboard/chat added before Phase 3
    acceptance.

Stop and escalate if authentication requires changing a security
boundary; a new dependency/SDK migration/schema change appears
necessary; protected data could be altered; order status semantics are
ambiguous; chart drift risks the store; network isolation cannot be
demonstrated; or any hard blocker fails.

## Decision record template

``` markdown
# Decision: <short title>
- Date:
- Owner:
- Context:
- Evidence collected:
- Options considered:
- Security impact:
- Operational impact:
- Scope impact:
- Decision:
- Rejected alternatives:
- Known limitations:
- Tests/evidence:
- Approval:
```

# 17. Copy-ready implementation work order for the coding AI

## WORK ORDER --- Implement Phase 3 only

You are the implementation engineer for the Urumi Kubernetes MCP Gateway
assignment. Implement Phase 3 according to this roadmap and the current
repository's approved ADRs.

### Objective

Build and deploy a real TypeScript MCP server inside Kubernetes exposing
exactly: - `list_products` - `create_product` - `list_orders` -
`get_order` - `update_order_status`

Every tool must call the live WooCommerce REST API. Do not mock runtime
store data. Do not implement Phase 4 gateway, chat UI, dashboard,
generic REST proxy, direct SQL, or extra MCP tools.

### Mandatory rules

1.  Inspect repository, branch, package lock, MCP spike, chart, ADRs,
    Phase 2 runbook, execution log, image lock, and traceability before
    editing.
2.  Report Git status/recent commits; never overwrite unknown user
    changes.
3.  Verify pinned SDK API and transport; no casual upgrade.
4.  Confirm cluster context before mutations.
5.  Record seeded product and Order #14 baseline.
6.  Never print credentials, auth headers, order keys/receipt URLs, or
    customer PII.
7.  Use internal WordPress Service, not public ingress, for runtime
    requests.
8.  Treat auth as a blocking spike; prove behavior before building all
    handlers.
9.  Do not claim Base64 is encryption.
10. Do not send consumer credentials via Basic Auth over unencrypted
    HTTP as the final approach unless technical head explicitly approves
    a constrained development exception after reviewing alternatives.
11. Never disable TLS certificate verification.
12. Do not add MCP Ingress, LoadBalancer, NodePort, hostPort, or public
    host mapping.
13. Register exactly five tools; health checks are not tools.
14. Strictly validate inputs; allow-list fields/statuses; bound
    pagination and responses.
15. Exclude PII from order outputs and logs.
16. Do not retry create/update after ambiguous timeouts.
17. Use disposable data and guaranteed cleanup; never leave Order #14
    changed.
18. Use existing workspace/unified Helm chart; avoid unnecessary
    architecture changes.
19. Build a non-root image with resources, probes, security context, and
    tested NetworkPolicy where possible.
20. Update docs/traceability with actual results only.
21. Do not start Phase 4.
22. Never mark a gate PASS without evidence.

### Execution order

**Step 1 --- Preflight:** inspect repository/ADRs/SDK/chart; verify
cluster context and store health; check Secret existence without
printing data; record seeded SKUs and Order #14 baseline. Stop if
context or protected state is uncertain.

**Step 2 --- Authentication spike:** prove internal DNS/TCP/API
reachability; test no/invalid/valid credentials from inside cluster;
test current helper with internal hostname; verify OAuth behavior if
considered; assess internal TLS; write decision record. If a security
exception is needed, stop and request approval.

**Step 3 --- Skeleton:** add app workspace, strict TypeScript, validated
config, MCP server/transport, redacted logger, health check, graceful
shutdown, build/type-check/lint/test scripts. Prove initialization and
tool discovery using the pinned SDK.

**Step 4 --- API client:** fixed internal URL and REST prefix; approved
auth; timeouts/body bounds; typed endpoint methods; error mapping and
response validation; tests for 401/403/404/429/5xx, timeout, malformed
JSON, oversized response, missing config, and redaction. No direct
DB/public fallback.

**Step 5 --- Read tools:** implement three read tools, strict schemas,
bounded projections, unit/protocol/live tests; verify seeded SKUs and
Order #14; prove no PII.

**Step 6 --- Write tools:** implement create/update with allow-lists,
duplicate SKU handling, no unsafe retries, disposable data and cleanup.
Verify every mutation via subsequent live read. Use disposable order; if
Order #14 is unavoidable, request approval and guarantee restoration.

**Step 7 --- Container/Helm:** Dockerfile and `.dockerignore`; minimal
non-root image; pin digest; add Deployment, ClusterIP Service, Secret
refs, resources, probes, security context, and tested NetworkPolicy
where supported. Lint/render local and prod, inspect manifests, deploy
to confirmed context, verify running image digest and store health.

**Step 8 --- Acceptance:** run all five through MCP protocol; test
invalid inputs/upstream failures; prove private exposure; scan
logs/artifacts for secrets/PII; recheck seeded SKUs and Order #14; prove
cleanup; capture real statuses/counts/commit hashes.

**Step 9 --- Handoff:** update architecture, tool contract, auth
decision, runbooks, execution log, completion report, README, image
lock, traceability. Commit meaningful changes. Do not claim complete or
authorize Phase 4 while blockers remain.

### Required final report

Return: 1. Summary and remaining work. 2. G0--G8 gate table with
evidence references. 3. Changed files and purpose. 4. Final transport,
internal URL, auth method, request flow, and network boundary. 5.
Per-tool live valid/invalid test results and safe upstream status
evidence. 6. Security results: auth failures, secret redaction, PII,
non-root, public exposure, NetworkPolicy enforcement. 7. Before/after
protected data state for seeded SKUs and Order #14. 8. Deployment
evidence: Helm release/revision, image tag/digest, pod readiness,
Service type, probes/resources. 9. Commands, exit codes, test counts;
clearly separate mocked from live tests. 10. Disposable object IDs/SKUs
and cleanup proof. 11. Commit hashes/messages. 12. Known limitations and
unverified claims. 13. GO/NO-GO for Phase 4 with explicit reasons.

If a command was not run, label it `NOT RUN`; partial results are
`PARTIAL`; unresolved blockers are `BLOCKED`. Never invent results.

# 18. Worker gate-report template

``` markdown
## Gate <ID> — <Name>
**Status:** PASS | FAIL | BLOCKED | PARTIAL | NOT RUN

### Work completed
- ...

### Files changed
- `path/to/file` — reason

### Commands
| Command | Exit code | Result |
|---|---:|---|
| `...` | 0 | ... |

### Evidence
- Sanitized report/log/manifest:
- Live or mocked:
- Commit:

### Safety/data checks
- Seeded products preserved: YES/NO/NOT VERIFIED
- Order #14 preserved: YES/NO/NOT VERIFIED
- Secret/PII scan: PASS/FAIL/NOT RUN
- Cleanup: PASS/FAIL/NOT APPLICABLE

### Open issues/decisions
- ...

### Next gate recommendation
- GO / STOP / NEEDS APPROVAL
- Reason:
```

Do not accept "it works" as evidence. Require the command, test, status,
or observable result.

# 19. Technical-head final review

## Scope and correctness

-   [ ] Exactly five tools; no generic proxy or debug tool.
-   [ ] Handlers call live WooCommerce endpoints.
-   [ ] No mock/fixture runtime path in deployed image.
-   [ ] SDK/transport match verified Phase 1 contract.
-   [ ] Explicit input/output/error contracts.
-   [ ] Mutation semantics/status allow-list approved.

## Security

-   [ ] Auth decision based on live internal tests.
-   [ ] No false claim that `HTTPS=on` encrypts traffic.
-   [ ] No unapproved Basic credentials over unencrypted HTTP.
-   [ ] No public MCP endpoint.
-   [ ] Correct Secret references and no leakage.
-   [ ] PII excluded from output/logs.
-   [ ] Non-root/least privilege.
-   [ ] NetworkPolicy claims match actual CNI enforcement.
-   [ ] No direct DB, kubeconfig, Docker socket, or unnecessary
    Kubernetes permissions.

## Operations and evidence

-   [ ] Clean-clone build works.
-   [ ] Helm local/prod lint/render pass.
-   [ ] Deployed image digest matches tested build.
-   [ ] Probes/resources/security context present.
-   [ ] Shutdown/restart tested.
-   [ ] Rollback preserves store/PVCs.
-   [ ] All five tools tested through MCP protocol.
-   [ ] Live success and failure paths tested.
-   [ ] Mutations confirmed by read-after-write.
-   [ ] Cleanup complete.
-   [ ] Seeded SKUs and Order #14 preserved.
-   [ ] Traceability links requirements to code/tests/evidence.
-   [ ] Completion report distinguishes facts from assumptions.

## Phase decision

-   [ ] All hard blockers pass.
-   [ ] No unresolved critical/high issue without explicit acceptance.
-   [ ] Product Manager has evidence to accept/reject.
-   [ ] Phase 4 has not started.

# Appendix A --- Operational commands

``` bash
# Repository
git status --short
npm ci
npm run build
npm test

# Helm
helm lint infra/helm/urumi-platform
helm template phase3-local infra/helm/urumi-platform \
  -f infra/helm/urumi-platform/values-local.yaml
helm template phase3-prod infra/helm/urumi-platform \
  -f infra/helm/urumi-platform/values-prod.yaml

# Cluster and store health; do not print Secret data
kubectl --context k3d-urumi -n urumi get pods,deploy,statefulset,svc,ingress,pvc
kubectl --context k3d-urumi -n urumi get secret urumi-woocommerce-api

# MCP deployment
kubectl --context k3d-urumi -n urumi rollout status deployment/urumi-woocommerce-mcp
kubectl --context k3d-urumi -n urumi get deployment,service,pod -l app.kubernetes.io/name=woocommerce-mcp
kubectl --context k3d-urumi -n urumi logs deployment/urumi-woocommerce-mcp --since=10m

# Inspect service exposure
kubectl --context k3d-urumi -n urumi get svc,ingress
```

Review all output for credentials, headers, PII, order keys, and
sensitive environment details before sharing.

# Appendix B --- Evidence bundle

-   [ ] Sanitized repository/cluster baseline.
-   [ ] Authentication decision and test outputs.
-   [ ] Build/lint/type-check/unit-test output.
-   [ ] MCP initialize and tools/list evidence.
-   [ ] Per-tool live integration results.
-   [ ] Invalid-input and upstream failure results.
-   [ ] Mutation read-after-write and cleanup proof.
-   [ ] Helm lint/render and manifest review.
-   [ ] Pod/service/probe/resource evidence.
-   [ ] Public exposure and network-policy tests.
-   [ ] Secret/PII redaction results.
-   [ ] Image digest record.
-   [ ] Phase 2 data-preservation evidence.
-   [ ] Requirements traceability matrix.
-   [ ] Commit list.
-   [ ] Completion report and GO/NO-GO decision.

**End of Phase 3 Master Technical Roadmap & Execution Checklist.**
