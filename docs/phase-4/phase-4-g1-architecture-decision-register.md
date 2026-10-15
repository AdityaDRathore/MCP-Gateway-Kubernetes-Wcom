# Phase 4 — Gate G1 Architecture Decision Register & Contract Specifications

**Document Type:** Formal Architecture Decision Register (ADR Index) & Exact Service Contract Specifications  
**Gate:** G1 (Freeze Architecture, Decisions & Contracts)  
**Status:** **SUBMITTED FOR TECHNICAL HEAD APPROVAL — NO CODE IMPLEMENTED**  
**Repository:** `AdityaDRathore/MCP-Gateway-Kubernetes-Wcom`  
**Inspected Baseline HEAD:** `210d589f2a2658d16766da12617fa03adcab5f56`  
**Date:** 2026-10-15  

---

## 1. Audit of Existing Decisions (ADR-001 through ADR-010)

Before proposing new decisions, all 10 existing Architectural Decision Records in `docs/decisions/` were audited to establish the baseline and prevent regressions or contradictory specifications:

| ADR ID | Title | Status | Scope & Settled Principles | Impact on Phase 4 Gateway |
|---|---|:---:|---|---|
| **ADR-001** | Application Stack, Runtime, and Local Kubernetes Strategy | Accepted | Pinned **Node.js 24 LTS (`v24.20.0`)**, npm workspaces, k3d v5.8.3, and SQLite on PVC `/data/gateway.db`. | Gateway must run on Node 24 LTS; persistence must reside at `/data/gateway.db`. |
| **ADR-002** | MCP Protocol Compatibility, Transport, and SDK Selection | Accepted | Pinned **`@modelcontextprotocol/sdk@1.32.1`**, wire protocol **`2024-11-05`**, stateless Streamable HTTP over `POST /mcp`. | Downstream endpoint must use stateless Streamable HTTP; legacy SSE transport is strictly forbidden. |
| **ADR-003** | Secrets Management, Access Control, and Threat Boundaries | Accepted | User API keys stored hashed (**SHA-256**); dynamic secrets in namespace `urumi-gateway-secrets`; no client token passthrough. | Gateway must strip client bearer tokens before upstream calls; Secrets managed via dedicated RBAC. |
| **ADR-004** | Stateful Storage Architecture and Workload Controllers | Accepted | StorageClass `local-path` with RWO PVCs; `Recreate` deployment strategy. | Gateway must use `replicas: 1` and `strategy: { type: Recreate }` to prevent PVC multi-attach errors. |
| **ADR-005** | Local Development REST API Authentication and Security Boundary | Accepted | Must-use plugin `local-dev-rest-ssl.php` scoped strictly to local hostnames and `/wp-json/wc/` path. | Gateway must communicate with WooCommerce MCP, not directly with WordPress REST API. |
| **ADR-006** | Kubernetes Version Parity, Digest Locking, and Memory Budgeting | Accepted | Pinned K3s `v1.37.1+k3s1`; store memory requests/limits (WP: 256Mi/512Mi, DB: 128Mi/384Mi). | Gateway container cgroup budgeted for `requests: 96Mi, limits: 256Mi` (fits within ~1.2 GiB free RAM). |
| **ADR-007** | In-Cluster WooCommerce REST API Authentication via OAuth 1.0a | Accepted | One-legged RFC 5849 OAuth 1.0a HMAC-SHA256 for in-cluster store communication. | Preserved inside `urumi-woocommerce-mcp`; gateway does not manage or sign WooCommerce OAuth keys. |
| **ADR-008** | Five-Tool Least-Privilege Contract and Customer PII Redaction | Accepted | Curated 5 tools (`list_products`, `create_product`, `list_orders`, `get_order`, `update_order_status`); zero PII in output. | Gateway aggregates these exact 5 tools under prefix `woocommerce__*`. |
| **ADR-009** | Cluster-Internal Workload Isolation and NetworkPolicies | Accepted | Non-root UID 10001, capabilities dropped (`ALL`), `kube-router` NetworkPolicy restricting ingress. | Gateway egress policy must permit port 3000 to upstreams and port 53 to DNS; external ingress limited to `/mcp`. |
| **ADR-010** | Container Image Identity, CRI Resolution, and Digest Boundary | Accepted | Local k3d images require `k3d image import`; separate local config IDs from OCI registry distribution digests. | Gateway and mock container images must follow local k3d import workflow; production digests remain Phase 7. |

