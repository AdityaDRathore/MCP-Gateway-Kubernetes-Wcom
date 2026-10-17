# Urumi Phase 4 — Gate G5 Implementation Plan (Revised)
## Upstream Aggregation Manager and Dynamic Tool Catalog

**Gate:** G5  
**Technical Head Authorization:** Conditional approval granted — pending incorporation of 6 technical conditions.  
**Target Applications:** `apps/gateway` (with verified integrations against `apps/woocommerce-mcp`, `apps/mcp-crm`, and `apps/mcp-tasks`)

---

## 1. Executive Summary & Objective

The objective of **Gate G5** is to implement the **Upstream Aggregation Manager** and **Dynamic Tool Catalog** in `apps/gateway`. The gateway connects to the three existing internal MCP upstream services, dynamically discovers their tools via protocol-level `tools/list`, validates and namespaces them under `{server_slug}__{original_tool_name}`, and exposes the unified, atomically snapshotted catalog through the downstream MCP endpoint (`POST /mcp`).

### Scope Boundaries
- **Delivered in G5**:
  - Additive database migration `002_upstreams_registry` creating the `upstreams` table without altering G4 migration history.
  - Idempotent default upstream seeding (`woocommerce`, `crm`, `tasks`) without overwriting operator configuration.
  - Fail-closed WHATWG URL and SSRF defense engine (ADR-017) with production protection against bypasses and test overrides.
  - Managed upstream client lifecycle using pinned `@modelcontextprotocol/sdk@1.32.1` and Streamable HTTP.
  - Unified single-flight connection establishment and protocol tool discovery.
  - Strict separation of persisted administrative lifecycle state vs in-memory operational health.
  - Strict tool metadata validation: bounded schema size (32 KiB UTF-8), bounded description (2,048 chars), per-upstream tool limit (50), global catalog tool limit (200), total serialized catalog limit (512 KiB UTF-8), and absolute prohibition of remote `$ref` URIs.
  - Deterministic namespacing `{server_slug}__{original_tool_name}` and alphanumeric ordering.
  - Atomic catalog snapshot replacement with reference stability and failed-refresh snapshot preservation.
  - Downstream MCP integration on `POST /mcp` returning aggregated `tools/list` and explicit, truthful G5 `isError: true` tool invocation boundary responses conforming to official MCP SDK schemas.
- **Strictly Excluded (Later Gates)**:
  - Tool invocation routing, circuit breakers, deadlines, cancellation forwarding, concurrency pools (Gate G6).
  - Dynamic admin REST API `/admin/v1/*` or Kubernetes Secret lifecycle management (Gate G7).
  - Docker, Helm, PVC, NetworkPolicy, or Kubernetes deployment changes (Gate G8).
  - Live store mutations or modifying protected products 10/11/12 or Order #14 (Gate G9).

---

## 2. Technical Head Acceptance Conditions Resolution

### Condition 1: Make Upstream URL Validation Fail Closed

The canonical URL validator (`validateAndNormalizeUpstreamUrl`) implements multi-layered, fail-closed enforcement:

1. **Physical Production Lock on Test Overrides**:
   ```typescript
   if (options?.allowLocalhostForTesting) {
     if (process.env.NODE_ENV === 'production') {
       throw new SecurityError(
         'SSRF Violation: allowLocalhostForTesting is strictly forbidden in production mode'
       );
     }
   }
   ```
   The test override is physically disabled in production environments. Even if an attacker or misconfigured secret injects `allowLocalhostForTesting: true`, it immediately throws a fatal `SecurityError`.

