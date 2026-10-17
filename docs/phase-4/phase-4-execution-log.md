# Phase 4 — Master Technical Execution Log

**Repository:** `AdityaDRathore/MCP-Gateway-Kubernetes-Wcom`  
**Target Cluster:** `k3d-urumi` | **Namespace:** `urumi`  
**Baseline Commit HEAD:** `210d589f2a2658d16766da12617fa03adcab5f56`  
**Governing Work Order:** `docs/phase-4/urumi_phase_4_Master_Technical_Roadmap_Checklist.md`  
**Current Date:** 2026-10-15  

---

## Gate Execution Summary

| Gate ID | Description | Status | Decision & Authorization | Completed Date |
|:---:|---|:---:|---|:---:|
| **G0** | Read-Only Preflight & Protected Baseline Capture | **PASS** | Accepted with G0-R1 blocker remediation | 2026-10-15 |
| **G0-R1** | WooCommerce MCP `ImagePullBackOff` Remediation | **PASS** | Accepted; Workload 1/1 Running, endpoint registered | 2026-10-15 |
| **G1** | Architecture Decisions & Contracts (ADR-011..ADR-018) | **PASS** | Remediation requested by Technical Head | 2026-10-15 |
| **G1.1** | Focused Remediation (SSRF, RBAC, Audit, SDK Cancellation) | **APPROVED** | **Formally Approved by Technical Head** | 2026-10-15 |
| **G3** | Gateway Protocol Skeleton & Health Endpoints | **PASS** | Completed with 100% test pass rate across unit and protocol suites | 2026-10-16 |
| **G4** | SQLite Persistence, API Keys, Bootstrap & Two-Phase Audit | **PASS** | Completed with 100% test pass rate; pending Technical Head review | 2026-10-17 |
| **G5** | Upstream Aggregation Manager & Dynamic Tool Catalog | PENDING | Awaiting G4 completion & review | — |
| **G6** | Gateway Router, Deadlines, Concurrency & Resilience | PENDING | Awaiting G5 completion & review | — |
| **G7** | Dynamic Admin API & Kubernetes Secret Lifecycle | PENDING | Awaiting G6 completion & review | — |
| **G8** | Docker, Helm Chart, PVC & NetworkPolicy Integration | PENDING | Awaiting G7 completion & review | — |
| **G9** | End-to-End Acceptance, Performance Benchmarking & Closure | PENDING | Awaiting G8 completion & review | — |

---

## Detailed Gate Transition Log

### 1. Gate G0: Read-Only Preflight
- **Timestamp:** 2026-10-15T19:30:00Z
- **Baseline Git HEAD:** `210d589f2a2658d16766da12617fa03adcab5f56`
- **Verified Cluster Inventory:** Node `k3d-urumi-server-0` (K3s `v1.37.1+k3s1`), WordPress 7.1.3, MariaDB 11.4.5, PVC `urumi-mariadb-pvc` (UID `58d7357d-a9ec-458f-b98a-78b191c7a523`), PVC `urumi-wordpress-pvc` (UID `78d0d23b-6323-44b2-a4d0-6bc1f4bbafc8`).
- **Baseline Protected Records Captured:** Products 10, 11, 12; Order #14.
- **Finding:** Workload `urumi-woocommerce-mcp` in `ImagePullBackOff` due to missing local k3d image import.

### 2. Gate G0-R1: Workload Remediation
- **Timestamp:** 2026-10-15T20:45:00Z
- **Command:** `k3d image import urumi-woocommerce-mcp:1.0.0 -c urumi`
- **Result:** Workload reached `1/1 Running`; endpoint `10.42.0.130:3000` registered; `/health` probe HTTP 200. Zero store mutation.

### 3. Gate G1: Architecture Decisions and Exact Contracts
- **Timestamp:** 2026-10-15T21:30:00Z
- **Deliverables:** Master Register, ADR-011 through ADR-018.
- **Review:** Technical Head placed G1 on HOLD pending 8 remediation points (URL allowlist, K8s RBAC, audit finalization failure semantics, MCP client cancellation, SQLite recovery, contracts/bounds, performance targets, and decision statuses).