---

## 2. Phase 4 Master Architecture Decision Register (17 Decision Areas)

The following register addresses all 17 mandatory decisions set forth in the Phase 4 Work Orders. Each decision is categorized as **FACT** (empirically proven in cluster/workspace), **PROPOSAL** (sound design awaiting review), or **DECISION** (formally accepted architecture):

| # | Decision Area | Status | Owning ADR | Summary of Frozen Architecture & Rationale | Category |
|---|---|:---:|---|---|:---:|
| **1** | MCP SDK, Protocol & Transport Lifecycle | **ACCEPTED** | [`ADR-011`](../decisions/ADR-011-gateway-dual-mcp-proxy-and-transport-lifecycle.md) | Pinned `@modelcontextprotocol/sdk@1.32.1`, protocol `2024-11-05`. Downstream is stateless `StreamableHTTPServerTransport` per request; upstreams use managed `StreamableHTTPClientTransport` session. | **FACT / DECISION** |
| **2** | Upstream Client Reuse, Concurrency & Timeouts | **ACCEPTED** | [`ADR-011`](../decisions/ADR-011-gateway-dual-mcp-proxy-and-transport-lifecycle.md) | Single reusable `Client` per enabled upstream. Monotonic JSON-RPC message multiplexing verified in SDK. Default 10s timeout via `AbortSignal`. **Never blindly retry mutating calls.** | **FACT / DECISION** |
| **3** | SQLite Driver Compatibility (Node 24) | **ACCEPTED** | [`ADR-012`](../decisions/ADR-012-gateway-persistence-node-sqlite-and-wal.md) | Built-in Node.js **`node:sqlite`** (`DatabaseSync`). Zero native C++ compilation (`node-gyp`), zero build bloat, zero ABI breaks. WAL mode and `VACUUM INTO` verified live on Node 24. | **FACT / DECISION** |
| **4** | API Key Format, Verifier Hashing & Revocation | **ACCEPTED** | [`ADR-013`](../decisions/ADR-013-api-key-auth-constant-time-and-admin-bootstrap.md) | `urumi_live_<64_hex_chars>` (75 chars). Plaintext shown once. Verifier stored as **SHA-256** in SQLite. Matched via `crypto.timingSafeEqual`. Immediate revocation on next query via `revoked_at`. | **DECISION** |
| **5** | Secure One-Time Administrator Bootstrap | **ACCEPTED** | [`ADR-013`](../decisions/ADR-013-api-key-auth-constant-time-and-admin-bootstrap.md) | CLI command `node dist/cli/bootstrap.js`. Idempotent: checks for existing admin in `users`; safely halts with exit code 0 if admin exists. Plaintext key printed once. Zero default keys in git. | **DECISION** |
| **6** | Two-Phase Audit Logging Failure Invariants | **ACCEPTED** | [`ADR-014`](../decisions/ADR-014-two-phase-audit-logging-and-retention.md) | Phase 1 (Audit Start): Write record before call; **if start write fails, upstream call is aborted (fail closed)**. Phase 2: Update outcome; if finalization fails, leaves detectable pending record. | **DECISION** |
| **7** | Circuit Breaker & Error Classification | **ACCEPTED** | [`ADR-015`](../decisions/ADR-015-concurrency-limits-circuit-breaker-and-resilience.md) | 3 consecutive infrastructure failures (`ECONNREFUSED`, `ETIMEDOUT`, 502–504) trips circuit for 15s. **Business and validation errors (400, 404, 409, isError: true) NEVER trip circuit.** | **DECISION** |
| **8** | Concurrency Bounds & Payload Size Caps | **ACCEPTED** | [`ADR-015`](../decisions/ADR-015-concurrency-limits-circuit-breaker-and-resilience.md) | Max **20 global in-flight requests** (429 on overflow). Max **4 in-flight per upstream** (1,000ms FIFO permit queue). Max **64 KiB** request arguments (413). Max **1 MiB** response result. | **DECISION** |
| **9** | Health Probes & Catalog Snapshotting | **ACCEPTED** | [`ADR-016`](../decisions/ADR-016-upstream-catalog-snapshot-and-health-tracking.md) | `GET /health/live` (process); `GET /health/ready` (DB + gateway state). **Readiness probe does NOT fail during upstream outage.** Atomic in-memory catalog snapshot updated on 30s TTL or mutation. | **DECISION** |
| **10** | Audit Retention & Pruning Strategy | **ACCEPTED** | [`ADR-014`](../decisions/ADR-014-two-phase-audit-logging-and-retention.md) | 30-day retention or max 100,000 records. Bounded batch deletions (`LIMIT 500`) to prevent SQLite write lock contention. Periodic maintenance vacuuming. | **DECISION** |
| **11** | Internal URL Allowlist & SSRF Defense | **ACCEPTED** | [`ADR-017`](../decisions/ADR-017-network-defense-ssrf-allowlist-and-secret-rbac.md) | Strict allowlist: `http://*.urumi.svc.cluster.local:<port>/mcp`. Strictly block localhost, 169.254.x.x, K8s API, MariaDB, and WordPress directly. Reject userinfo, fragments, credentials, redirects. | **DECISION** |
| **12** | Ingress Boundary & Private Admin API | **ACCEPTED** | [`ADR-017`](../decisions/ADR-017-network-defense-ssrf-allowlist-and-secret-rbac.md) | Public Ingress routes strictly `POST /mcp` (Bearer auth required). Administrative routes (`/admin/v1/*`) are excluded from Ingress and require `role === 'admin'` (members get 403 Forbidden). | **DECISION** |
| **13** | Single Gateway Replica & SQLite Concurrency | **ACCEPTED** | [`ADR-012`](../decisions/ADR-012-gateway-persistence-node-sqlite-and-wal.md) | `replicas: 1` with `strategy.type: Recreate`. SQLite PRAGMAs: `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`, `synchronous = NORMAL`. Zero multi-writer collisions. | **DECISION** |
| **14** | Performance Targets & Load Test Method | **ACCEPTED** | [`ADR-015`](../decisions/ADR-015-concurrency-limits-circuit-breaker-and-resilience.md) | 10 concurrent clients, 100 fast calls, 0% internal errors, p95 < 1.0s, p99 < 2.0s, delayed calls within timeout + 1s. Verified via reproducible script `load-test.ts`. | **PROPOSAL** |
| **15** | CRM & Tasks Schemas, Fixtures & State Reset | **ACCEPTED** | [`ADR-018`](../decisions/ADR-018-upstream-mock-contracts-crm-and-tasks.md) | CRM: 3 synthetic fixtures (`CRM-CONT-001..003`), zero real PII. Tasks: in-memory store initialized with `TASK-001..002`; **resets to baseline on pod restart**; optional `idempotency_key`. | **DECISION** |
| **16** | Kubernetes Secret Namespace & Compensation | **ACCEPTED** | [`ADR-017`](../decisions/ADR-017-network-defense-ssrf-allowlist-and-secret-rbac.md) | Dedicated namespace `urumi-gateway-secrets`, ServiceAccount `urumi-gateway-sa`. If DB commit fails after Secret creation, gateway executes compensation `DELETE Secret` to prevent orphans. | **DECISION** |
| **17** | In-Flight Call Handling on Upstream Changes | **ACCEPTED** | [`ADR-015`](../decisions/ADR-015-concurrency-limits-circuit-breaker-and-resilience.md) | Upstream disable/remove enters `DRAINING` state: immediate 503 for new calls; in-flight calls allowed up to 5s drain deadline; transport and timers closed before DB update. | **DECISION** |