2. **Exhaustive Bypass Rejections**:
   - **URL Encoded Characters**: Decodes and inspects paths and hostnames for `%2f`, `%2e%2e`, `%00` (null-byte injection), throwing on encoded delimiters.
   - **Dot Segments & Path Traversal**: Rejects paths containing `/../`, `/./`, or trailing slashes. Path must be strictly `=== '/mcp'`.
   - **Trailing Dots & Case Variations**: Strips and normalizes hostnames to lowercase; rejects trailing dots (`urumi-woocommerce-mcp.`).
   - **Direct IP Literals in All Formats**:
     - Standard IPv4 dotted decimal (`127.0.0.1`, `10.42.0.1`)
     - Octal IPv4 (`0177.0.0.1`)
     - Hexadecimal IPv4 (`0x7f000001`)
     - Integer IPv4 (`2130706433`)
     - IPv6 literals (`[::1]`, `[fe80::1]`)
     - IPv4-mapped IPv6 (`[::ffff:127.0.0.1]`)
     - Cloud metadata IPs (`169.254.169.254`, `metadata.google.internal`)
   - **Embedded Credentials**: Rejects any userinfo (`http://user:pass@host/mcp`).
   - **Query & Fragment**: Throws if `parsed.search !== ''` or `parsed.hash !== ''`.
   - **Port Enforcement**: In production, port must be strictly integer `3000`. Any other port (including 80, 8080, 3306) is rejected with `InvalidPortError`.
   - **Exact Approved Hostnames**: In production, hostname must strictly match one of:
     - `urumi-woocommerce-mcp` or `urumi-woocommerce-mcp.urumi.svc.cluster.local`
     - `urumi-mcp-crm` or `urumi-mcp-crm.urumi.svc.cluster.local`
     - `urumi-mcp-tasks` or `urumi-mcp-tasks.urumi.svc.cluster.local`
   - **Canonical Normalized Output**: Returns the canonical internal FQDN:
     `http://${serviceName}.urumi.svc.cluster.local:3000/mcp`.

---

### Condition 2: Strict Separation of Persisted Status vs In-Memory Runtime Health

To respect SQLite schema constraints and maintain high-performance, non-blocking reads:

1. **Database Persisted Lifecycle State (`upstreams.status`)**:
   - Defined in SQLite Migration 002:
     ```sql
     status TEXT NOT NULL CHECK(status IN ('provisioning', 'active', 'disabled', 'deleting', 'cleanup_required', 'failed'))
     ```
   - Plus `is_enabled INTEGER NOT NULL DEFAULT 1 CHECK(is_enabled IN (0, 1))`.
   - Represents **administrative configuration and persistent provisioning state**.
   - Managed strictly by administrator actions, migrations, and the G7 secret saga orchestrator.

2. **In-Memory Operational Health State (`UpstreamHealthState`)**:
   - Defined in application runtime (`apps/gateway/src/upstream/types.ts`):
     ```typescript
     export type UpstreamHealthState = 'connecting' | 'available' | 'unavailable' | 'disabled';
     ```
   - Maintained transiently in memory inside `ManagedUpstreamClient` and published in `CatalogSnapshot.upstreamStatuses`.
   - **CRITICAL INVARIANT**: **The gateway NEVER writes transient runtime health states (`connecting`, `available`, `unavailable`) into the SQLite `upstreams.status` column.**
     - Writing transient health checks to SQLite on every ping or network hiccup would incur unnecessary disk I/O, risk SQLite lock contention, and directly violate the SQLite CHECK constraint which forbids `'connecting'`, `'available'`, and `'unavailable'`.

3. **Reconciliation Mapping**:
   | Persisted DB State (`upstreams`) | `is_enabled` | Real-time Connectivity | In-Memory Health State | Catalog Treatment |
   |---|:---:|---|---|---|
   | `'disabled'` | `0` | Any | `'disabled'` | **Excluded completely** from downstream `tools/list` |
   | `'active'` | `1` | Handshake or `listTools()` in-flight | `'connecting'` | Tools pending; prior valid tools retained |
   | `'active'` | `1` | Handshake OK & `listTools()` valid | `'available'` | Tools included in catalog snapshot with `reachable: true` |
   | `'active'` | `1` | Connection refused / timeout / error | `'unavailable'` | Tools retained with `_meta: { reachable: false, error: string }` |
   | `'failed'` / `'cleanup_required'` | `0` | Any | `'disabled'` | Excluded completely from catalog |

---

### Condition 3: Unified Single-Flight Connection, Discovery, and Refresh

A client must **never** be advertised as `available` until protocol-level `tools/list` discovery actually succeeds and passes schema validation:

```mermaid
sequenceDiagram
    autonumber
    actor Caller1 as Downstream Request / Timer
    actor Caller2 as Concurrent Refresh Request
    participant MGR as UpstreamManager
    participant CLI as ManagedUpstreamClient
    participant TRAN as StreamableHTTPClientTransport
    participant UP as Upstream MCP Server Pod

    Caller1->>MGR: refreshAll() / discoverTools()
    MGR->>CLI: discoverTools()
    Note over CLI: Checks refreshPromise (None active)
    CLI->>CLI: Create unified single-flight refreshPromise
    CLI->>CLI: healthState = 'connecting'
    
    Caller2->>MGR: refreshAll()
    MGR->>CLI: discoverTools()
    Note over CLI: Reuses in-flight refreshPromise!

    CLI->>TRAN: Connect StreamableHTTPClientTransport
    TRAN->>UP: POST /mcp (Initialize handshake)
    UP-->>TRAN: Handshake OK (Protocol 2024-11-05)

    CLI->>UP: client.listTools()
    alt listTools() Fails (Timeout / ECONNREFUSED / HTTP 500)
        UP-->>CLI: Error / Disconnect
        CLI->>CLI: healthState = 'unavailable'
        CLI->>CLI: Classify & redact error
        CLI->>TRAN: Clean transport teardown (close sockets/listeners)
        CLI-->>Caller1: Rejects with classified error
        CLI-->>Caller2: Rejects with identical classified error
    else listTools() Succeeds & Validates Metadata
        UP-->>CLI: { tools: [...] }
        CLI->>CLI: Validate metadata & schema bounds
        CLI->>CLI: healthState = 'available'
        CLI-->>Caller1: Returns validated DiscoveredToolsResult
        CLI-->>Caller2: Returns validated DiscoveredToolsResult
    end
    Note over CLI: refreshPromise cleared to null in finally block
```

#### Key Implementation Invariants:
1. **Single-Flight Deduplication**: Both connection establishment and tool discovery share a single pending `refreshPromise: Promise<DiscoveredToolsResult> | null`.
2. **Atomic Availability**: `healthState` transitions to `'available'` **only after** `client.listTools()` returns and passes metadata validation.
3. **Deterministic Teardown on Failure**:
   - If connection or discovery fails, the transport and client are cleanly closed immediately via `await this.close()`.
   - Sockets, timers, and abort listeners are destroyed to prevent resource leaks.
   - The original classified error (redacted, sanitized) is recorded in memory as `lastError` and propagated to callers.

---

### Condition 4: Strengthened Catalog Bounds & Snapshot Semantics

To protect the gateway against rogue upstreams, malformed schemas, and memory exhaustion, the following strict bounds are enforced:

#### 1. Exact Dimensional Bounds:
- **Maximum Tools per Upstream**: **50 tools**. If an upstream returns $>50$ tools, the discovery for that upstream is rejected with `UpstreamToolLimitExceededError`.
- **Maximum Total Catalog Tools**: **200 tools** across all aggregated upstreams.
- **Maximum Per-Tool Schema Size**: **32 KiB (32,768 UTF-8 bytes)**.
  - **Exact Fields Counted**: Measured as `Buffer.byteLength(JSON.stringify({ inputSchema: tool.inputSchema, outputSchema: tool.outputSchema }), 'utf8')`.
- **Maximum Per-Tool Description**: **2,048 characters**.
- **Maximum Total Serialized Catalog Size**: **512 KiB (524,288 UTF-8 bytes)**. Measured across the full serialized catalog tool array.

#### 2. Absolute Prohibition of Remote `$ref` URIs:
- Schema validator traverses input and output schemas recursively:
  - If any key is `$ref` and its value is a string containing `http://`, `https://`, `ftp://`, or `//`, the tool is immediately rejected with `ProhibitedRemoteRefError`.
  - Zero network requests are made to fetch remote schema definitions.

#### 3. Pre-Publication Validation & Atomic Pointer Swap:
- The catalog compiler validates 100% of discovered tools before generating the candidate snapshot.
- If any tool fails validation, the error is handled according to failure policy:
  - If an upstream returns invalid tools, that upstream is treated as invalid and marked `'unavailable'`.
  - Healthy upstreams are preserved.
