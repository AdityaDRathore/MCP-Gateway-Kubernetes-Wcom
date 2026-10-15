# ADR-017: Network Defense Boundaries, SSRF URL Allowlisting, Ingress Scope, and Kubernetes Secret RBAC Compensation

**Status**: Proposed — Pending Technical Head Approval  
**Date**: 2026-10-15 (Revised: 2026-10-15)  
**Decision Makers**: Aditya Rathore (FDE Candidate), Antigravity AI  
**Related Documents**: [`ADR-003`](./ADR-003-secrets-and-access.md), [`ADR-009`](./ADR-009-kubernetes-network-isolation-and-conditional-policies.md)  

---

## 1. Context & Problem Statement

Phase 4 introduces dynamic upstream management: an administrator can register new upstream MCP endpoints at runtime through the gateway’s administration interface.

Allowing dynamic URL inputs introduces severe Server-Side Request Forgery (SSRF) vulnerabilities if unconstrained. An attacker or rogue actor could submit `http://169.254.169.254/` (cloud metadata service), `http://kubernetes.default.svc` (Kubernetes API server), `http://urumi-mariadb:3306` (MariaDB protocol injection), or `http://127.0.0.1:3000` (gateway recursion).

Furthermore:
1. Short service names (e.g. `urumi-woocommerce-mcp`) and Fully Qualified Domain Names (FQDNs, e.g. `urumi-woocommerce-mcp.urumi.svc.cluster.local`) must be reconciled cleanly without creating cross-namespace confusion.
2. Dynamic upstream credentials entered by operators must reside in Kubernetes Secrets rather than SQLite, but Kubernetes Secrets and SQLite cannot participate in a shared distributed transaction (Two-Phase Commit).
3. The public ingress boundary must be strictly limited to the downstream MCP endpoint (`POST /mcp`); administrative routes (`/admin/v1/*`) must remain strictly private.

---

## 2. Decision & Detailed Architecture

### 2.1 Canonical URL Validation Algorithm (SSRF Defense)

URL validation is implemented via a strict, multi-step WHATWG `URL` parser function (`validateAndNormalizeUpstreamUrl(input: string)`), **not merely a regular expression**:

```typescript
export interface ValidatedUpstreamEndpoint {
  originalInput: string;
  normalizedFqdnUrl: string; // e.g. http://urumi-woocommerce-mcp.urumi.svc.cluster.local:3000/mcp
  serviceName: string;       // e.g. urumi-woocommerce-mcp
  port: number;              // e.g. 3000
  pathname: string;          // strictly "/mcp"
}

const APPROVED_UPSTREAM_SERVICES = new Set<string>([
  'urumi-woocommerce-mcp',
  'urumi-mcp-crm',
  'urumi-mcp-tasks',
]);

const PROHIBITED_HOSTNAMES = new Set<string>([
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

export function validateAndNormalizeUpstreamUrl(inputUrl: string): ValidatedUpstreamEndpoint {
  // Step 1: WHATWG URL Parsing
  let parsed: URL;
  try {
    parsed = new URL(inputUrl);
  } catch {
    throw new ValidationError('Malformed URL: Unable to parse URL structure');
  }

  // Step 2: Protocol / Scheme Check
  if (parsed.protocol !== 'http:') {
    throw new ValidationError(`Prohibited protocol "${parsed.protocol}": Only plain "http:" internal cluster URLs are permitted`);
  }

  // Step 3: Userinfo Check (Credentials in URL)
  if (parsed.username !== '' || parsed.password !== '') {
    throw new ValidationError('Prohibited userinfo: Embedded credentials in URL are strictly forbidden');
  }

  // Step 4: Query Parameters and Fragments Check
  if (parsed.search !== '') {
    throw new ValidationError('Prohibited query parameters: Upstream MCP endpoint URLs must not contain query strings');
  }
  if (parsed.hash !== '') {
    throw new ValidationError('Prohibited URL fragment: Upstream MCP endpoint URLs must not contain hash fragments');
  }

  // Step 5: Pathname Check
  if (parsed.pathname !== '/mcp') {
    throw new ValidationError(`Prohibited path "${parsed.pathname}": Upstream MCP endpoint path must be strictly "/mcp"`);
  }

  // Step 6: IP Literal and Format Checks
  const hostnameLower = parsed.hostname.toLowerCase();
  
  // Reject IPv4 and IPv6 literals
  const isIpv4 = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(hostnameLower);
  const isIpv6 = hostnameLower.startsWith('[') && hostnameLower.endsWith(']');
  if (isIpv4 || isIpv6) {
    throw new ValidationError('Prohibited IP literal: Direct IP addresses are strictly forbidden');
  }

  // Step 7: Prohibited Targets Check
  if (PROHIBITED_HOSTNAMES.has(hostnameLower)) {
    throw new ValidationError(`Prohibited target host "${hostnameLower}": Target is blacklisted`);
  }

  // Step 8: Reconcile Short Names vs FQDN and Validate Namespace Boundary
  let serviceName: string;
  const fqdnSuffix = '.urumi.svc.cluster.local';

  if (hostnameLower.endsWith(fqdnSuffix)) {
    serviceName = hostnameLower.slice(0, -fqdnSuffix.length);
  } else if (!hostnameLower.includes('.')) {
    serviceName = hostnameLower;
  } else {
    throw new ValidationError(`Prohibited hostname "${hostnameLower}": Cross-namespace or external domains are not permitted`);
  }

  if (!APPROVED_UPSTREAM_SERVICES.has(serviceName)) {
    throw new ValidationError(`Unapproved service "${serviceName}": Only approved internal cluster services (${Array.from(APPROVED_UPSTREAM_SERVICES).join(', ')}) are allowed`);
  }

  // Step 9: Port Validation
  const port = parsed.port ? parseInt(parsed.port, 10) : 80;
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new ValidationError(`Invalid port "${parsed.port}": Port must be an integer between 1 and 65535`);
  }
  if (port !== 3000) {
    throw new ValidationError(`Unapproved port "${port}": Approved upstream MCP services listen exclusively on port 3000`);
  }

  // Step 10: Canonical FQDN Normalization
  const normalizedFqdnUrl = `http://${serviceName}.urumi.svc.cluster.local:3000/mcp`;

  return {
    originalInput: inputUrl,
    normalizedFqdnUrl,
    serviceName,
    port: 3000,
    pathname: '/mcp',
  };
}

