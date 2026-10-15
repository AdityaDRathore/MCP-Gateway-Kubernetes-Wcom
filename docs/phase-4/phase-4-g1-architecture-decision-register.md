# Phase 4 — Gate G1.1 Architecture Decision Register & Contract Specifications (Focused Remediation)

**Document Type:** Formal Architecture Decision Register & Exact Service Contract Specifications  
**Gate:** G1.1 (Focused Architecture Decisions & Contracts Remediation)  
**Status:** **REVISED SUBMISSION (G1.1) — PENDING TECHNICAL HEAD RE-REVIEW (NO CODE IMPLEMENTED)**  
**Repository:** `AdityaDRathore/MCP-Gateway-Kubernetes-Wcom`  
**Verified Baseline HEAD:** [`210d589f2a2658d16766da12617fa03adcab5f56`](file:///home/rathore/Documents/Urumi%20Assignment)  
**Target Cluster:** `k3d-urumi` | **Namespace:** `urumi`  
**Revision Date:** 2026-10-15  

---

## 1. G1.1 Focused Remediation Correction Log

This log maps each of the 7 technical head findings to the corresponding architectural resolution, file changes, and required verification tests:

| Priority | Finding Topic | Affected Document(s) | Architectural Resolution & Evidence | Verification Test ID |
|:---:|---|---|---|---|
| **P0** | **SSRF Protection Needs Stronger Guarantees** | [`ADR-017`](../decisions/ADR-017-network-defense-ssrf-allowlist-and-secret-rbac.md), [`Register`](./phase-4-g1-architecture-decision-register.md) | Multi-layered defense: (1) Lexical WHATWG parser; (2) Pre-connect DNS lookup hook (`validateResolvedIp`) verifying resolved IP is within Cluster CIDR (`10.42.x.x` / `10.43.x.x`), rejecting loopback, metadata (`169.254.x.x`), and K8s API (`10.43.0.1`); (3) Kernel-level Egress `NetworkPolicy` on `urumi-gateway`. | `TEST-GTW-SSRF-DNS-RESOLVER` (DNS resolution & socket address pinning test) |
| **P1** | **Secret Reconciliation RBAC Incomplete** | [`ADR-017`](../decisions/ADR-017-network-defense-ssrf-allowlist-and-secret-rbac.md) | Added `list` verb to `urumi-gateway-secret-manager` Role in `urumi-gateway-secrets`. Documented that `list` is strictly required for orphan discovery while `watch` is omitted to preserve least privilege. | `TEST-GTW-SECRET-RBAC-LIST` (RBAC list verb verification in secrets namespace) |
| **P1** | **Audit Status Values Inconsistent** | [`ADR-014`](../decisions/ADR-014-two-phase-audit-logging-and-retention.md), [`ADR-012`](../decisions/ADR-012-gateway-persistence-node-sqlite-and-wal.md), [`Register`](./phase-4-g1-architecture-decision-register.md) | Synchronized DDL and migration plan to exact 6-state lifecycle: `CHECK(status IN ('pending', 'success', 'failed', 'timeout', 'client_disconnected', 'unconfirmed_outcome'))`. Documented state transitions. | `TEST-GTW-AUDIT-STATUS-SCHEMA` (Schema check constraint & lifecycle transition test) |
| **P1** | **Degraded-Audit Response Contract Not Proven** | [`ADR-014`](../decisions/ADR-014-two-phase-audit-logging-and-retention.md), [`Register`](./phase-4-g1-architecture-decision-register.md) | Implemented dual signaling: (1) MCP Protocol standard `_meta` field in JSON-RPC body (`result._meta.urumi_audit_status = 'finalization-degraded'`) ensuring MCP clients observe degradation; (2) `content` delivers pristine upstream result with `isError: false`; (3) HTTP header `X-Urumi-Audit-Status: finalization-degraded` for proxy observability. | `TEST-GTW-AUDIT-MCP-META-DEGRADED` (MCP JSON-RPC `_meta` degraded response contract test) |
| **P1** | **Cancellation Relies on SDK Internals** | [`ADR-011`](../decisions/ADR-011-gateway-dual-mcp-proxy-and-transport-lifecycle.md), [`Register`](./phase-4-g1-architecture-decision-register.md) | Shifted design to official, supported public SDK API: `client.request(req, schema, { signal: abortController.signal })`. Demoted private properties to internal mechanics explanation. Added contract regression test against installed `@modelcontextprotocol/sdk@1.32.1`. | `TEST-GTW-SDK-ABORT-PUBLIC-API` (Regression test on installed SDK public abort API) |
| **P1** | **Orphan Sweep Can Race with Registration** | [`ADR-017`](../decisions/ADR-017-network-defense-ssrf-allowlist-and-secret-rbac.md), [`Register`](./phase-4-g1-architecture-decision-register.md) | Eliminated race condition: (1) In-process `activeRegistrations` lock; (2) Two-phase SQLite state (`provisioning` -> `active`); (3) Sweep ignores `provisioning` rows $< 120\text{s}$ old; (4) Unreferenced Secrets granted 300s (5-minute) grace period before deletion. | `TEST-GTW-SECRET-SWEEP-NO-RACE` (Registration vs sweep race elimination test) |
| **P2** | **Benchmark Percentile Calculation Needs Correction** | [`ADR-015`](../decisions/ADR-015-concurrency-limits-circuit-breaker-and-resilience.md), [`Register`](./phase-4-g1-architecture-decision-register.md) | Replaced flawed index formula with NIST Nearest Rank convention: $\text{rank} = \lceil (P/100) \times N \rceil$, $\text{index} = \max(0, \min(N-1, \text{rank}-1))$. Provided reference TypeScript function with explicit boundary clamping. | `TEST-GTW-BENCHMARK-PERCENTILE` (Unit test for percentile calculation edge cases) |

---

## 2. Audit of Existing Baseline Decisions (ADR-001 through ADR-010)

| ADR ID | Title | Status | Baseline Invariants Preserved in Phase 4 |
|---|---|:---:|---|
| **ADR-001** | Stack, Runtime & Local K8s | Accepted | Node.js 24 LTS (`v24.20.0`), npm workspaces, k3d v5.8.3, SQLite on PVC (`/data/gateway.db`). |
| **ADR-002** | MCP Protocol & Transport | Accepted | Pinned `@modelcontextprotocol/sdk@1.32.1`, wire protocol `2024-11-05`, Streamable HTTP over `POST /mcp`. |
| **ADR-003** | Secrets & Access Boundaries | Accepted | User API keys stored hashed (**SHA-256**); dynamic secrets in namespace `urumi-gateway-secrets`; no client token passthrough. |
| **ADR-004** | Storage & Workload Controllers | Accepted | StorageClass `local-path` with RWO PVCs; `Recreate` deployment strategy. |
| **ADR-005** | Local Development REST API | Accepted | Must-use plugin `local-dev-rest-ssl.php` scoped strictly to local hostnames and `/wp-json/wc/` path. |
| **ADR-006** | Version Parity & Memory Limits | Accepted | Pinned K3s `v1.37.1+k3s1`; gateway budgeted for `requests: 96Mi, limits: 256Mi`. |
| **ADR-007** | In-Cluster Store Authentication | Accepted | One-legged RFC 5849 OAuth 1.0a HMAC-SHA256 for in-cluster store communication. |
| **ADR-008** | Five-Tool Least-Privilege Contract | Accepted | Curated 5 tools (`list_products`, `create_product`, `list_orders`, `get_order`, `update_order_status`); zero PII in output. |
| **ADR-009** | Network Isolation & NetworkPolicies | Accepted | Non-root UID 10001, capabilities dropped (`ALL`), `kube-router` NetworkPolicy restricting ingress. |
| **ADR-010** | Container Image Identity Boundary | Accepted | Local k3d images require `k3d image import`; separate local config IDs from OCI registry distribution digests. |

---

## 3. Revised Decision Register: All 17 Decision Areas

Every decision is explicitly labeled with its governance classification:
- **VERIFIED FACT:** Empirically proven in the workspace or running cluster.
- **PROPOSED DECISION:** Architecture submitted for Technical Head sign-off.
- **PROPOSAL PENDING APPROVAL:** Parameter or threshold awaiting formal approval.

| # | Decision Area | Status | Owning ADR | Technical Architecture & Rationale | Classification |
|---|---|:---:|---|---|:---:|
| **1** | MCP SDK, Protocol & Transport Lifecycle | **Proposed** | [`ADR-011`](../decisions/ADR-011-gateway-dual-mcp-proxy-and-transport-lifecycle.md) | Pinned `@modelcontextprotocol/sdk@1.32.1`, protocol `2024-11-05`. Downstream `/mcp` uses stateless `StreamableHTTPServerTransport` per request. Upstreams use managed `StreamableHTTPClientTransport`. | **PROPOSED DECISION** |
| **2** | Upstream Client Reuse & Cancellation | **Proposed** | [`ADR-011`](../decisions/ADR-011-gateway-dual-mcp-proxy-and-transport-lifecycle.md) | Single reusable `Client` per enabled upstream. Uses supported public `client.request(req, schema, { signal })` API. Transport remains open during sibling aborts. **Never blindly retry mutating calls.** | **PROPOSED DECISION** |
| **3** | SQLite Driver Compatibility (Node 24) | **Verified** | [`ADR-012`](../decisions/ADR-012-gateway-persistence-node-sqlite-and-wal.md) | Built-in Node.js **`node:sqlite`** (`DatabaseSync`). Zero native C++ compilation (`node-gyp`), zero ABI break risk, zero layer bloat. WAL mode and `VACUUM INTO` verified live on Node 24. | **VERIFIED FACT** |
| **4** | API Key Format, Verifier & Revocation | **Proposed** | [`ADR-013`](../decisions/ADR-013-api-key-auth-constant-time-and-admin-bootstrap.md) | `urumi_live_<64_hex_chars>` (75 chars). Plaintext shown once. Verifier stored as **SHA-256** in SQLite. Matched via `crypto.timingSafeEqual`. Immediate revocation on next query via `revoked_at`. | **PROPOSED DECISION** |
| **5** | Secure One-Time Administrator Bootstrap | **Proposed** | [`ADR-013`](../decisions/ADR-013-api-key-auth-constant-time-and-admin-bootstrap.md) | CLI command `node dist/cli/bootstrap.js`. Idempotent: checks for existing admin in `users`; safely halts with exit code 0 if admin exists. Plaintext key printed once. Zero default keys in git. | **PROPOSED DECISION** |
| **6** | Two-Phase Audit Logging Invariants | **Proposed** | [`ADR-014`](../decisions/ADR-014-two-phase-audit-logging-and-retention.md) | Phase 1 (Start): Write record before call; **fail closed if write fails**. Phase 2: If upstream mutation succeeds but finalization fails, **return tool output with dual MCP `_meta` + HTTP header degraded status; do not report failure**. 6-state schema lifecycle. | **PROPOSED DECISION** |
| **7** | Circuit Breaker & Error Classification | **Proposed** | [`ADR-015`](../decisions/ADR-015-concurrency-limits-circuit-breaker-and-resilience.md) | 3 consecutive infrastructure failures (`ECONNREFUSED`, `ETIMEDOUT`, 502–504) trips circuit for 15s. **Business and validation errors (400, 404, 409, isError: true) NEVER trip circuit.** | **PROPOSAL PENDING APPROVAL** |
| **8** | Concurrency Bounds & Payload Size Caps | **Proposed** | [`ADR-015`](../decisions/ADR-015-concurrency-limits-circuit-breaker-and-resilience.md) | Max **20 global in-flight requests** (429 on overflow). Max **4 in-flight per upstream** (1,000ms FIFO permit queue). Max **64 KiB** request arguments (413). Max **1 MiB** response result. | **PROPOSAL PENDING APPROVAL** |
| **9** | Health Probes & Catalog Snapshotting | **Proposed** | [`ADR-016`](../decisions/ADR-016-upstream-catalog-snapshot-and-health-tracking.md) | `GET /health/live` (process); `GET /health/ready` (DB + gateway state). **Readiness probe does NOT fail during upstream outage.** Unreachable upstream tools fail fast (503 `UpstreamUnreachableError`). | **PROPOSED DECISION** |
| **10** | Audit Retention & Pruning Strategy | **Proposed** | [`ADR-014`](../decisions/ADR-014-two-phase-audit-logging-and-retention.md) | 30-day retention or max 100,000 records. Bounded batch deletions (`LIMIT 500`) to prevent SQLite write lock contention. Periodic maintenance vacuuming. | **PROPOSED DECISION** |
| **11** | Multi-Layer SSRF Defense & URL Allowlist | **Proposed** | [`ADR-017`](../decisions/ADR-017-network-defense-ssrf-allowlist-and-secret-rbac.md) | WHATWG `URL` parser + pre-connect DNS resolution hook (`validateResolvedIp`) verifying Cluster CIDR (`10.42.x.x` / `10.43.x.x`) + Egress NetworkPolicy. Strictly blocks localhost, 169.254.x.x, K8s API, MariaDB, WordPress. Prohibits redirects. | **PROPOSED DECISION** |
| **12** | Ingress Boundary & Private Admin API | **Proposed** | [`ADR-017`](../decisions/ADR-017-network-defense-ssrf-allowlist-and-secret-rbac.md) | Public Ingress routes strictly `POST /mcp` (Bearer auth required). Administrative routes (`/admin/v1/*`) are excluded from Ingress and require `role === 'admin'` (members get 403 Forbidden). | **PROPOSED DECISION** |
| **13** | Single Gateway Replica & SQLite Concurrency | **Proposed** | [`ADR-012`](../decisions/ADR-012-gateway-persistence-node-sqlite-and-wal.md) | `replicas: 1` with `strategy.type: Recreate`. SQLite PRAGMAs: `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`, `synchronous = NORMAL`. File mode `0600`, user `10001:10001`. | **PROPOSED DECISION** |
| **14** | Performance Targets & Benchmark Method | **Proposed** | [`ADR-015`](../decisions/ADR-015-concurrency-limits-circuit-breaker-and-resilience.md) | 10 concurrent clients, 100 fast calls, 0% internal errors, p95 < 1.0s, p99 < 2.0s. Defined 10-call warm-up and NIST Nearest Rank percentile formula with edge-case clamping. | **PROPOSAL PENDING APPROVAL** |
| **15** | CRM & Tasks Schemas, Fixtures & State Reset | **Proposed** | [`ADR-018`](../decisions/ADR-018-upstream-mock-contracts-crm-and-tasks.md) | CRM: 3 synthetic fixtures (`CRM-CONT-001..003`), zero real PII. Tasks: in-memory store initialized with `TASK-001..002`; **resets to baseline on pod restart**; assignee validated against CRM set. | **PROPOSED DECISION** |
| **16** | K8s Secret RBAC & Race-Free Sweep | **Proposed** | [`ADR-017`](../decisions/ADR-017-network-defense-ssrf-allowlist-and-secret-rbac.md) | SA in `urumi`; Secrets in `urumi-gateway-secrets`. Role includes `list` verb. Two-phase SQLite registration state + in-process lock + 5-minute grace period eliminates sweep race condition. | **PROPOSED DECISION** |
| **17** | In-Flight Call Handling on Upstream Changes | **Proposed** | [`ADR-015`](../decisions/ADR-015-concurrency-limits-circuit-breaker-and-resilience.md) | Upstream disable/remove enters `DRAINING` state: immediate 503 for new calls; in-flight calls allowed up to 5s drain deadline; transport and timers closed before DB update. | **PROPOSED DECISION** |

---

## 4. Exact Service Contracts & TypeScript / Zod Schemas

### 4.1 CRM Mock Service (`apps/mcp-crm`) Contract

```typescript
import { z } from 'zod';

export const CrmContactSchema = z.object({
  id: z.string().regex(/^CRM-CONT-[0-9]{3}$/, 'ID must match CRM-CONT-###'),
  name: z.string().min(1).max(100),
  title: z.string().min(1).max(100),
  company: z.string().min(1).max(100),
  email: z.string().email().refine(e => e.endsWith('@example.mock'), 'Must use .mock domain'),
  phone: z.string().min(5).max(30),
  status: z.enum(['active', 'lead', 'inactive']),
  notes: z.string().max(500),
});

export type CrmContact = z.infer<typeof CrmContactSchema>;

// Tool: search_contacts
export const SearchContactsInputSchema = z.object({
  query: z.string().trim().min(1).max(50).optional(),
  limit: z.number().int().min(1).max(20).default(10),
});

// Tool: get_contact
export const GetContactInputSchema = z.object({
  contact_id: z.string().regex(/^CRM-CONT-[0-9]{3}$/, 'Invalid Contact ID format'),
});
```

### 4.2 Tasks Mock Service (`apps/mcp-tasks`) Contract

```typescript
import { z } from 'zod';

export const VALID_CRM_ASSIGNEES = new Set(['CRM-CONT-001', 'CRM-CONT-002', 'CRM-CONT-003']);

export const TaskRecordSchema = z.object({
  id: z.string().regex(/^TASK-[0-9]{3,}$/, 'ID must match TASK-###'),
  title: z.string().min(1).max(120),
  description: z.string().max(500).default(''),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  status: z.enum(['todo', 'in_progress', 'done', 'cancelled']),
  assignee_contact_id: z.string().refine(id => VALID_CRM_ASSIGNEES.has(id), 'Must match a valid CRM contact ID').optional(),
  idempotency_key: z.string().max(64).optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type TaskRecord = z.infer<typeof TaskRecordSchema>;

// Tool: create_task
export const CreateTaskInputSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  assignee_contact_id: z.string().refine(id => VALID_CRM_ASSIGNEES.has(id), 'Assignee must be a valid CRM contact ID').optional(),
  idempotency_key: z.string().max(64).optional(),
});

// Tool: list_tasks
export const ListTasksInputSchema = z.object({
  status: z.enum(['todo', 'in_progress', 'done', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

// Tool: update_task_status
export const UpdateTaskStatusInputSchema = z.object({
  task_id: z.string().regex(/^TASK-[0-9]{3,}$/),
  status: z.enum(['todo', 'in_progress', 'done', 'cancelled']),
});
```

### 4.3 Gateway Administration REST API Contract (`/admin/v1/*`)

```typescript
import { z } from 'zod';

// Consistent timeout bounds: 500 ms to 30,000 ms
export const TIMEOUT_MIN_MS = 500;
export const TIMEOUT_MAX_MS = 30000;
export const TIMEOUT_DEFAULT_MS = 10000;

export const RegisterUpstreamInputSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens').min(2).max(32),
  display_name: z.string().min(2).max(64),
  endpoint_url: z.string().url(), // Validated via validateAndNormalizeUpstreamUrl()
  timeout_ms: z.number().int().min(TIMEOUT_MIN_MS).max(TIMEOUT_MAX_MS).default(TIMEOUT_DEFAULT_MS),
  credential_token: z.string().min(1).max(512).optional(),
});

export const UpdateUpstreamInputSchema = z.object({
  display_name: z.string().min(2).max(64).optional(),
  endpoint_url: z.string().url().optional(),
  timeout_ms: z.number().int().min(TIMEOUT_MIN_MS).max(TIMEOUT_MAX_MS).optional(),
  is_enabled: z.boolean().optional(),
  credential_token: z.string().min(1).max(512).optional(),
});
### 4.4 Core Database Schema (Migration 001 DDL)

```sql
-- Migration 001: Initial Core Schema
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
  created_at INTEGER NOT NULL
);

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE upstreams (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  timeout_ms INTEGER NOT NULL DEFAULT 10000 CHECK(timeout_ms BETWEEN 500 AND 30000),
  is_enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK(status IN ('provisioning', 'active', 'disabled', 'deleting', 'cleanup_required', 'failed')),
  secret_ref_name TEXT,
  secret_ref_key TEXT,
  cleanup_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  upstream_slug TEXT,
  tool_name TEXT NOT NULL,
  arguments_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'success', 'failed', 'timeout', 'client_disconnected', 'unconfirmed_outcome')),
  duration_ms INTEGER,
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_audit_status_created ON audit_logs(status, created_at);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
```

### 4.5 Degraded Audit MCP Protocol Response Contract (`CallToolResult`)

When upstream tool execution succeeds but Phase 2 audit finalization fails (e.g. disk full), the gateway returns an untampered success response with dual-signaling metadata:

```json
{
  "jsonrpc": "2.0",
  "id": 14,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"id\": 15, \"name\": \"Album\", \"status\": \"publish\"}"
      }
    ],
    "isError": false,
    "_meta": {
      "urumi_audit_status": "finalization-degraded",
      "urumi_audit_warning": "Upstream mutation succeeded, but local audit log finalization write failed on gateway storage. Do not retry."
    }
  }
}
```

---

## 5. Updated Requirements Traceability & Test Matrix

| Req ID | Requirement Statement | Primary ADR | Planned Test Suite & Test ID |
|---|---|---|---|
| **GTW-01** | Aggregates multiple upstreams into single endpoint | [`ADR-011`](../decisions/ADR-011-gateway-dual-mcp-proxy-and-transport-lifecycle.md), [`ADR-016`](../decisions/ADR-016-upstream-catalog-snapshot-and-health-tracking.md) | `test/protocol/aggregation.test.ts` (`TEST-GTW-01-AGGREGATION`) |
| **GTW-02** | Connects to at least 3 distinct upstreams (Woo, CRM, Tasks) | [`ADR-016`](../decisions/ADR-016-upstream-catalog-snapshot-and-health-tracking.md), [`ADR-018`](../decisions/ADR-018-upstream-mock-contracts-crm-and-tasks.md) | `test/integration/three-upstreams.test.ts` (`TEST-GTW-02-UPSTREAMS`) |
| **GTW-03** | Dynamic routing of tool calls to correct upstream | [`ADR-011`](../decisions/ADR-011-gateway-dual-mcp-proxy-and-transport-lifecycle.md) | `test/protocol/routing.test.ts` (`TEST-GTW-03-ROUTING`) |
| **GTW-04** | Tool namespacing (`{server}__{tool}`) prevents collisions | [`ADR-016`](../decisions/ADR-016-upstream-catalog-snapshot-and-health-tracking.md) | `test/unit/catalog-namespacing.test.ts` (`TEST-GTW-04-NAMESPACING`) |
| **GTW-05** | Failure isolation: dead upstream does not crash gateway or others | [`ADR-015`](../decisions/ADR-015-concurrency-limits-circuit-breaker-and-resilience.md), [`ADR-016`](../decisions/ADR-016-upstream-catalog-snapshot-and-health-tracking.md) | `test/integration/failure-isolation.test.ts` (`TEST-GTW-05-ISOLATION`) |
| **GTW-06** | Configurable per-upstream request timeouts (500–30,000ms) | [`ADR-011`](../decisions/ADR-011-gateway-dual-mcp-proxy-and-transport-lifecycle.md), [`ADR-015`](../decisions/ADR-015-concurrency-limits-circuit-breaker-and-resilience.md) | `test/integration/timeout-cancellation.test.ts` (`TEST-GTW-06-TIMEOUT`) |
| **GTW-07** | Dynamic upstream management without gateway restart | [`ADR-012`](../decisions/ADR-012-gateway-persistence-node-sqlite-and-wal.md), [`ADR-016`](../decisions/ADR-016-upstream-catalog-snapshot-and-health-tracking.md) | `test/integration/dynamic-management.test.ts` (`TEST-GTW-07-DYNAMIC`) |
| **GTW-08** | Upstream health tracking and resilient gateway readiness | [`ADR-016`](../decisions/ADR-016-upstream-catalog-snapshot-and-health-tracking.md) | `test/integration/health-tracking.test.ts` (`TEST-GTW-08-HEALTH`) |
| **GTW-09** | Upstream credential isolation (no downstream leakage) | [`ADR-011`](../decisions/ADR-011-gateway-dual-mcp-proxy-and-transport-lifecycle.md), [`ADR-013`](../decisions/ADR-013-api-key-auth-constant-time-and-admin-bootstrap.md), [`ADR-017`](../decisions/ADR-017-network-defense-ssrf-allowlist-and-secret-rbac.md) | `test/unit/credential-sanitization.test.ts` (`TEST-GTW-09-ISOLATION`) |
| **GTW-10** | Dynamic upstream credentials in K8s Secrets with RBAC | [`ADR-017`](../decisions/ADR-017-network-defense-ssrf-allowlist-and-secret-rbac.md) | `test/integration/k8s-secret-lifecycle.test.ts` (`TEST-GTW-10-SECRETS`) |
| **GTW-11** | Gateway persistence: SQLite WAL on PVC (`/data/gateway.db`) | [`ADR-012`](../decisions/ADR-012-gateway-persistence-node-sqlite-and-wal.md) | `test/integration/sqlite-persistence.test.ts` (`TEST-GTW-11-PERSISTENCE`) |
| **SEC-01** | SHA-256 API key hashing & timingSafeEqual validation | [`ADR-013`](../decisions/ADR-013-api-key-auth-constant-time-and-admin-bootstrap.md) | `test/unit/api-key-auth.test.ts` (`TEST-SEC-01-AUTH`) |
| **SEC-02** | Zero customer PII persisted in logs or database | [`ADR-014`](../decisions/ADR-014-two-phase-audit-logging-and-retention.md), [`ADR-018`](../decisions/ADR-018-upstream-mock-contracts-crm-and-tasks.md) | `test/unit/pii-redaction.test.ts` (`TEST-SEC-02-NO-PII`) |
| **SEC-03** | Canonical WHATWG URL validation & SSRF defense (21 cases) | [`ADR-017`](../decisions/ADR-017-network-defense-ssrf-allowlist-and-secret-rbac.md) | `test/unit/ssrf-allowlist.test.ts` (`TEST-SEC-03-SSRF`) |
| **SEC-04** | Pre-connect DNS IP validation & cluster CIDR enforcement | [`ADR-017`](../decisions/ADR-017-network-defense-ssrf-allowlist-and-secret-rbac.md) | `test/unit/ssrf-dns-resolution.test.ts` (`TEST-GTW-SSRF-DNS-RESOLVER`) |
| **SEC-05** | K8s Secret Role grants `list` verb in `urumi-gateway-secrets` | [`ADR-017`](../decisions/ADR-017-network-defense-ssrf-allowlist-and-secret-rbac.md) | `test/integration/k8s-rbac-list.test.ts` (`TEST-GTW-SECRET-RBAC-LIST`) |
| **SEC-06** | Orphan sweep race elimination with two-phase state machine | [`ADR-017`](../decisions/ADR-017-network-defense-ssrf-allowlist-and-secret-rbac.md) | `test/integration/secret-sweep-race.test.ts` (`TEST-GTW-SECRET-SWEEP-NO-RACE`) |
| **AUD-01** | Two-phase audit logging (start pending, update outcome) | [`ADR-014`](../decisions/ADR-014-two-phase-audit-logging-and-retention.md) | `test/unit/audit-lifecycle.test.ts` (`TEST-AUD-01-TWOPHASE`) |
| **AUD-02** | Immutable audit records with 6-state lifecycle | [`ADR-014`](../decisions/ADR-014-two-phase-audit-logging-and-retention.md), [`ADR-012`](../decisions/ADR-012-gateway-persistence-node-sqlite-and-wal.md) | `test/unit/audit-status-schema.test.ts` (`TEST-GTW-AUDIT-STATUS-SCHEMA`) |
| **AUD-03** | Fail-closed start; MCP `_meta` degraded response on finalization fail | [`ADR-014`](../decisions/ADR-014-two-phase-audit-logging-and-retention.md) | `test/integration/audit-mcp-meta.test.ts` (`TEST-GTW-AUDIT-MCP-META-DEGRADED`) |
| **LFC-01** | Supported public SDK abort signal cancellation contract | [`ADR-011`](../decisions/ADR-011-gateway-dual-mcp-proxy-and-transport-lifecycle.md) | `test/protocol/sdk-abort-contract.test.ts` (`TEST-GTW-SDK-ABORT-PUBLIC-API`) |
| **PERF-01** | Benchmark NIST Nearest Rank percentile edge-case handling | [`ADR-015`](../decisions/ADR-015-concurrency-limits-circuit-breaker-and-resilience.md) | `test/unit/benchmark-percentiles.test.ts` (`TEST-GTW-BENCHMARK-PERCENTILE`) |

---

## 6. Prohibited Actions & Invariants Adherence

- **Zero Source Code Implemented:** No files were created under `apps/gateway/`, `apps/mcp-crm/`, or `apps/mcp-tasks/`.
- **Zero Cluster Mutations:** Zero pods, deployments, services, or secrets created or modified in the cluster.
- **Zero Helm Changes:** Helm templates and values files remain untouched.
- **Zero Mutating Tests Executed:** Live store integration tests were not run; protected store records (products 10, 11, 12, Order #14) and PVC UIDs remain identical to baseline.
- **Documentation Only:** Revised ADR-011, ADR-012, ADR-014, ADR-015, ADR-016, ADR-017, ADR-018, and this master Register.

---

## 7. Worker Governance Statement & Handoff

In accordance with strict Technical Head instructions:
- **Authorized Gate:** `G1.1 — Architecture Decisions and Contracts (Focused Remediation)`
- **Output Artifacts:**
  - [`docs/phase-4/phase-4-g1-architecture-decision-register.md`](file:///home/rathore/Documents/Urumi%20Assignment/docs/phase-4/phase-4-g1-architecture-decision-register.md)
  - [`docs/decisions/ADR-011-gateway-dual-mcp-proxy-and-transport-lifecycle.md`](file:///home/rathore/Documents/Urumi%20Assignment/docs/decisions/ADR-011-gateway-dual-mcp-proxy-and-transport-lifecycle.md)
  - [`docs/decisions/ADR-012-gateway-persistence-node-sqlite-and-wal.md`](file:///home/rathore/Documents/Urumi%20Assignment/docs/decisions/ADR-012-gateway-persistence-node-sqlite-and-wal.md)
  - [`docs/decisions/ADR-013-api-key-auth-constant-time-and-admin-bootstrap.md`](file:///home/rathore/Documents/Urumi%20Assignment/docs/decisions/ADR-013-api-key-auth-constant-time-and-admin-bootstrap.md)
  - [`docs/decisions/ADR-014-two-phase-audit-logging-and-retention.md`](file:///home/rathore/Documents/Urumi%20Assignment/docs/decisions/ADR-014-two-phase-audit-logging-and-retention.md)
  - [`docs/decisions/ADR-015-concurrency-limits-circuit-breaker-and-resilience.md`](file:///home/rathore/Documents/Urumi%20Assignment/docs/decisions/ADR-015-concurrency-limits-circuit-breaker-and-resilience.md)
  - [`docs/decisions/ADR-016-upstream-catalog-snapshot-and-health-tracking.md`](file:///home/rathore/Documents/Urumi%20Assignment/docs/decisions/ADR-016-upstream-catalog-snapshot-and-health-tracking.md)
  - [`docs/decisions/ADR-017-network-defense-ssrf-allowlist-and-secret-rbac.md`](file:///home/rathore/Documents/Urumi%20Assignment/docs/decisions/ADR-017-network-defense-ssrf-allowlist-and-secret-rbac.md)
  - [`docs/decisions/ADR-018-upstream-mock-contracts-crm-and-tasks.md`](file:///home/rathore/Documents/Urumi%20Assignment/docs/decisions/ADR-018-upstream-mock-contracts-crm-and-tasks.md)

**G1 remediation submitted for Technical Head re-review; G2 implementation not started.**