### 4. Gate G1.1: Focused Architectural Remediation
- **Timestamp:** 2026-10-15T23:15:00Z
- **Addressed 7 Review Findings:**
  1. Multi-layered SSRF defense: WHATWG parser + pre-connect DNS IP validation hook (`validateResolvedIp`) verifying cluster CIDR (`10.42.x.x` / `10.43.x.x`) + Egress NetworkPolicy.
  2. Scoped RBAC Role updated with `list` verb in namespace `urumi-gateway-secrets` for orphan discovery.
  3. Schema & lifecycle synchronization: 6-state `audit_logs.status` enum (`pending`, `success`, `failed`, `timeout`, `client_disconnected`, `unconfirmed_outcome`).
  4. Proven degraded audit response contract: Dual signaling via standard MCP JSON-RPC `result._meta.urumi_audit_status` + HTTP response header `X-Urumi-Audit-Status`. Pristine `content` and `isError: false` prevent false mutation retries.
  5. Shifted cancellation architecture to official supported public SDK API: `client.request(req, schema, { signal: abortController.signal })`. Added contract regression test `TEST-GTW-SDK-ABORT-PUBLIC-API`.
  6. Eliminated registration vs. orphan sweep race condition: In-process lock, two-phase SQLite state (`provisioning` -> `active`), 120s crash threshold, and 300s (5-minute) unreferenced grace period.
  7. Corrected benchmark percentile definition to NIST Nearest Rank method with explicit boundary clamping and TypeScript reference implementation.
- **Decision:** **Gate G1 APPROVED by Technical Head.**

### 5. Gate G2: CRM and Tasks Mock Services Implementation
- **Timestamp:** 2026-10-15T23:55:00Z
- **Status:** **PASS (IMPLEMENTED AND FULLY VERIFIED)**
- **Scope Implemented:**
  - `apps/mcp-crm`:
    - Stateless Streamable HTTP over port 3000 (`POST /mcp`, `GET /health`).
    - Seeded synthetic fixtures (`CRM-CONT-001`, `CRM-CONT-002`, `CRM-CONT-003`) strictly using `@example.mock`, zero real customer PII.
    - Tools: `search_contacts` (case-insensitive substring match, deterministic ID sort, bounded limit 1..20 default 10) and `get_contact` (lookup by regex `^CRM-CONT-[0-9]{3}$`, structured 404 tool error).
    - Failure injection: `MOCK_DELAY_MS` and `MOCK_FAIL_MODE`, safely disabled in production.
    - Structured JSON logger with sensitive credential and real PII redaction.
  - `apps/mcp-tasks`:
    - Stateless Streamable HTTP over port 3000 (`POST /mcp`, `GET /health`).
    - In-memory state model initialized with baseline `TASK-001` and `TASK-002`, with `reset()` restoring determinism on pod restart.
    - Numerical ID suffix ordering (`parseTaskIdSuffix`) ensuring `TASK-999` strictly precedes `TASK-1000`.
    - Strict assignee relationship validation against `VALID_CRM_ASSIGNEES` (`CRM-CONT-001..003`).
    - Payload-aware idempotency caching: 1,000-key capacity, 24-hour TTL, FIFO eviction on capacity overflow. Same key + same payload returns original task; same key + different payload rejected with `idempotency_conflict`.
    - Tools: `create_task`, `list_tasks`, and `update_task_status` (with no-op detection when status matches).
    - Failure injection: `MOCK_DELAY_MS` and `MOCK_FAIL_MODE`, safely disabled in production.
  - Test Results:
    - `apps/mcp-crm` Unit Tests: 20 passed, 0 failed.
    - `apps/mcp-crm` Protocol Tests: 6 passed, 0 failed (exercising live Streamable HTTP).
    - `apps/mcp-tasks` Unit Tests: 27 passed, 0 failed.
    - `apps/mcp-tasks` Protocol Tests: 8 passed, 0 failed (exercising live Streamable HTTP).
    - Monorepo Build (`npm run build`): 4 workspaces compiled cleanly with 0 TypeScript errors.
    - Monorepo Test Suite (`npm run test`): All workspaces passed with 100% pass rate.