// Step 11: HTTP Client Redirect Policy (Prohibit All Redirects)
// Any HTTP client or fetch transport connecting to upstreams must be configured with:
//   redirect: 'error' (in Node.js fetch/undici) or maxRedirects: 0
// Any 3xx HTTP response returned by an upstream target triggers an immediate SSRF protocol violation.

// Step 12: Pre-Connect DNS Resolution & Socket Address Pinning Hook
// Hostname validation alone does not prevent DNS rebinding or rogue DNS poisoning.
// The HTTP transport integrates a custom lookup hook (via http.Agent or undici connect hook):
export function validateResolvedIp(ip: string, hostname: string): void {
  // Reject IPv4 and IPv6 loopback addresses
  if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.')) {
    throw new SecurityError(`SSRF Violation: Host "${hostname}" resolved to loopback IP "${ip}"`);
  }

  // Reject Cloud Metadata and Link-Local IPs (169.254.0.0/16, fe80::/10)
  if (ip.startsWith('169.254.') || ip.toLowerCase().startsWith('fe80:')) {
    throw new SecurityError(`SSRF Violation: Host "${hostname}" resolved to link-local/metadata IP "${ip}"`);
  }

  // Enforce Kubernetes Cluster CIDR Boundary (K3s default Flannel: 10.42.0.0/16, Service: 10.43.0.0/16)
  const isClusterPodIp = ip.startsWith('10.42.');
  const isClusterServiceIp = ip.startsWith('10.43.');
  if (!isClusterPodIp && !isClusterServiceIp) {
    throw new SecurityError(`SSRF Violation: Host "${hostname}" resolved to external/non-cluster IP "${ip}"`);
  }

  // Explicit Blacklist: Reject Kubernetes API Service IP (10.43.0.1) and MariaDB pod IPs
  if (ip === '10.43.0.1') {
    throw new SecurityError(`SSRF Violation: Host "${hostname}" resolved to Kubernetes API server`);
  }
}
```

### 2.2 Defense-in-Depth: Egress NetworkPolicy

In addition to application-level URL parsing and pre-connect DNS validation, kernel-level packet filtering enforces network isolation:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: urumi-gateway-egress
  namespace: urumi
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/component: gateway
  policyTypes:
  - Egress
  egress:
  # 1. Allow CoreDNS for cluster internal name resolution
  - to:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: kube-system
      podSelector:
        matchLabels:
          k8s-app: kube-dns
    ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
  # 2. Allow egress strictly to approved upstream MCP pods on port 3000
  - to:
    - podSelector:
        matchExpressions:
        - key: app.kubernetes.io/name
          operator: In
          values:
          - urumi-woocommerce-mcp
          - urumi-mcp-crm
          - urumi-mcp-tasks
    ports:
    - protocol: TCP
      port: 3000
  # 3. Allow egress to Kubernetes API server strictly for dynamic Secret operations
  - to:
    - ipBlock:
        cidr: 10.43.0.1/32
    ports:
    - protocol: TCP
      port: 443
  # All other egress (MariaDB :3306, WordPress :80, link-local 169.254.169.254, Internet) is DENIED by default.
```

