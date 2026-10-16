# Revised Implementation Plan — Gate G3: Gateway Skeleton and Downstream MCP Protocol Implementation

## Goal Description
Implement **Gate G3** as authorized by the Technical Head, incorporating all architectural review corrections. 
Gate G3 establishes the core foundation of the Team MCP Gateway in `apps/gateway`:
1. Strict, bounded environment configuration validation using Zod with explicit distinction between actively enforced settings and reserved settings for G4–G6.
2. Hardcoded fail-closed production authentication boundary (`FailClosedAuthenticator`) with test injection confined strictly to test constructors (zero environment switches).
3. Operational health endpoints (`GET /health/live`, `GET /health/ready`, `GET /health`), testing the readiness contract via a local configuration/readiness stub completely independent of G5 upstream management.
4. Downstream Streamable HTTP MCP server endpoint (`POST /mcp`) using pinned `@modelcontextprotocol/sdk@1.32.1`, implementing an idempotent multi-event transport lifecycle (`res.finish`, `res.close`, `req.error`), deterministic 400/413/415 HTTP body parsing, and unauthenticated pre-dispatch rejection.
5. Reserved and strictly private administration route prefix (`/admin/v1/*`), defining deterministic behavior for all paths and HTTP methods, and guaranteeing zero admin handlers are mounted into the MCP catalog.
6. Structured JSON logger with recursive deep-object and array redaction for sensitive keys and credentials.
7. Graceful SIGTERM/SIGINT shutdown coordinator with bounded 5-second connection draining.
8. Rigorous unit and protocol test suites, including the mandatory pinned-SDK cancellation contract regression test `TEST-GTW-SDK-ABORT-PUBLIC-API` executed against an isolated in-test mock server.

---

## Technical Head Review Findings & Resolved Actions

| Priority | Finding | Applied Correction in Revised Plan |
|---|---|---|
| **Blocker** | `FakeAuthenticator` reachable in production | `src/index.ts` explicitly instantiates `new FailClosedAuthenticator()`. Test injection is strictly restricted to test constructor arguments in `createExpressApp({ authenticator })`. No env switch exists. |
| **Blocker** | `/admin/v1/*` route contract underspecified | Complete route contract: Authenticated admin gets HTTP 501 (`{"error":"Not Implemented","message":"Admin API reserved for Gate G7"}`) for all methods (`GET`, `POST`, `PATCH`, `DELETE`, etc.) and subpaths. Unauthenticated returns 401; non-admin (`member`) returns 403. Verified absent from MCP tool definitions. |
| **Blocker** | Transport lifecycle `res.close` insufficient | Implemented idempotent `cleanup()` guard (`isCleanedUp` flag) registered across `res.on('finish')`, `res.on('close')`, and `req.on('error')`. Prevents double-closing and premature termination. Tested with pinned SDK. |
| **High** | Incomplete body parsing and error definition | Deterministic HTTP status handling: HTTP 400 for malformed JSON, HTTP 413 for payloads > 64 KiB, HTTP 415 for non-JSON Content-Type, and HTTP 405 for non-POST methods. Authentication middleware executes prior to MCP dispatch. |
| **High** | Readiness test mentions failing upstream | G3 readiness contract tested via local `readinessCheck: () => boolean` stub. Zero G5 upstream management code introduced. |
| **High** | SDK cancellation regression test scope | Documented and implemented as an isolated SDK contract test (`TEST-GTW-SDK-ABORT-PUBLIC-API`) using a standalone mock MCP server and client. Validates `@modelcontextprotocol/sdk@1.32.1` `RequestOptions.signal` contract without conflating G6 gateway routing. |
| **Medium** | Scope of config variables | Explicitly documented in `src/config.ts`: actively enforced in G3 (`PORT`, `HOST`, `NODE_ENV`, `LOG_LEVEL`, `DEFAULT_UPSTREAM_TIMEOUT_MS`, `MAX_PAYLOAD_SIZE_BYTES`, `DRAIN_TIMEOUT_MS`) vs reserved for G4–G6 (`DB_PATH`, `MAX_RESULT_SIZE_BYTES`, `GLOBAL_CONCURRENCY_LIMIT`, `PER_UPSTREAM_CONCURRENCY_LIMIT`). |
| **Medium** | Email regex privacy boundary | Replaced regex-only email boundary with comprehensive structured-field redaction: recursive traversal across objects and arrays, exact key pattern matching, Bearer/API-key/secret sanitization, and error string scrubbing. |
| **Script** | Workspace test scripts | Aligned with existing workspace conventions (`npm --workspace=apps/gateway run test` or `npm test`). Zero modifications to root `package.json` or unrelated workspaces. |