---

## 3. Exact Service Contracts & TypeScript / Zod Schemas

### 3.1 CRM Mock Service (`apps/mcp-crm`) Contract

```typescript
import { z } from 'zod';

// Contact Data Model
export const CrmContactSchema = z.object({
  id: z.string().regex(/^CRM-CONT-[0-9]{3}$/, 'ID must match CRM-CONT-###'),
  name: z.string().min(1).max(100),
  title: z.string().min(1).max(100),
  company: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().min(5).max(30),
  status: z.enum(['active', 'lead', 'inactive']),
  notes: z.string().max(500),
});

export type CrmContact = z.infer<typeof CrmContactSchema>;

// Tool 1: search_contacts
export const SearchContactsInputSchema = z.object({
  query: z.string().trim().min(1).max(50).optional(),
  limit: z.number().int().min(1).max(20).default(10),
});

// Tool 2: get_contact
export const GetContactInputSchema = z.object({
  contact_id: z.string().regex(/^CRM-CONT-[0-9]{3}$/, 'Invalid Contact ID format'),
});
```

### 3.2 Tasks Mock Service (`apps/mcp-tasks`) Contract

```typescript
import { z } from 'zod';

// Task Data Model
export const TaskRecordSchema = z.object({
  id: z.string().regex(/^TASK-[0-9]{3,}$/, 'ID must match TASK-###'),
  title: z.string().min(1).max(120),
  description: z.string().max(500).default(''),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  status: z.enum(['todo', 'in_progress', 'done', 'cancelled']),
  assignee_contact_id: z.string().regex(/^CRM-CONT-[0-9]{3}$/).optional(),
  idempotency_key: z.string().max(64).optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type TaskRecord = z.infer<typeof TaskRecordSchema>;

// Tool 1: create_task
export const CreateTaskInputSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  assignee_contact_id: z.string().regex(/^CRM-CONT-[0-9]{3}$/).optional(),
  idempotency_key: z.string().max(64).optional(),
});

// Tool 2: list_tasks
export const ListTasksInputSchema = z.object({
  status: z.enum(['todo', 'in_progress', 'done', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

// Tool 3: update_task_status
export const UpdateTaskStatusInputSchema = z.object({
  task_id: z.string().regex(/^TASK-[0-9]{3,}$/),
  status: z.enum(['todo', 'in_progress', 'done', 'cancelled']),
});
```