- **Snapshot Swap**: The gateway holds an immutable `CatalogSnapshot` pointer. When a new snapshot is built, the pointer is swapped in a single synchronous operation (`this.currentSnapshot = Object.freeze(newSnapshot)`). Downstream readers reading `getSnapshot()` receive an immutable, fully compiled object with $O(1)$ read complexity.

#### 4. Failed Refresh Preservation:
- If a catalog refresh fails completely (e.g. all upstreams fail, or an internal error occurs during snapshot compilation), the gateway **strictly preserves the last valid snapshot**.
- Downstream clients continue to see the previously known catalog rather than an empty or corrupted state.

#### 5. Reachability Metadata Sanitization:
- For tools from an upstream that is currently unreachable, the tool entry includes:
  ```json
  "_meta": {
    "reachable": false,
    "error": "Upstream service 'crm' is currently unreachable"
  }
  ```
- **Redaction Invariant**: The `error` string is strictly sanitized through `classifyError` and the logger's regex redaction filter. It must NEVER contain internal IP addresses (`10.42.x.x`), internal port numbers, file paths, credentials, tokens, or raw Node.js runtime stack dumps.

---

### Condition 5: Explicit and Testable G5 Tool Call Boundary

Downstream `POST /mcp` in Gate G5 must strictly handle both `tools/list` and `tools/call` in full compliance with the official MCP SDK specification (`@modelcontextprotocol/sdk@1.32.1`):

#### 1. Downstream `tools/list` Contract:
- Returns all namespaced tools from active upstreams formatted as `{server_slug}__{original_tool_name}`.
- Tools from disabled upstreams are omitted.
- Tools from unreachable upstreams include `_meta: { reachable: false, error: string }`.

#### 2. Downstream `tools/call` Contract (G5 Boundary):
- Gate G5 does not implement tool routing (strictly reserved for Gate G6).
- If a client issues `tools/call` for an unknown tool:
  - Throws standard MCP JSON-RPC error: `ErrorCode.InvalidParams` (`"Tool <name> not found"`).
- If a client issues `tools/call` for an unreachable tool (`_meta.reachable === false`):
  - Returns official `CallToolResult` with `isError: true`:
    ```json
    {
      "content": [
        {
          "type": "text",
          "text": "Upstream service 'crm' is currently unreachable. The tool could not be executed."
        }
      ],
      "isError": true
    }
    ```
- If a client issues `tools/call` for an available tool in G5:
  - Returns official `CallToolResult` with `isError: true` stating truthful gate boundaries:
    ```json
    {
      "content": [
        {
          "type": "text",
          "text": "Tool execution is not implemented in Gate G5. Gateway router and tool dispatch will be activated in Gate G6."
        }
      ],
      "isError": true
    }
    ```
- **Truthful MCP Invariant**: The gateway **never** reports `{ isError: false }` for an unrouted tool in Gate G5.

---

### Condition 6: Correct and Reconciled Verification Criteria

#### 1. Verified Repository Baseline:
- In Gate G3, the suite totaled **176 tests** (34 gateway, 26 crm, 35 tasks, 81 woocommerce).
- In Gate G4, with the addition of SQLite persistence, API keys, bootstrap, and audit logging suites, the active repository baseline totals **211 passed tests**:
  - `apps/gateway`: **69 tests** (66 unit, 3 protocol)
  - `apps/mcp-crm`: **26 tests** (20 unit, 6 protocol)
  - `apps/mcp-tasks`: **35 tests** (27 unit, 8 protocol)
  - `apps/woocommerce-mcp`: **81 tests** (46 unit, 35 protocol)
- The Gate G5 implementation will add new unit and protocol tests in `apps/gateway` without breaking any of the existing 211 tests.