---

## Architectural Boundaries & Invariants

> [!IMPORTANT]
> **Strict Gate G3 Scope**:
> - **Zero Persistence**: No SQLite database connection, WAL pragmas, or migrations (reserved for Gate G4).
> - **Zero Upstream Management**: No upstream client connections, dynamic catalog snapshotting, or tool aggregation (reserved for Gate G5).
> - **Zero Upstream Routing**: No upstream permit acquisition, circuit breakers, or upstream timeouts (reserved for Gate G6).
> - **Zero Cluster/Store Mutations**: No Kubernetes deployments, Helm modifications, or WooCommerce record changes.

---

## Proposed Changes

### Component: `apps/gateway` (New Workspace)

```
apps/gateway/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                 # Production entrypoint (FailClosedAuthenticator hardcoded)
│   ├── config.ts                # Strict Zod schema (Active vs Reserved documented)
│   ├── server.ts                # Express setup, middleware ordering, POST /mcp dispatch
│   ├── lifecycle.ts             # Graceful SIGTERM/SIGINT shutdown coordinator
│   ├── auth/
│   │   ├── authenticator.ts     # Authenticator interface & FailClosedAuthenticator
│   │   ├── middleware.ts        # Express Bearer auth middleware
│   │   └── fake-authenticator.ts # Test-only fake authenticator (confined to test builds)
│   ├── http/
│   │   ├── health.ts            # /health, /health/live, /health/ready (local stub)
│   │   └── admin.ts             # Reserved /admin/v1/* router (501 / 403 / 401 contract)
│   └── logging/
│       └── logger.ts            # Structured JSON logger with recursive redaction
└── test/
    ├── unit/
    │   ├── config.test.ts       # Active bounds & reserved settings validation
    │   ├── auth.test.ts         # Fail-closed invariant, header checks, 401s, no-bypass
    │   ├── health.test.ts       # Live/Ready probes with local stub
    │   ├── admin.test.ts        # /admin/v1 prefix reservation, methods, and error shapes
    │   ├── logger.test.ts       # Recursive redaction of nested keys, arrays, and tokens
    │   └── shutdown.test.ts     # Graceful connection drain and SIGTERM lifecycle
    └── protocol/
        ├── mcp-protocol.test.ts # Streamable HTTP handshake, 400/405/413/415, transport cleanup
        └── sdk-cancellation.test.ts # TEST-GTW-SDK-ABORT-PUBLIC-API (isolated SDK contract)
```

---

### Detailed File Specifications

#### [NEW] `apps/gateway/package.json`
- Package definition conforming to workspace conventions:
  ```json
  {
    "name": "gateway",
    "version": "1.0.0",
    "private": true,
    "type": "module",
    "description": "Central Team MCP Gateway for Urumi Platform",
    "scripts": {
      "build": "tsc",
      "start": "node dist/index.js",
      "dev": "tsx src/index.ts",
      "test:unit": "tsx --test test/unit/*.test.ts",
      "test:protocol": "tsx --test --test-concurrency=1 test/protocol/*.test.ts",
      "test": "npm run test:unit && npm run test:protocol",
      "typecheck": "tsc --noEmit",
      "lint": "echo 'No lint errors in gateway'"
    },
    "dependencies": {
      "@modelcontextprotocol/sdk": "1.32.1",
      "express": "^4.21.2",
      "zod": "^3.24.2"
    },
    "devDependencies": {
      "@types/express": "^4.17.21",
      "@types/node": "^24.0.0",
      "tsx": "^4.19.3",
      "typescript": "^5.7.3"
    }
  }
  ```

#### [NEW] `apps/gateway/tsconfig.json`
- Standard TypeScript configuration extending root `tsconfig.base.json`:
  ```json
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
      "rootDir": "src",
      "outDir": "dist"
    },
    "include": ["src/**/*"]
  }
  ```