- **Invariants Preserved:**
  - Zero code written for `apps/gateway` (reserved for Gate G3+).
  - Zero Kubernetes cluster resources mutated or deployed.
  - Zero live WooCommerce store records modified.
  - Strict Node 24 LTS (`v24.20.0`) runtime compliance.

### 6. Gate G3: Gateway Skeleton and Downstream MCP Protocol Implementation
- **Timestamp:** 2026-10-16T14:30:00Z
- **Status:** **PASS (IMPLEMENTED AND FULLY VERIFIED)**
- **Scope Implemented (`apps/gateway`):**
  - **Strict Configuration (`src/config.ts`):**
    - Actively enforced settings: `PORT` (1024..65535, default 3000), `HOST` (default 0.0.0.0), `NODE_ENV` (production/development/test), `LOG_LEVEL` (debug/info/warn/error), `DEFAULT_UPSTREAM_TIMEOUT_MS` strictly bounded to 500..30000ms (ADR-011 Section 2.7), `MAX_PAYLOAD_SIZE_BYTES` (default 64 KiB), `DRAIN_TIMEOUT_MS` (500..15000ms, default 5000ms).
    - Explicitly reserved settings: `DB_PATH` (G4 SQLite WAL), `MAX_RESULT_SIZE_BYTES` (G6 Router result cap), `GLOBAL_CONCURRENCY_LIMIT` (G6 Router global permit pool), `PER_UPSTREAM_CONCURRENCY_LIMIT` (G6 Router per-upstream pool).
    - Pure `parseConfig` function throwing descriptive errors, cached `loadConfig`, and `Object.freeze` immutability.
  - **Fail-Closed Authentication Boundary (`src/auth/`):**
    - `FailClosedAuthenticator`: Production authenticator unconditionally returns `null`, failing closed safely.
    - Zero auth-bypass environment variables or development backdoors.
    - `FakeAuthenticator`: In-memory test helper strictly confined to test constructors.
    - `createAuthMiddleware`: Enforces `Authorization: Bearer <token>`, rejecting missing/malformed/unverified credentials with HTTP 401 before body parsing or MCP dispatch.
  - **Operational Health Probes (`src/http/health.ts`):**
    - `GET /health/live`: Checks process loop, returns HTTP 200 `{"status":"ok","service":"urumi-gateway"}`.
    - `GET /health/ready`: Decoupled readiness probe evaluating local gateway configuration and initialization only (ADR-016); returns HTTP 200 when ready, HTTP 503 when degraded. Zero upstream outage coupling.
    - `GET /health`: General operational health probe returning HTTP 200.
  - **Reserved Admin Router (`src/http/admin.ts`):**
    - Mounted at `/admin/v1`.
    - Unauthenticated requests receive HTTP 401; non-admin (`member`) role receives HTTP 403 Forbidden.
    - Authenticated admin requests receive HTTP 501 Not Implemented across all subpaths (`/admin/v1/*`) and all HTTP methods (`GET`, `POST`, `PATCH`, `DELETE`, `PUT`).
    - Verified absent from MCP tool definitions.
  - **Downstream MCP Protocol Endpoint (`src/server.ts`):**
    - Stateless Streamable HTTP over `POST /mcp` using pinned `@modelcontextprotocol/sdk@1.32.1`.
    - Strict pre-dispatch validations: HTTP 405 Method Not Allowed on non-POST, HTTP 415 Unsupported Media Type on non-JSON, HTTP 401 on unauthenticated, HTTP 400 Bad Request on malformed JSON syntax, and HTTP 413 Payload Too Large on bodies > 64 KiB.
    - Ephemeral `McpServer` and `StreamableHTTPServerTransport` per request.
    - Idempotent multi-event transport lifecycle cleanup guard registered across `res.on('finish')`, `res.on('close')`, and `req.on('error')`.
  - **Structured Redacted Logger (`src/logging/logger.ts`):**
    - Deep recursive traversal of objects and arrays.
    - Scans and scrubs Bearer headers, Urumi API keys (`urumi_live_...`), passwords, tokens, secrets, cookie headers, and real customer emails, while preserving RFC-compliant synthetic fixtures (`.mock`).
    - Stack trace sanitization preventing internal topology disclosure.
  - **Graceful Shutdown Coordinator (`src/lifecycle.ts`):**
    - Socket connection tracking, `SIGTERM` and `SIGINT` signal handlers.
    - Server closure with bounded 5-second connection drain deadline (`DRAIN_TIMEOUT_MS`).
    - Automatic fallback to forceful socket destruction and clean process exit (`process.exit(0)`).
  - **Contract Regression Test (`TEST-GTW-SDK-ABORT-PUBLIC-API` in `test/protocol/sdk-cancellation.test.ts`):**
    - Validates pinned `@modelcontextprotocol/sdk@1.32.1` `RequestOptions.signal` cancellation contract.
    - Shared upstream client multiplexing two concurrent tool calls: Call A cancelled via `signal.abort()`, receives `notifications/cancelled`, Call B completes successfully, subsequent Call C on shared client succeeds.
  - **Test Results (Initial G3 Submission):**
    - Gateway Unit Tests (`test/unit/*.test.ts`): **29 passed, 0 failed** across 6 suites (Config, Auth, Health, Admin, Logger, Shutdown).
    - Gateway Protocol Tests (`test/protocol/*.test.ts`): **2 passed, 0 failed** across 2 suites (MCP Protocol Handshake, SDK Cancellation Regression).
    - Monorepo Test Suite (`npm test`): **100% pass rate** across all workspaces (`mcp-crm`, `mcp-tasks`, `woocommerce-mcp`, `gateway`).
    - Monorepo Build (`npm run build`): **5 workspaces compiled cleanly** with 0 TypeScript errors.
