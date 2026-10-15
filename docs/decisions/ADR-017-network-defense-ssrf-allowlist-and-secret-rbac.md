# ADR-017: Network Defense Boundaries, SSRF URL Allowlisting, Ingress Scope, and Kubernetes Secret RBAC Compensation

**Status**: Accepted  
**Date**: 2026-10-15  
**Decision Makers**: Aditya Rathore (FDE Candidate), Antigravity AI  
**Related Documents**: [`ADR-003`](./ADR-003-secrets-and-access.md), [`ADR-009`](./ADR-009-kubernetes-network-isolation-and-conditional-policies.md)  

---

## 1. Context & Problem Statement

Phase 4 introduces dynamic upstream management: an administrator can register new upstream MCP endpoints at runtime through the gateway’s administration interface.

Allowing dynamic URL inputs introduces severe Server-Side Request Forgery (SSRF) vulnerabilities if unconstrained. An attacker or malicious admin could input `http://169.254.169.254/` (cloud metadata service), `http://kubernetes.default.svc` (Kubernetes API server), `http://urumi-mariadb:3306` (MariaDB protocol injection), or `http://127.0.0.1:3000` (gateway recursion).

Furthermore:
1. Dynamic upstream credentials entered by operators must reside in Kubernetes Secrets rather than SQLite, but Kubernetes Secrets and SQLite cannot participate in a shared atomic transaction (Two-Phase Commit).
2. The public ingress boundary must be strictly limited to the downstream MCP endpoint (`POST /mcp`); administrative routes (`/admin/v1/*`) must remain strictly private.

---

## 2. Decision

### 2.1 Strict Internal URL Allowlist & SSRF Defense
All upstream `endpoint_url` values submitted during registration or update are validated against strict defense-in-depth rules before admission:

1. **Protocol & Hostname Allowlist**:
   - Scheme must be strictly `http://`.
   - Hostname must match the cluster internal DNS format:
     `^http:\/\/([a-z0-9-]+)\.urumi\.svc\.cluster\.local(?::[0-9]{2,5})?\/mcp$`
   - Or explicitly allowlisted service hostnames: `urumi-woocommerce-mcp`, `urumi-mcp-crm`, `urumi-mcp-tasks`.
2. **Explicit Blocklist & Denied Targets**:
   - **IP Literals**: IPv4 addresses, IPv6 addresses, CIDR ranges are strictly rejected.
   - **Loopback**: `127.0.0.1`, `localhost`, `::1` rejected.
   - **Link-Local & Cloud Metadata**: `169.254.169.254`, `metadata.google.internal`, AWS metadata endpoints rejected.
   - **Control Plane**: `kubernetes`, `kubernetes.default`, `kubernetes.default.svc.cluster.local` rejected.
   - **Store Workloads Directly**: `urumi-mariadb`, `urumi-wordpress` rejected! (Gateway must **never** connect to WordPress or MariaDB directly; it communicates exclusively through `urumi-woocommerce-mcp:3000`).
   - **Gateway Itself**: `urumi-gateway` rejected to prevent recursive loopbacks.
3. **URL Sanitization**:
   - Userinfo (`http://user:pass@host`) rejected.
   - URL fragments (`#hash`) rejected.
   - Query parameter credentials rejected.
   - HTTP redirect following is strictly disabled (`maxRedirects: 0`).

### 2.2 Public Ingress vs Private Administration Boundary
- **Public Ingress**:
  - Exclusively `POST /mcp` (under `dashboard.127.0.0.1.nip.io:8080/mcp` or gateway route).
  - Requires valid `Authorization: Bearer <user_api_key>`.
- **Private Administration Surface**:
  - Administration routes (`/admin/v1/*`): upstreams management, user creation, key revocation, system audit logs.
  - Ingress configuration **omits** all `/admin/v1/*` routes; external traffic attempting to hit `/admin/v1/*` is rejected by Traefik Ingress.
  - Route-level middleware enforces role `admin`. Inbound member requests receive **HTTP 403 Forbidden**.

### 2.3 Kubernetes Secret Lifecycle & Two-Phase Compensation Workflow
Dynamic upstream credentials (e.g. bearer tokens, custom header secrets) are stored in Kubernetes Secrets in a dedicated namespace:

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Administrator
    participant GW as Gateway Control Plane
    participant K8S as K8s API (urumi-gateway-secrets)
    participant DB as SQLite (gateway.db)

    Admin->>GW: POST /admin/v1/upstreams (with credential)
    GW->>GW: Validate Input & SSRF URL Allowlist
    GW->>GW: Generate Secret Name (upstream-sec-<slug>-<uid>)
    GW->>K8S: Create Secret in 'urumi-gateway-secrets'
    alt Secret Creation Fails
        K8S-->>GW: Error
        GW-->>Admin: HTTP 500 / SecretProvisioningError
    else Secret Creation Succeeds
        GW->>DB: INSERT into upstreams (secret_ref_name, secret_ref_key)
        alt DB Insert Fails
            DB-->>GW: SQLite Error (Disk Full / Constraint)
            GW->>K8S: COMPENSATION: DELETE Secret (upstream-sec-<slug>-<uid>)
            GW-->>Admin: HTTP 500 / DatabaseTransactionError (Secret Cleaned Up)
        else DB Insert Succeeds
            GW-->>Admin: HTTP 201 Created (Zero Credential in Response)
        end
    end
```

#### Compensation Rules:
1. **Creation Failure Compensation**: If the Kubernetes Secret is successfully created but the subsequent SQLite insert fails, the gateway immediately issues an asynchronous `DELETE` to the Kubernetes API to prune the orphaned Secret.
2. **Deletion Flow**: When an upstream is deleted:
   - Step 1: Invalidate memory catalog and drain in-flight calls.
   - Step 2: Delete Kubernetes Secret.
   - Step 3: Delete SQLite upstream record.
   - If Secret deletion fails, SQLite record is marked `status = 'cleanup_required'` to alert operators rather than leaving unmanaged orphan credentials.

### 2.4 Least-Privilege Kubernetes RBAC
- Dedicated Namespace: **`urumi-gateway-secrets`**.
- Dedicated ServiceAccount: **`urumi-gateway-sa`**.
- Namespaced `Role` and `RoleBinding` scoped strictly to `urumi-gateway-secrets`:
  ```yaml
  apiVersion: rbac.authorization.k8s.io/v1
  kind: Role
  metadata:
    name: urumi-gateway-secret-manager
    namespace: urumi-gateway-secrets
  rules:
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["get", "create", "update", "delete"]
  ```
- The ServiceAccount has zero permissions in `default`, `kube-system`, or `urumi` namespaces, physically preventing cross-tenant secret leakage.

---

## 3. Consequences & Verification
- **Positive**: Complete SSRF prevention, leak-free secret management, automated orphan cleanup, strict ingress surface.
- **Negative**: Dynamic upstreams are restricted to approved internal cluster Services.
- **Verification**: Verified via synthetic SSRF attack test suite, compensation failure injection tests, and negative RBAC authorization tests.