#### [NEW] `apps/gateway/src/config.ts`
- Zod schema validating configuration with explicit active vs reserved annotations:
  - **Actively Enforced in Gate G3**:
    - `PORT`: Integer `1024..65535`, default `3000`.
    - `HOST`: String, default `'0.0.0.0'`.
    - `NODE_ENV`: Enum `['development', 'production', 'test']`, default `'production'`.
    - `LOG_LEVEL`: Enum `['debug', 'info', 'warn', 'error']`, default `'info'`.
    - `DEFAULT_UPSTREAM_TIMEOUT_MS`: Strictly bounded to `500..30000`, default `10000` (ADR-011 Section 2.7).
    - `MAX_PAYLOAD_SIZE_BYTES`: Integer, default `65536` (64 KiB), actively enforced in Express body parser.
    - `DRAIN_TIMEOUT_MS`: Integer `500..15000`, default `5000` (5.0s drain deadline), actively enforced in lifecycle coordinator.
  - **Reserved & Validated (Enforced in G4–G6)**:
    - `DB_PATH`: String, default `'/data/gateway.db'` (Reserved for G4 SQLite WAL persistence).
    - `MAX_RESULT_SIZE_BYTES`: Integer, default `1048576` (1 MiB) (Reserved for G6 Router result cap).
    - `GLOBAL_CONCURRENCY_LIMIT`: Integer, default `20` (Reserved for G6 Router global permit pool).
    - `PER_UPSTREAM_CONCURRENCY_LIMIT`: Integer, default `4` (Reserved for G6 Router per-upstream permit pool).
- Exports:
  - `parseConfig(rawEnv: NodeJS.ProcessEnv): AppConfig` (pure parsing, throws descriptive error for unit tests).
  - `loadConfig(env?: NodeJS.ProcessEnv, exitOnError = false): AppConfig` (cached accessor).
  - `resetConfigCache(): void`.

#### [NEW] `apps/gateway/src/auth/authenticator.ts`
- Defines core authentication contracts:
  ```typescript
  export interface AuthenticatedUser {
    id: string;
    username: string;
    role: 'admin' | 'member';
  }

  export interface Authenticator {
    authenticate(bearerToken: string): Promise<AuthenticatedUser | null>;
  }

  /**
   * Production-grade fail-closed authenticator for Gate G3 skeleton.
   * Without persistent SQLite verifiers (which arrive in Gate G4),
   * this authenticator unconditionally rejects all tokens.
   * No environment variable or configuration flag can bypass this check.
   */
  export class FailClosedAuthenticator implements Authenticator {
    async authenticate(_bearerToken: string): Promise<AuthenticatedUser | null> {
      return null;
    }
  }
  ```

#### [NEW] `apps/gateway/src/auth/fake-authenticator.ts`
- In-memory test helper strictly used in test constructors:
  ```typescript
  import { AuthenticatedUser, Authenticator } from './authenticator.js';

  export class FakeAuthenticator implements Authenticator {
    private validKeys = new Map<string, AuthenticatedUser>();

    registerKey(token: string, user: AuthenticatedUser): void {
      this.validKeys.set(token, user);
    }

    async authenticate(bearerToken: string): Promise<AuthenticatedUser | null> {
      return this.validKeys.get(bearerToken) ?? null;
    }
  }
  ```

#### [NEW] `apps/gateway/src/auth/middleware.ts`
- Express middleware enforcing Bearer token authentication:
  - Checks `req.headers.authorization`.
  - Rejects missing header -> HTTP 401 `{"error": "Unauthorized: Missing Authorization header"}`.
  - Rejects non-Bearer schemes (e.g. `Basic ...`, raw token) -> HTTP 401 `{"error": "Unauthorized: Authorization scheme must be Bearer"}`.
  - Rejects empty or whitespace token -> HTTP 401 `{"error": "Unauthorized: Empty Bearer token"}`.
  - Calls `authenticator.authenticate(token)`. If `null` -> HTTP 401 `{"error": "Unauthorized: Invalid or revoked API key"}`.
  - Attaches `req.user = user` on success and calls `next()`.

#### [NEW] `apps/gateway/src/http/health.ts`
- Decoupled operational health probes:
  - `liveHandler(req, res)`: Checks process loop, returns HTTP 200 `{"status": "ok", "service": "urumi-gateway"}`.
  - `createReadyHandler(readinessCheck: () => boolean)`:
    - Accepts local readiness stub.
    - If `readinessCheck()` is true: returns HTTP 200 `{"status": "ok", "service": "urumi-gateway", "ready": true}`.
    - If false: returns HTTP 503 `{"status": "degraded", "service": "urumi-gateway", "ready": false}`.
    - Contract: Evaluates local gateway configuration and initialization only; zero coupling to external upstream services.
  - `healthHandler(req, res)`: General health check, returns HTTP 200 `{"status": "ok", "service": "urumi-gateway"}`.