#### 2. Verification Reporting Protocol:
Rather than relying on assumed fixed numbers, the G5 deliverables and execution log will capture:
- The exact git commit SHA before and after G5 implementation.
- Verbatim runner summary blocks from `npm test` showing per-workspace suites and tests passed, with 0 failures, 0 skipped, and 0 errors.
- Monorepo build results (`npm run build`) demonstrating 0 TypeScript compilation errors.
- Monorepo linter results (`npm run lint`) demonstrating 0 lint errors.
- Step-by-step verification commands and actual exit codes.

---

## 3. Detailed Component Architecture

### 3.1 Upstream Registry SQLite Migration (`migration002`)

In `apps/gateway/src/db/schema.ts`, introduce additive migration `migration002`:

```typescript
export const migration002: Migration = {
  version: 2,
  name: '002_upstreams_registry',
  sql: `
    CREATE TABLE IF NOT EXISTS upstreams (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      endpoint_url TEXT NOT NULL,
      timeout_ms INTEGER NOT NULL DEFAULT 10000 CHECK(timeout_ms BETWEEN 500 AND 30000),
      is_enabled INTEGER NOT NULL DEFAULT 1 CHECK(is_enabled IN (0, 1)),
      status TEXT NOT NULL CHECK(status IN ('provisioning', 'active', 'disabled', 'deleting', 'cleanup_required', 'failed')),
      secret_ref_name TEXT,
      secret_ref_key TEXT,
      cleanup_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_upstreams_slug ON upstreams(slug);
  `,
};

export const MIGRATIONS: Migration[] = [
  migration001,
  migration002,
];
```

#### Idempotent Default Upstreams Seeding (`src/db/upstream-repo.ts`):
```typescript
export interface DefaultUpstreamDefinition {
  slug: string;
  displayName: string;
  endpointUrl: string;
  timeoutMs: number;
}

export const DEFAULT_UPSTREAMS: DefaultUpstreamDefinition[] = [
  {
    slug: 'woocommerce',
    displayName: 'WooCommerce MCP',
    endpointUrl: 'http://urumi-woocommerce-mcp.urumi.svc.cluster.local:3000/mcp',
    timeoutMs: 10000,
  },
  {
    slug: 'crm',
    displayName: 'CRM Mock MCP',
    endpointUrl: 'http://urumi-mcp-crm.urumi.svc.cluster.local:3000/mcp',
    timeoutMs: 10000,
  },
  {
    slug: 'tasks',
    displayName: 'Tasks Mock MCP',
    endpointUrl: 'http://urumi-mcp-tasks.urumi.svc.cluster.local:3000/mcp',
    timeoutMs: 10000,
  },
];
```
- On gateway initialization, `UpstreamRepository.seedDefaults()` queries SQLite by `slug`.
- Missing rows are inserted with `status = 'active'`, `is_enabled = 1`.
- Existing rows are left untouched, ensuring operator changes to `timeout_ms` or `is_enabled` persist across pod restarts.

---

### 3.2 Canonical URL & SSRF Validator (`src/upstream/url-validator.ts`)

```typescript
export interface UrlValidatorOptions {
  allowLocalhostForTesting?: boolean;
}

export interface ValidatedUpstreamEndpoint {
  originalInput: string;
  normalizedFqdnUrl: string;
  serviceName: string;
  port: number;
  pathname: string;
}

const APPROVED_SERVICES = new Set([
  'urumi-woocommerce-mcp',
  'urumi-mcp-crm',
  'urumi-mcp-tasks',
]);

const PROHIBITED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '169.254.169.254',
  'metadata.google.internal',
  'kubernetes',
  'kubernetes.default',
  'kubernetes.default.svc',
  'kubernetes.default.svc.cluster.local',
  'urumi-mariadb',
  'urumi-mariadb.urumi.svc.cluster.local',
  'urumi-wordpress',
  'urumi-wordpress.urumi.svc.cluster.local',
  'urumi-gateway',
  'urumi-gateway.urumi.svc.cluster.local',
]);
```
- Multi-step validation throwing `SSRFValidationError` or `SecurityError`.
- Rejects non-HTTP, credentials, query parameters, URL fragments, path traversal, port !== 3000 (in prod), direct IP literals (decimal, octal, hex, IPv6, mapped), and unapproved hostnames.
- Enforces strict production lock preventing `allowLocalhostForTesting` when `NODE_ENV === 'production'`.

---

### 3.3 Managed Upstream Client (`src/upstream/upstream-client.ts`)

- Wraps official `@modelcontextprotocol/sdk@1.32.1` `Client` and `StreamableHTTPClientTransport`.
- Maintains in-memory `healthState: UpstreamHealthState` (`'connecting' | 'available' | 'unavailable' | 'disabled'`).
- Single-flight `discoverTools(): Promise<DiscoveredToolsResult>` combining connection handshake and `client.listTools()`.
- Sets `healthState = 'available'` only upon successful list and validation.
- Clean resource teardown: `close()` closes transport, client, and resets state.
- Sanitizes errors via deep redaction.

---

### 3.4 Tool Validator & Catalog Bounds (`src/upstream/tool-validator.ts`)

- Validates slugs (`^[a-z0-9-]{2,32}$`).
- Validates tool names (`^[a-zA-Z0-9_-]{1,64}$`).
- Formats namespaced public name: `${slug}__${originalName}`.
- Rejects duplicate public names.
- Enforces bounds:
  - Schema size <= 32 KiB (measured via `Buffer.byteLength(JSON.stringify({ inputSchema, outputSchema }), 'utf8')`).
  - Description length <= 2,048 characters.
  - Per-upstream tools <= 50.
  - Global catalog tools <= 200.
  - Total serialized catalog <= 512 KiB UTF-8.
- Recursive check disallowing remote `$ref` (`http://`, `https://`).
- Recursive sanitization disallowing credentials/PII.

---

### 3.5 Catalog Service (`src/upstream/catalog-service.ts`)

- Manages active immutable `CatalogSnapshot`.
- Returns snapshot in $O(1)$ read time via `getSnapshot()`.
- Compiles candidate snapshot from discovered tools across upstreams.
- Sorts tools deterministically by `server_slug` ascending, then `original_tool_name` ascending.
- Evaluates snapshot equality: if tool list is unchanged from prior snapshot, preserves prior snapshot reference.
- Preserves prior valid snapshot if refresh encounters a fatal failure.
- Tags unreachable tools with sanitized `_meta: { reachable: false, error: string }`.
- Omits disabled tools completely.

---

### 3.6 Upstream Manager (`src/upstream/upstream-manager.ts`)

- Coordinates `UpstreamRepository`, `ManagedUpstreamClient` instances, and `CatalogService`.
- Starts upstreams defined in SQLite.
- Executes `refreshAll()` concurrently with partial failure isolation:
  - If WooCommerce or CRM is down, Tasks is still discovered.
  - Snapshot is compiled with healthy upstreams and clear unreachable indicators for failing upstreams.
- Graceful shutdown integration: cleanly closes all upstream clients on gateway termination.

---

### 3.7 Downstream Gateway MCP Integration (`src/server.ts`)

- Ephemeral `createGatewayMcpServer(catalogService?: CatalogService)` per request.
- Registers tools capability with `listChanged: true`.
- Mounts request handler for `ListToolsRequestSchema` reading directly from `catalogService.getSnapshot()`.
- Mounts request handler for `CallToolRequestSchema` enforcing G5 boundary:
  - Unreachable tool -> returns `isError: true` with fast-fail message.
  - Available tool -> returns `isError: true` with explicit G5 deferred execution message.
  - Unknown tool -> throws `ErrorCode.InvalidParams`.

---

## 4. File Modification Matrix

```
apps/gateway/
├── src/
│   ├── db/
│   │   ├── schema.ts                    # [MODIFY] Add additive migration002 and MIGRATIONS update
│   │   └── upstream-repo.ts             # [NEW] SQLite CRUD repository & idempotent default seeding
│   ├── upstream/
│   │   ├── types.ts                     # [NEW] Enums, health states, tool & catalog interfaces, error classes
│   │   ├── url-validator.ts             # [NEW] Fail-closed WHATWG URL & SSRF defense engine (ADR-017)
│   │   ├── tool-validator.ts            # [NEW] Strict metadata, schema bounds, UTF-8 byte caps, $ref rejection
│   │   ├── upstream-client.ts           # [NEW] ManagedClient with single-flight discovery and clean teardown
│   │   ├── catalog-service.ts           # [NEW] In-memory atomic snapshot catalog service
│   │   └── upstream-manager.ts          # [NEW] Aggregator coordinating clients, DB repository, and catalog
│   ├── server.ts                        # [MODIFY] Wire catalog into downstream MCP server and G5 tool boundaries
│   └── index.ts                         # [MODIFY] Initialize upstream manager, seed defaults & lifecycle hooks
├── test/
│   ├── unit/
│   │   ├── db-migrations.test.ts        # [MODIFY] Verify migration 001 alone excludes upstreams; 002 creates upstreams
│   │   ├── ssrf-url-validator.test.ts   # [NEW] SSRF bypass variants, IP notation, and production lock tests
│   │   ├── tool-validator.test.ts       # [NEW] Validation, namespacing, bounds, UTF-8 byte size, $ref rejection
│   │   ├── upstream-client.test.ts      # [NEW] Client lifecycle, single-flight discovery, and error classification
│   │   ├── catalog-service.test.ts      # [NEW] Catalog compilation, atomic snapshot swap, sorting, and bounds
│   │   └── upstream-repo.test.ts        # [NEW] SQLite CRUD, constraints, and idempotent seeding tests
│   └── protocol/
│       ├── upstream-discovery.test.ts   # [NEW] Live Streamable HTTP tool discovery against mock upstreams
│       └── gateway-catalog.test.ts      # [NEW] Downstream MCP tools/list integration & G5 call boundaries
```

---

## 5. Verification Strategy & Acceptance Criteria

### 5.1 Verification Commands
All tests run with Node 24 LTS (`/home/rathore/.nvm/versions/node/v24.20.0/bin` on PATH):

```bash
# 1. Gateway Unit Tests (all existing G3/G4 suites + new G5 suites)
PATH="/home/rathore/.nvm/versions/node/v24.20.0/bin:$PATH" npm --workspace=gateway run test:unit

# 2. Gateway Protocol Tests (handshake, cancellation, live discovery, catalog integration)
PATH="/home/rathore/.nvm/versions/node/v24.20.0/bin:$PATH" npm --workspace=gateway run test:protocol

# 3. Monorepo-Wide Regression Suite (gateway, crm, tasks, woocommerce)
PATH="/home/rathore/.nvm/versions/node/v24.20.0/bin:$PATH" npm test

# 4. Monorepo TypeScript Compilation
PATH="/home/rathore/.nvm/versions/node/v24.20.0/bin:$PATH" npm run build

# 5. Monorepo Linter
PATH="/home/rathore/.nvm/versions/node/v24.20.0/bin:$PATH" npm run lint
```

### 5.2 Acceptance Criteria Checkpoints
Gate G5 will be submitted for Technical Head review only when:
1. Migration 002 applies cleanly and additively without altering migration 001 history.
2. The three internal upstreams (`woocommerce`, `crm`, `tasks`) are successfully discovered over Streamable HTTP and aggregated.
3. Downstream `tools/list` publishes all 10 tools with exact `{server_slug}__{original_tool_name}` namespacing and deterministic alphabetical ordering.
4. Fail-closed SSRF validator blocks all bypass attempts, with test overrides physically barred in production.
5. Persisted configuration status is strictly decoupled from transient in-memory health state.
6. Unified single-flight connection and discovery prevents socket duplication and ensures an upstream is available only after successful tool listing.
7. Catalog bounds (50 tools/upstream, 200 total, 32 KiB UTF-8 schema, 512 KiB total, no remote `$ref`) are rigorously enforced.
8. Downstream `tools/call` for unrouted tools returns truthful `isError: true` responses conforming to official MCP SDK schemas.
9. All monorepo workspaces pass tests with 100% success rate, 0 build errors, and 0 lint warnings.
10. Live WooCommerce store records (products 10, 11, 12, Order #14) and Kubernetes deployment resources remain completely untouched.

---

## 6. Execution Authorization

With all six conditions incorporated into this revised technical plan, Gate G5 is ready for implementation upon your final confirmation.