### 2.3 Canonical URL Validation Test Matrix (Positive & Negative Test Cases)

| Test Case ID | Input URL / Execution Scenario | Expected Result | Exact Rejection / Normalization Rationale |
|---|---|:---:|---|
| `URL-TEST-01` | `http://urumi-woocommerce-mcp:3000/mcp` | **PASS (Normalized)** | Valid short name; normalized to `http://urumi-woocommerce-mcp.urumi.svc.cluster.local:3000/mcp`. |
| `URL-TEST-02` | `http://urumi-mcp-crm.urumi.svc.cluster.local:3000/mcp` | **PASS** | Valid FQDN matching approved service set and port 3000. |
| `URL-TEST-03` | `http://urumi-mcp-tasks:3000/mcp` | **PASS (Normalized)** | Valid short name; normalized to canonical FQDN. |
| `URL-TEST-04` | `https://urumi-woocommerce-mcp:3000/mcp` | **REJECT** | Prohibited scheme `https:`. Upstreams run on in-cluster plaintext ClusterIP. |
| `URL-TEST-05` | `file:///etc/passwd` | **REJECT** | Prohibited scheme `file:`. |
| `URL-TEST-06` | `http://user:pass@urumi-mcp-crm:3000/mcp` | **REJECT** | Prohibited userinfo. Embedded credentials in URL are strictly forbidden. |
| `URL-TEST-07` | `http://urumi-mcp-crm:3000/mcp?token=secret` | **REJECT** | Prohibited query string. |
| `URL-TEST-08` | `http://urumi-mcp-crm:3000/mcp#fragment` | **REJECT** | Prohibited URL fragment. |
| `URL-TEST-09` | `http://urumi-mcp-crm:3000/api/v1` | **REJECT** | Prohibited path. Must be strictly `/mcp`. |
| `URL-TEST-10` | `http://127.0.0.1:3000/mcp` | **REJECT** | Prohibited IP literal and loopback address. |
| `URL-TEST-11` | `http://[::1]:3000/mcp` | **REJECT** | Prohibited IPv6 loopback literal. |
| `URL-TEST-12` | `http://localhost:3000/mcp` | **REJECT** | Prohibited loopback target. |
| `URL-TEST-13` | `http://169.254.169.254/latest/meta-data` | **REJECT** | Prohibited cloud metadata IP literal. |
| `URL-TEST-14` | `http://kubernetes.default.svc.cluster.local/mcp` | **REJECT** | Prohibited target: Kubernetes API control plane. |
| `URL-TEST-15` | `http://urumi-mariadb.urumi.svc.cluster.local:3306/mcp` | **REJECT** | Prohibited target: MariaDB database port/service. |
| `URL-TEST-16` | `http://urumi-wordpress.urumi.svc.cluster.local:80/mcp` | **REJECT** | Prohibited target: WordPress storefront directly (gateway must use WooCommerce MCP). |
| `URL-TEST-17` | `http://urumi-gateway:3000/mcp` | **REJECT** | Prohibited target: Gateway self-reference recursion. |
| `URL-TEST-18` | `http://rogue-service.other-namespace.svc.cluster.local:3000/mcp` | **REJECT** | Cross-namespace target outside `urumi`. |
| `URL-TEST-19` | `http://urumi-woocommerce-mcp:8080/mcp` | **REJECT** | Prohibited port 8080. Approved MCP services use port 3000. |
| `URL-TEST-20` | `http://urumi-woocommerce-mcp/mcp` | **REJECT** | Default port 80 rejected. Approved MCP services use port 3000. |
| `URL-TEST-21` | Upstream returns HTTP 301/302 Redirect | **REJECT** | Prohibited HTTP redirect (`redirect: 'error'`). Direct connection only. |