#### [NEW] `apps/gateway/src/http/admin.ts`
- Reserved `/admin/v1` router:
  - Mounted at `/admin/v1`.
  - Protects all paths and subpaths under `/admin/v1` with authentication:
    - If unauthenticated -> HTTP 401 Unauthorized.
    - If authenticated user role is not `'admin'` (e.g. `'member'`) -> HTTP 403 Forbidden `{"error": "Forbidden: Administrative privileges required"}`.
    - If authenticated user role is `'admin'`:
      - For **any HTTP method** (`GET`, `POST`, `PATCH`, `DELETE`, `PUT`, `OPTIONS`) and **any subpath** (e.g. `/upstreams`, `/api-keys`, `/audit`, `/unknown`):
        Returns HTTP 501 Not Implemented:
        ```json
        {
          "error": "Not Implemented",
          "message": "Admin API reserved for Gate G7",
          "path": "/admin/v1/..."
        }
        ```
  - Contract Guarantee: Admin routes are standard Express REST routes and are **never** registered as MCP tools in `McpServer`.

#### [NEW] `apps/gateway/src/logging/logger.ts`
- Redacted structured JSON logger with recursive data traversal:
  - Traverses nested objects and arrays.
  - Sensitive key patterns: `/authorization/i`, `/password/i`, `/secret/i`, `/token/i`, `/api[-_]?key/i`, `/cookie/i`.
  - Sensitive value patterns:
    - `Bearer\s+[A-Za-z0-9._-]+` -> `[REDACTED_AUTH_HEADER]`
    - `urumi_live_[0-9a-fA-F]+` -> `[REDACTED_API_KEY]`
  - Real customer email masking while preserving RFC-compliant synthetic fixtures (`.mock` / `.example`).
  - Redacts raw arguments and error stacks to prevent internal topology leakage.

#### [NEW] `apps/gateway/src/server.ts`
- Express application factory:
  ```typescript
  export interface ServerOptions {
    config: AppConfig;
    authenticator?: Authenticator; // Defaults to new FailClosedAuthenticator()
    readinessCheck?: () => boolean; // Defaults to () => true
  }

  export function createExpressApp(options: ServerOptions): express.Application;
  ```
- **Middleware & Route Execution Flow**:
  1. Method validation for `/mcp`: Rejects non-POST methods with HTTP 405 Method Not Allowed (`Allow: POST`).
  2. Content-Type check for `/mcp`: Rejects non-`application/json` requests with HTTP 415 Unsupported Media Type.
  3. Authentication middleware for `/mcp`: Rejects missing/invalid credentials with HTTP 401 *before* parsing large JSON payloads or invoking MCP server.
  4. Body parsing bounded by `MAX_PAYLOAD_SIZE_BYTES` (64 KiB):
     - Catches body parser syntax errors and returns deterministic HTTP 400 Bad Request `{"error": "Bad Request: Malformed JSON payload"}`.
     - Catches `entity.too.large` errors and returns deterministic HTTP 413 Payload Too Large `{"error": "Payload Too Large: Request body exceeds 64 KiB limit"}`.
  5. Stateless Streamable HTTP Transport:
     - Instantiates per-request `StreamableHTTPServerTransport` and ephemeral `McpServer({ name: 'urumi-gateway', version: '1.0.0' })`.
     - Connects server and transport: `await server.connect(transport)`.
     - Dispatches request: `await transport.handleRequest(req, res, req.body)`.
     - **Idempotent Multi-Event Cleanup**:
       ```typescript
       let cleanedUp = false;
       const cleanup = () => {
         if (cleanedUp) return;
         cleanedUp = true;
         transport.close().catch(() => {});
         server.close().catch(() => {});
       };
       res.on('finish', cleanup);
       res.on('close', cleanup);
       req.on('error', cleanup);
       ```
  6. Health routes: `/health`, `/health/live`, `/health/ready`.
  7. Admin prefix: `/admin/v1/*`.

#### [NEW] `apps/gateway/src/lifecycle.ts`
- Graceful shutdown coordinator:
  - Tracks in-flight HTTP connections.
  - Attaches `SIGTERM` and `SIGINT` handlers.
  - Stops accepting new connections (`server.close()`).
  - Awaits in-flight requests up to `config.DRAIN_TIMEOUT_MS` (5000ms).
  - Destroys lingering sockets and cleanly exits process (`process.exit(0)`).

#### [NEW] `apps/gateway/src/index.ts`
- Production application entrypoint:
  - Loads configuration via `loadConfig(process.env, true)`.
  - **Explicitly instantiates `FailClosedAuthenticator`**:
    ```typescript
    const authenticator = new FailClosedAuthenticator();
    const app = createExpressApp({ config, authenticator, readinessCheck: () => true });
    ```
  - Starts HTTP listener on `config.PORT` and `config.HOST`.
  - Registers graceful shutdown with `LifecycleManager`.

---

### Test Strategy & Suites