### 3.3 Gateway Administration REST API Contract (`/admin/v1/*`)

All administration routes require header `Authorization: Bearer <admin_api_key>` and are rejected if `user.role !== 'admin'`:

```typescript
import { z } from 'zod';

// 1. Register Upstream (POST /admin/v1/upstreams)
export const RegisterUpstreamInputSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens').min(2).max(32),
  display_name: z.string().min(2).max(64),
  endpoint_url: z.string().url().refine(
    (url) => /^http:\/\/[a-z0-9-.]+(?::[0-9]{2,5})?\/mcp$/.test(url),
    'Endpoint must be an internal HTTP service /mcp URL'
  ),
  timeout_ms: z.number().int().min(500).max(30000).default(10000),
  credential_token: z.string().min(1).max(512).optional(), // Stored in K8s Secret, never in SQLite
});

// 2. Update Upstream (PATCH /admin/v1/upstreams/:id)
export const UpdateUpstreamInputSchema = z.object({
  display_name: z.string().min(2).max(64).optional(),
  endpoint_url: z.string().url().optional(),
  timeout_ms: z.number().int().min(500).max(30000).optional(),
  is_enabled: z.boolean().optional(),
  credential_token: z.string().min(1).max(512).optional(),
});

// 3. Create User & API Key (POST /admin/v1/users)
export const CreateUserInputSchema = z.object({
  username: z.string().regex(/^[a-z0-9_-]+$/).min(3).max(32),
  display_name: z.string().min(2).max(64),
  role: z.enum(['admin', 'member']),
});

// Response: Plaintext key displayed exactly once
export interface CreateUserResponse {
  user: {
    id: string;
    username: string;
    display_name: string;
    role: 'admin' | 'member';
  };
  api_key: {
    id: string;
    key_prefix: string;
    plaintext_key: string; // "urumi_live_..." — NEVER SAVED TO DB
    expires_at: number;
  };
}
```