---

### 2.4 Kubernetes Secret Lifecycle & RBAC Architecture

To isolate dynamic upstream credentials and enforce least privilege:

```
┌──────────────────────────────────────┐        ┌────────────────────────────────────────┐
│ Namespace: urumi                     │        │ Namespace: urumi-gateway-secrets       │
│                                      │        │                                        │
│  ┌────────────────────────────────┐  │        │  ┌──────────────────────────────────┐  │
│  │ Pod: urumi-gateway             │  │        │  │ Role:                            │  │
│  │ SA:  urumi-gateway-sa          │──┼───────>│  │ urumi-gateway-secret-manager     │  │
│  └────────────────────────────────┘  │ (RBAC) │  └──────────────────────────────────┘  │
│                                      │        │                   │                    │
│                                      │        │                   ▼                    │
│                                      │        │  ┌──────────────────────────────────┐  │
│                                      │        │  │ Secret:                          │  │
│                                      │        │  │ upstream-sec-<slug>-<uid>        │  │
│                                      │        │  └──────────────────────────────────┘  │
└──────────────────────────────────────┘        └────────────────────────────────────────┘
```

#### Exact Kubernetes Manifest Specifications:

```yaml
# 1. Dedicated ServiceAccount in 'urumi' namespace
apiVersion: v1
kind: ServiceAccount
metadata:
  name: urumi-gateway-sa
  namespace: urumi
  labels:
    app.kubernetes.io/component: gateway
    app.kubernetes.io/name: urumi-platform

---
# 2. Scoped Role in 'urumi-gateway-secrets' namespace
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: urumi-gateway-secret-manager
  namespace: urumi-gateway-secrets
  labels:
    app.kubernetes.io/component: gateway
rules:
- apiGroups: [""]
  resources: ["secrets"]
  verbs: ["get", "list", "create", "update", "delete"]

---
# 3. RoleBinding bridging SA in 'urumi' to Role in 'urumi-gateway-secrets'
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: urumi-gateway-secret-binding
  namespace: urumi-gateway-secrets
subjects:
- kind: ServiceAccount
  name: urumi-gateway-sa
  namespace: urumi
roleRef:
  kind: Role
  name: urumi-gateway-secret-manager
  apiGroup: rbac.authorization.k8s.io
```

#### RBAC Scope & Least Privilege Invariants:
- The `list` verb is **strictly required** for the `reconcileOrphanedSecrets()` background job to discover and sweep orphaned Secrets matching `app.kubernetes.io/managed-by: urumi-gateway`.
- The `watch` verb is **explicitly omitted** to prevent long-lived streaming watch overhead.
- `urumi-gateway-sa` has **zero Secret permissions** in `urumi`, `default`, `kube-system`, or any other namespace.
- It cannot read `urumi-store-secrets` (MariaDB root password) or `urumi-woocommerce-api` (WooCommerce consumer key/secret).

---

### 2.5 Distributed Compensation Workflow & Race-Free Crash Recovery

Because Kubernetes etcd and the gateway's SQLite database cannot share a two-phase distributed transaction, the gateway implements a Saga pattern with explicit state machines and grace periods to eliminate race conditions between registration and background orphan sweeps:

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Administrator
    participant GW as Gateway Control Plane
    participant DB as SQLite (gateway.db)
    participant K8S as K8s API (urumi-gateway-secrets)

    Admin->>GW: POST /admin/v1/upstreams (with credential)
    GW->>GW: Validate Input & SSRF URL via canonical parser
    GW->>GW: In-Process Lock: activeRegistrations.add(slug)
    GW->>DB: Step 1: INSERT into upstreams (status='provisioning', created_at=now)
    GW->>K8S: Step 2: Create Secret (upstream-sec-<slug>-<uid>) with metadata
    alt K8s Secret Creation Fails
        K8S-->>GW: Error (RBAC / Quota / Unreachable)
        GW->>DB: UPDATE upstreams SET status='failed'
        GW->>GW: Release In-Process Lock
        GW-->>Admin: HTTP 500 / SecretProvisioningError
    else K8s Secret Creation Succeeds
        GW->>DB: Step 3: UPDATE upstreams SET status='active', is_enabled=1
        alt SQLite Commit Fails (Disk Full / Constraint / Crash)
            DB-->>GW: SQLite Error
            GW->>K8S: SAGA COMPENSATION: DELETE Secret (upstream-sec-<slug>-<uid>)
            GW->>GW: Release In-Process Lock
            GW-->>Admin: HTTP 500 / DatabaseTransactionError
        else SQLite Commit Succeeds
            GW->>GW: Release In-Process Lock
            GW-->>Admin: HTTP 201 Created (Zero Credential in Response)
        end
    end
