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
```

### 2.2 Canonical URL Validation Test Matrix (Positive & Negative Test Cases)

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

### 2.3 Kubernetes Secret Lifecycle & RBAC Architecture

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
  verbs: ["get", "create", "update", "delete"]

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

#### Negative RBAC Guarantees:
- `urumi-gateway-sa` has **zero Secret permissions** in `urumi`, `default`, `kube-system`, or any other namespace.
- It cannot read `urumi-store-secrets` (MariaDB root password) or `urumi-woocommerce-api` (WooCommerce consumer key/secret).

---

### 2.4 Distributed Compensation Workflow & Crash Recovery

Because Kubernetes etcd and the gateway's SQLite database cannot share a two-phase distributed transaction, the gateway implements a Saga pattern with automatic startup reconciliation:

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Administrator
    participant GW as Gateway Control Plane
    participant K8S as K8s API (urumi-gateway-secrets)
    participant DB as SQLite (gateway.db)

    Admin->>GW: POST /admin/v1/upstreams (with credential)
    GW->>GW: Validate Input & SSRF URL via canonical parser
    GW->>GW: Generate Secret Name (upstream-sec-<slug>-<uid>)
    GW->>K8S: Create Secret with labels & annotations
    alt K8s Secret Creation Fails
        K8S-->>GW: Error (RBAC / Quota / Unreachable)
        GW-->>Admin: HTTP 500 / SecretProvisioningError
    else K8s Secret Creation Succeeds
        GW->>DB: INSERT into upstreams (secret_ref_name, secret_ref_key)
        alt SQLite Commit Fails (Disk Full / Constraint Error / Process Crash)
            DB-->>GW: SQLite Error
            GW->>K8S: COMPENSATION: DELETE Secret (upstream-sec-<slug>-<uid>)
            GW-->>Admin: HTTP 500 / DatabaseTransactionError
        else SQLite Commit Succeeds
            GW-->>Admin: HTTP 201 Created (Zero Credential in Response)
        end
    end
```

#### Crash & Orphan Secret Reconciliation (Startup & Background):
1. **Labeling Contract**: Every dynamically created Secret is created with:
   - `labels: { "app.kubernetes.io/managed-by": "urumi-gateway" }`
   - `annotations: { "urumi.io/created-at": "<epoch_ms>", "urumi.io/upstream-slug": "<slug>" }`
2. **Reconciliation Procedure (`reconcileOrphanedSecrets()`)**:
   - Executed once at gateway pod startup and periodically every 15 minutes.
   - Lists all Secrets in `urumi-gateway-secrets` matching `app.kubernetes.io/managed-by: urumi-gateway`.
   - Queries SQLite `SELECT secret_ref_name FROM upstreams WHERE secret_ref_name IS NOT NULL;`.
   - Any Secret present in Kubernetes but absent from SQLite that was created more than **60 seconds ago** is an orphan resulting from a crash between Secret creation and SQLite commit.
   - The reconciliation job deletes the orphan Secret and logs an operational audit event.

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