---

## 4. Requirements Traceability & Verification Mapping

Every Phase 4 atomic requirement (GTW-01 through GTW-11) is mapped directly to its architectural solution and automated test verification ID:

| Req ID | Requirement Statement | Owning Decision / ADR | Planned Test Suite & Test ID |
|---|---|---|---|
| **GTW-01** | Aggregates multiple upstream MCP servers into single downstream endpoint | [`ADR-011`](../decisions/ADR-011-gateway-dual-mcp-proxy-and-transport-lifecycle.md), [`ADR-016`](../decisions/ADR-016-upstream-catalog-snapshot-and-health-tracking.md) | `test/protocol/aggregation.test.ts` (`TEST-GTW-01-AGGREGATION`) |
| **GTW-02** | Connects to at least 3 distinct upstreams (WooCommerce, CRM, Tasks) | [`ADR-016`](../decisions/ADR-016-upstream-catalog-snapshot-and-health-tracking.md), [`ADR-018`](../decisions/ADR-018-upstream-mock-contracts-crm-and-tasks.md) | `test/integration/three-upstreams.test.ts` (`TEST-GTW-02-UPSTREAMS`) |
| **GTW-03** | Dynamic routing of tool calls to the correct upstream server | [`ADR-011`](../decisions/ADR-011-gateway-dual-mcp-proxy-and-transport-lifecycle.md) | `test/protocol/routing.test.ts` (`TEST-GTW-03-ROUTING`) |
| **GTW-04** | Tool namespacing (`{server}__{tool}`) prevents naming collisions | [`ADR-016`](../decisions/ADR-016-upstream-catalog-snapshot-and-health-tracking.md) | `test/unit/catalog-namespacing.test.ts` (`TEST-GTW-04-NAMESPACING`) |
| **GTW-05** | Failure isolation: slow/dead upstream does not crash gateway or healthy servers | [`ADR-015`](../decisions/ADR-015-concurrency-limits-circuit-breaker-and-resilience.md), [`ADR-016`](../decisions/ADR-016-upstream-catalog-snapshot-and-health-tracking.md) | `test/integration/failure-isolation.test.ts` (`TEST-GTW-05-ISOLATION`) |
| **GTW-06** | Configurable per-upstream request timeouts (default 10s) | [`ADR-011`](../decisions/ADR-011-gateway-dual-mcp-proxy-and-transport-lifecycle.md), [`ADR-015`](../decisions/ADR-015-concurrency-limits-circuit-breaker-and-resilience.md) | `test/integration/timeout-cancellation.test.ts` (`TEST-GTW-06-TIMEOUT`) |
| **GTW-07** | Dynamic upstream management without gateway restart | [`ADR-012`](../decisions/ADR-012-gateway-persistence-node-sqlite-and-wal.md), [`ADR-016`](../decisions/ADR-016-upstream-catalog-snapshot-and-health-tracking.md) | `test/integration/dynamic-management.test.ts` (`TEST-GTW-07-DYNAMIC`) |
| **GTW-08** | Upstream health tracking and resilient gateway readiness | [`ADR-016`](../decisions/ADR-016-upstream-catalog-snapshot-and-health-tracking.md) | `test/integration/health-tracking.test.ts` (`TEST-GTW-08-HEALTH`) |
| **GTW-09** | Upstream credential isolation (downstream never sees upstream credentials) | [`ADR-013`](../decisions/ADR-013-api-key-auth-constant-time-and-admin-bootstrap.md), [`ADR-017`](../decisions/ADR-017-network-defense-ssrf-allowlist-and-secret-rbac.md) | `test/unit/credential-sanitization.test.ts` (`TEST-GTW-09-ISOLATION`) |
| **GTW-10** | Dynamic upstream credentials stored in Kubernetes Secrets with RBAC | [`ADR-017`](../decisions/ADR-017-network-defense-ssrf-allowlist-and-secret-rbac.md) | `test/integration/k8s-secret-lifecycle.test.ts` (`TEST-GTW-10-SECRETS`) |
| **GTW-11** | Gateway persistence: SQLite with WAL on PVC (`/data/gateway.db`) | [`ADR-012`](../decisions/ADR-012-gateway-persistence-node-sqlite-and-wal.md) | `test/integration/sqlite-persistence.test.ts` (`TEST-GTW-11-PERSISTENCE`) |