- **Invariants Preserved:**
  - Zero code written for SQLite persistence or migrations (strictly reserved for Gate G4).
  - Zero code written for Upstream Aggregation Manager (strictly reserved for Gate G5).
  - Zero code written for Upstream Router or Circuit Breakers (strictly reserved for Gate G6).
  - Zero Kubernetes cluster resources mutated or deployed.
  - Zero live WooCommerce store records modified (products 10/11/12 and Order #14 untouched).
  - Strict Node 24 LTS (`v24.20.0`) runtime compliance.

### 7. Gate G3 Remediation: Resolution of Technical Head Review Findings
- **Timestamp:** 2026-10-17T14:50:00Z
- **Status:** **PASS (REMEDIATED AND RE-VERIFIED)**
- **Technical Head Findings Addressed:**
  1. **Admin Route Contract & OPTIONS Handling (Blocking):**
     - Verified `router.all('*', ...)` contract explicitly for `OPTIONS` requests.
     - Unauthenticated `OPTIONS` to `/admin/v1` returns HTTP 401 Unauthorized.
     - Member role `OPTIONS` to `/admin/v1` returns HTTP 403 Forbidden.
     - Authenticated admin `OPTIONS` returns HTTP 501 Not Implemented across all paths.
     - Verified in `apps/gateway/test/unit/admin.test.ts` (suite total expanded from 4 to 6 tests).
  2. **Non-Silent Teardown & Disconnect Diagnostics (Blocking & Final Remediation):**
     - In `apps/gateway/src/server.ts`, eliminated silent `catch(() => {})` handlers during request cleanup.
     - Added safe, redacted warning logs (`logger.warn('Error during transport cleanup close', ...)`) if `transport.close()` or `server.close()` rejects.
     - Added optional `ServerOptions` diagnostic hooks (`onMcpRequestStart`, `onMcpRequestCleanup`) and guarded against response writes after client disconnect (`res.destroyed || res.writableEnded`).
     - In `apps/gateway/test/protocol/mcp-protocol.test.ts`, the test server explicitly signals when it receives the request and enters the `/mcp` handler before the client aborts. The test awaits this signal, triggers client abort in-flight, verifies the server observes the `close` disconnect event, and confirms subsequent `/health` and `/mcp` requests succeed with HTTP 200.
  3. **Ephemeral Port Allocation (Blocking):**
     - Eliminated hardcoded ports (7890, 7999) across test suites.
     - Updated `mcp-protocol.test.ts` and `sdk-cancellation.test.ts` to bind dynamically to `server.listen(0, '127.0.0.1')` and resolve bound ports via `server.address().port`, eliminating parallel CI/CD port contention.
  4. **Request-ID Cancellation Correlation (Blocking):**
     - In `apps/gateway/test/protocol/sdk-cancellation.test.ts`, captured `callARequestId` and `callBRequestId` from wire-level JSON-RPC payloads.
     - Asserted exact correlation: `notifications/cancelled` notification contains `params.requestId === callARequestId`.
     - Asserted sibling isolation: `cancelledNotifications` contains zero entries for `callBRequestId`, and Call B finishes successfully.
  5. **Synthetic Domain Policy & Adversarial Redaction (High):**
     - Clarified policy: redaction is treated as defense-in-depth risk reduction, not a guarantee of zero PII leakage.
     - Refined email regex to `\b[A-Za-z0-9._%+-]+@(?!(?:[A-Za-z0-9-]+\.)*(?:mock|example|test|invalid)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,63}\b/gi`.
     - Preserves all synthetic `.mock` domains (e.g. `@alice.mock`, `@sub.domain.mock`) and RFC 2606 / 6761 test domains (`.mock`, `.example`, `.test`, `.invalid`).
     - Safely redacts real emails with standard and modern long TLDs (up to 63 chars, e.g. `.international`, `.technology`).
     - Added adversarial tests in `apps/gateway/test/unit/logger.test.ts` (suite total expanded from 6 to 7 tests).
  6. **Graceful Shutdown Exit Code Distinction (Medium):**
     - In `apps/gateway/src/lifecycle.ts`, clean socket drain results in `process.exit(0)`.
     - Expiration of `DRAIN_TIMEOUT_MS` forcing lingering connection destruction results in `process.exit(1)`.
     - Verified in `apps/gateway/test/unit/shutdown.test.ts` with custom exit handler hooks for both clean and timeout paths.
  7. **Real Linter Configuration (Medium):**
     - Replaced placeholder echo script in `apps/gateway/package.json` with `"lint": "tsc --noEmit"`.
     - Verified clean execution (`npm --workspace=gateway run lint` exited code 0).
  8. **FakeAuthenticator Physical Confinement (Architecture):**
     - Removed `apps/gateway/src/auth/fake-authenticator.ts` from application source tree.
     - Relocated test authenticator to `apps/gateway/test/helpers/fake-authenticator.ts`.
     - Confirms `src/` contains zero test authenticators and `FailClosedAuthenticator` is the sole production authenticator.
  9. **Reconciled Test Evidence & Execution Counts (Medium):**
     - **Gateway Unit Tests (`npm --workspace=gateway run test:unit`):** **31 passed, 0 failed across 6 suites**
       - `admin.test.ts`: 6 tests
       - `auth.test.ts`: 6 tests
       - `config.test.ts`: 6 tests
       - `health.test.ts`: 4 tests
       - `logger.test.ts`: 7 tests
       - `shutdown.test.ts`: 2 tests
     - **Gateway Protocol Tests (`npm --workspace=gateway run test:protocol`):** **3 passed, 0 failed across 2 suites**
       - `mcp-protocol.test.ts`: 2 tests (Handshake + Client Premature Disconnect with Server Entry Signal)
       - `sdk-cancellation.test.ts`: 1 test (Request-ID Correlated Abort + Sibling Isolation)
     - **Gateway Total:** **34 passed, 0 failed across 8 suites**
     - **Monorepo Build (`npm run build`):** Clean build across all 5 workspaces with 0 errors.
     - **Monorepo Tests (`npm test`):** **176 tests passed, 0 failed** across 4 workspaces:
       - `apps/gateway`: 34 passed (31 unit, 3 protocol)
       - `apps/woocommerce-mcp`: 81 passed (46 unit, 35 protocol)
       - `apps/mcp-tasks`: 35 passed (27 unit, 8 protocol)
       - `apps/mcp-crm`: 26 passed (20 unit, 6 protocol)
- **Scope Invariants Preserved:**
  - Zero Gate G4 SQLite / token database code introduced.
  - Zero Gate G5 Upstream Aggregation code introduced.
  - Zero Gate G6 Upstream Router code introduced.
  - Zero Kubernetes or Helm modifications made.
  - Zero live store records mutated.

### 8. Gate G4: SQLite Persistence, API Keys, Bootstrap, Audit, and Recovery
- **Timestamp:** 2026-10-17T17:40:00Z
- **Status:** **PASS (IMPLEMENTED AND FULLY VERIFIED)**
- **Scope Implemented (`apps/gateway`):**
  - **Database Engine & PRAGMAs (`src/db/connection.ts`):**
    - Node.js 24 LTS core `node:sqlite` (`DatabaseSync`) in Write-Ahead Logging (WAL) mode.
    - Path default: `/data/gateway.db` with strict `0700` directory creation and `0600` file permissions.
    - Required PRAGMAs: `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`, `synchronous = NORMAL`.
    - Fail-closed startup: executes `PRAGMA integrity_check;` on startup; throws `DatabaseCorruptionError` on corruption without deleting or resetting database files.
    - Transaction helper `transaction<T>(fn)` executing within `BEGIN IMMEDIATE TRANSACTION; ... COMMIT;` with automatic `ROLLBACK;` on error.
  - **Transactional Versioned Migrations (`src/db/migrations.ts`, `src/db/schema.ts`):**
    - Tracking table `schema_migrations` (`version`, `name`, `applied_at`).
    - Fail-closed future version check: aborts startup with `IncompatibleSchemaError` if `db_version > code_version`.
    - Atomic migration transactions: individual `BEGIN IMMEDIATE TRANSACTION;` per pending migration with full rollback on failure.
    - Canonical Migration 001: establishes `users`, `api_keys`, `upstreams`, and `audit_logs` with all indexes and constraints.
  - **API Key Lifecycle Primitives (`src/auth/api-key-service.ts`, `src/db/api-key-repo.ts`):**
    - Cryptographic entropy: 32 bytes from `crypto.randomBytes(32)` formatted as `urumi_live_<64_hex_chars>` (75 characters).
    - Verifier-only persistence: raw token returned once upon creation; only SHA-256 hash (`key_hash`) and 16-character prefix (`key_prefix`) saved to SQLite.
    - Timing-safe comparison: authenticates inbound Bearer tokens using `crypto.timingSafeEqual` over raw buffer digests.
    - Immediate revocation: `revokeKey(id)` immediately marks `revoked_at = unixepoch()`, rejecting subsequent requests on the next lookup.
    - Expiry enforcement: keys with `expires_at <= unixepoch()` rejected.
    - Role preservation: cleanly separates `admin` and `member` roles.
    - Redacted logging: verified zero raw tokens, hashes, or Bearer credentials are emitted in logs.
  - **Idempotent Administrator Bootstrap CLI (`src/cli/bootstrap.ts`):**
    - Executable via `npm --workspace=gateway run bootstrap` or `node dist/cli/bootstrap.js`.
    - Idempotency guard: checks if admin exists; if already provisioned, outputs notice and halts with exit code 0.
    - Provisioning: generates initial admin user and 32-byte key in a single transaction, printing plaintext key to stdout exactly once with clear security instructions.
  - **Durable Two-Phase Audit Persistence (`src/audit/audit-service.ts`, `src/db/audit-repo.ts`):**
    - 6-state lifecycle model: `pending`, `success`, `failed`, `timeout`, `client_disconnected`, `unconfirmed_outcome`.
    - Arguments fingerprint: SHA-256 hash stored in `arguments_hash`; zero customer PII or raw secrets stored.
    - Phase 1 Fail-Closed Invariant: if writing `pending` start record fails (disk full, lock timeout), raises `AuditStartError` and aborts immediately; upstream is never called.
    - Phase 2 Truthful Reporting Invariant: if upstream mutation succeeds but Phase 2 finalization write fails (e.g. `SQLITE_FULL`), gateway emits high-priority log `AUDIT_FINALIZATION_DEGRADED` and returns tool result without masking mutation success.
    - Background reconciliation: `reconcileDanglingRecords(cutoff)` identifies orphaned `pending` records older than cutoff and updates to `unconfirmed_outcome` with `FINALIZATION_TIMEOUT`.
    - Retention pruning: `pruneAuditLogs(retentionDays, batchLimit)` deletes old records in bounded batches (500 rows).
  - **Operational Safety, Online Backup, and Recovery (`src/db/backup.ts`, `docs/phase-4/g4-recovery-runbook.md`):**
    - Online snapshot using SQLite non-locking `VACUUM INTO '<destination_path>'`.
    - Immediate `PRAGMA integrity_check;` on snapshot file; unlinks snapshot on verification failure.
    - Permissions enforced: `0600` (`-rw-------`).
    - Automated pruning retaining last 7 daily snapshots.
    - Disaster recovery runbook documenting cold recovery, stale WAL/SHM file cleanup, and replica scaling procedures.
    - Lifecycle integration: `LifecycleManager.registerCleanupHook` gracefully closes database connections during shutdown.
  - **Test Evidence (Gate G4 Completion):**
    - Gateway Unit Tests (`npm --workspace=gateway run test:unit`): **59 passed, 0 failed across 12 suites**:
      - `db-connection.test.ts`: 5 tests
      - `db-migrations.test.ts`: 4 tests
      - `api-key-lifecycle.test.ts`: 7 tests
      - `bootstrap.test.ts`: 2 tests
      - `audit-persistence.test.ts`: 7 tests
      - `recovery.test.ts`: 3 tests
      - `admin.test.ts`: 6 tests
      - `auth.test.ts`: 6 tests
      - `config.test.ts`: 6 tests
      - `health.test.ts`: 4 tests
      - `logger.test.ts`: 7 tests
      - `shutdown.test.ts`: 2 tests
    - Gateway Protocol Tests (`npm --workspace=gateway run test:protocol`): **3 passed, 0 failed across 2 suites**
    - Gateway Total: **62 passed, 0 failed across 14 suites**
    - Monorepo Build (`npm run build`): **5 workspaces compiled cleanly with 0 TypeScript errors**
    - Monorepo Lint (`npm run lint`): **0 lint errors across all workspaces**
    - Monorepo Tests (`npm test`): **204 passed, 0 failed across 4 workspaces**:
      - `apps/gateway`: 62 passed (59 unit, 3 protocol)
      - `apps/woocommerce-mcp`: 81 passed (46 unit, 35 protocol)
      - `apps/mcp-tasks`: 35 passed (27 unit, 8 protocol)
      - `apps/mcp-crm`: 26 passed (20 unit, 6 protocol)
- **Scope Invariants Preserved:**
  - Zero Gate G5 Upstream Aggregation code introduced.
  - Zero Gate G6 Upstream Router code introduced.
  - Zero new admin HTTP routes introduced.
  - Zero Kubernetes manifests, PVCs, or Helm charts mutated.
  - Zero live WooCommerce store records modified (products 10/11/12 and Order #14 untouched).