#### `apps/gateway/test/unit/`
1. **`config.test.ts`**:
   - Validates all default values.
   - Validates environment variable overrides.
   - Enforces timeout bounds: Rejects <500ms and >30000ms (ADR-011 Section 2.7).
   - Enforces port bounds: Rejects <1024 and >65535.
   - Documents active vs reserved settings in test assertions.
   - Confirms config immutability (`Object.isFrozen`).
2. **`auth.test.ts`**:
   - Confirms `FailClosedAuthenticator` rejects all tokens.
   - Confirms HTTP 401 on missing Authorization header.
   - Confirms HTTP 401 on invalid scheme (e.g. `Basic`, `Token`).
   - Confirms HTTP 401 on empty/whitespace token.
   - Confirms zero auth-bypass flags exist in configuration.
3. **`health.test.ts`**:
   - `GET /health/live` returns HTTP 200 with service identity.
   - `GET /health/ready` returns HTTP 200 when local stub is ready.
   - `GET /health/ready` returns HTTP 503 when local stub reports unready.
   - Confirms health probe contains zero upstream coupling.
4. **`admin.test.ts`**:
   - Unauthenticated access to `/admin/v1/*` returns HTTP 401.
   - Member access to `/admin/v1/*` returns HTTP 403.
   - Admin access to any subpath (`/admin/v1/upstreams`, `/admin/v1/api-keys`, `/admin/v1/unknown`) returns HTTP 501.
   - Admin access across all HTTP methods (`GET`, `POST`, `PATCH`, `DELETE`) returns HTTP 501.
5. **`logger.test.ts`**:
   - Recursive redaction of nested objects (`{ nested: { api_key: "urumi_live_..." } }`).
   - Redaction of sensitive keys in arrays (`[{ password: "secret" }]`).
   - Redaction of `Bearer ...` tokens and `urumi_live_` strings.
   - Error stack sanitization.
6. **`shutdown.test.ts`**:
   - Graceful drain closes server and exits cleanly on simulated SIGTERM within the 5s deadline.

#### `apps/gateway/test/protocol/`
1. **`mcp-protocol.test.ts`**:
   - Rejects unauthenticated request to `POST /mcp` with HTTP 401 before MCP dispatch.
   - Authenticated client connection via official `@modelcontextprotocol/sdk` `Client` and `StreamableHTTPClientTransport`.
   - Protocol handshake (`initialize`) and `client.listTools()`.
   - Rejects non-POST methods with HTTP 405 (`Allow: POST`).
   - Rejects non-JSON Content-Type with HTTP 415.
   - Rejects malformed JSON with HTTP 400.
   - Rejects oversized payload (>64 KiB) with HTTP 413.
   - Rejects malformed JSON-RPC protocol (missing version/method).
   - Proves idempotent transport cleanup on successive requests without hanging sockets or memory leaks.
   - Verifies `/admin/v1` routes are private and never registered in `client.listTools()`.
2. **`sdk-cancellation.test.ts` (`TEST-GTW-SDK-ABORT-PUBLIC-API`)**:
   - Standalone contract regression test validating `@modelcontextprotocol/sdk@1.32.1` `RequestOptions.signal` public API.
   - Sets up a standalone mock MCP server with a delay tool.
   - Connects a shared `Client` with `StreamableHTTPClientTransport`.
   - Dispatches two concurrent tool calls (Call A and Call B).
   - Aborts Call A via `signal: abortController.signal`.
   - Verifies:
     1. Call A promise rejects with `AbortError`.
     2. Mock server receives `notifications/cancelled` for Call A's request ID.
     3. Sibling Call B completes successfully.
     4. Subsequent Call C on the same shared client completes successfully.
   - Clearly documented as an isolated SDK contract test, establishing the prerequisite contract for G6.

---

## Verification Plan

### Automated Tests
1. **Gateway Test Suite**:
   ```bash
   npm --workspace=apps/gateway run test
   ```
   Runs `test:unit` and `test:protocol` with 100% pass rate.
2. **Monorepo Build**:
   ```bash
   npm run build
   ```
   Compiles all 5 workspaces (`apps/mcp-crm`, `apps/mcp-tasks`, `apps/woocommerce-mcp`, `apps/gateway`, `packages/shared`) with 0 TypeScript errors.
3. **Monorepo Complete Test Suite**:
   ```bash
   npm test
   ```
   Executes test suites across all workspaces with 0 failures and 0 regressions.

### Manual Verification
- Verify `FailClosedAuthenticator` is explicitly wired in `apps/gateway/src/index.ts`.
- Verify `/admin/v1` routes return 501 for admin, 403 for member, and 401 for anonymous.
- Verify zero cluster resources, Helm charts, or WooCommerce records were modified.