---

## 5. Security & Threat Modeling Verification Register

| Threat / Risk ID | Threat Vector | Mitigation Strategy | Enforcing Code / ADR |
|---|---|---|---|
| **THR-01** | Timing side-channel attack on API keys | Inbound tokens hashed and compared using `crypto.timingSafeEqual`. | [`ADR-013`](../decisions/ADR-013-api-key-auth-constant-time-and-admin-bootstrap.md) |
| **THR-02** | SSRF attack via dynamic upstream URL | Strict hostname allowlist (`urumi.svc.cluster.local`); reject all IP literals, loopbacks, metadata, and K8s API. | [`ADR-017`](../decisions/ADR-017-network-defense-ssrf-allowlist-and-secret-rbac.md) |
| **THR-03** | Blind retry of mutating write operations | Gateway strictly flags timeout errors as non-retryable; zero automatic retries on writes. | [`ADR-011`](../decisions/ADR-011-gateway-dual-mcp-proxy-and-transport-lifecycle.md) |
| **THR-04** | Unattributed upstream execution (Audit bypass) | Two-phase audit: if Phase 1 audit-start record cannot be written, execution terminates immediately. | [`ADR-014`](../decisions/ADR-014-two-phase-audit-logging-and-retention.md) |
| **THR-05** | Memory cgroup starvation (OOMKill) | Enforce 64 KiB argument cap, 1 MiB result cap, 20 global concurrent requests, and single Node.js runtime. | [`ADR-015`](../decisions/ADR-015-concurrency-limits-circuit-breaker-and-resilience.md) |
| **THR-06** | Orphaned Kubernetes Secrets | Two-phase compensation workflow: deletes Secret if SQLite commit fails. | [`ADR-017`](../decisions/ADR-017-network-defense-ssrf-allowlist-and-secret-rbac.md) |
| **THR-07** | Customer PII exposure to AI agents | Preserve Phase 3 five-tool output projections; CRM mock uses strictly synthetic data with `@example.mock`. | [`ADR-008`](../decisions/ADR-008-five-tool-contract-and-pii-redaction.md), [`ADR-018`](../decisions/ADR-018-upstream-mock-contracts-crm-and-tasks.md) |

---

## 6. Worker Governance Statement & Handoff

In accordance with strict Technical Head instructions:
- **Authorized Gate:** `G1 — Architecture Decisions and Contracts`
- **Actions Executed:** Audited existing ADRs (ADR-001 through ADR-010), authored uniquely numbered ADRs (ADR-011 through ADR-018), and compiled the master Decision Register and TypeScript/Zod schemas.
- **Prohibited Actions Adhered To:** Zero code implemented, zero workloads deployed, zero Secrets modified, zero Helm charts updated, zero mutating tests run.

**Technical Head review requested; next gate (G2 — CRM and Tasks Mock Services) not started.**