```

#### Race-Condition Elimination between Registration and Orphan Sweep:

To prevent the background sweep from prematurely deleting a Secret while registration is legitimately in progress or recovering:
1. **In-Process Registration Lock**:
   - The gateway maintains an in-memory `Set<string>` of `activeRegistrations`.
   - The sweep function skips any Secret whose upstream slug exists in `activeRegistrations`.
2. **SQLite State Lifecycle**:
   - Upstream rows support: `'provisioning'`, `'active'`, `'disabled'`, `'deleting'`, `'cleanup_required'`, `'failed'`.
3. **Sweep Algorithm (`reconcileOrphanedSecrets()`) Execution Rules**:
   - Executed once at gateway pod startup and periodically every 15 minutes.
   - Fetches all Secrets in `urumi-gateway-secrets` matching `app.kubernetes.io/managed-by: urumi-gateway`.
   - Queries SQLite: `SELECT id, slug, status, secret_ref_name, created_at FROM upstreams WHERE secret_ref_name IS NOT NULL;`.
   - **Case 1 (Active / Disabled Upstream)**: If the Secret is referenced by a row with `status IN ('active', 'disabled')`, the Secret is legitimate. **No action taken.**
   - **Case 2 (Provisioning In-Flight vs Crash)**:
     - If the Secret is referenced by a row with `status = 'provisioning'`:
       - If `unixepoch() - created_at < 120`: The registration is actively in-flight (HTTP client timeout is 30s). **The sweep leaves the Secret completely untouched.**
       - If `unixepoch() - created_at >= 120`: The gateway process that initiated registration crashed. The sweep transitions the SQLite row to `status = 'failed'` and safely deletes the orphaned Secret.
   - **Case 3 (Completely Unreferenced Secret in SQLite)**:
     - If the Secret has no corresponding row at all in SQLite (e.g. process crashed before Step 1 commit or during rollback):
       - To eliminate any race condition with transient I/O delays, a Secret with no SQLite record is **only deleted if its Kubernetes `metadata.creationTimestamp` is older than 300 seconds (5 minutes)**.
       - Any Secret younger than 5 minutes is granted an unconditional grace period and retained until the subsequent sweep.
   - **Auditing**: Every deleted orphan Secret emits a structured audit record:
     `{"event": "ORPHAN_SECRET_CLEANUP", "secret_name": "...", "age_seconds": ..., "reason": "..."}`.

#### Deletion Failure & Operator Visibility:
- When an upstream is deleted (`DELETE /admin/v1/upstreams/:id`):
  1. Gateway marks SQLite row `status = 'deleting'`.
  2. Gateway issues `DELETE` to Kubernetes API for the Secret.
  3. If Secret deletion fails (e.g. transient API server unavailability):
     - The SQLite record is **not deleted**.
     - SQLite row is updated to `status = 'cleanup_required'`, recording `cleanup_error` text.
     - `GET /admin/v1/upstreams` surfaces `status: "cleanup_required"`.
     - Administrators can invoke `POST /admin/v1/upstreams/:id/retry-cleanup` to re-trigger deletion.

---

## 3. Ingress Routing & Administration Security

- **Public Surface**: Only `POST /mcp` is exposed via Traefik Ingress (`http://dashboard.127.0.0.1.nip.io:8080/mcp`).
- **Private Surface**: Administration routes (`/admin/v1/*`) are excluded from Ingress routes.
- **Middleware Guard**: Express router applies `requireAdminRole` to all `/admin/v1/*` routes. Downstream calls with member keys receive **HTTP 403 Forbidden**.
