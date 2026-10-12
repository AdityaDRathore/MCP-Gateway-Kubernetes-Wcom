# ADR-009: Cluster-Internal Workload Isolation, Non-Root Execution, and Conditional NetworkPolicies

**Status**: Accepted  
**Date**: 2026-10-12  
**Decision Makers**: Aditya Rathore (FDE Candidate), Antigravity AI  

---

## 1. Context & Problem Statement

In Phase 3, the custom WooCommerce MCP server (`apps/woocommerce-mcp`) was containerized and integrated into the unified Helm chart (`infra/helm/urumi-platform`).

Two critical security and operational challenges required formal architectural decisions:
1. **The Default-Allow Problem & Ingress Isolation**: In standard Kubernetes networking, any pod within a cluster can route TCP packets to any other pod or `ClusterIP` Service by default. Furthermore, backend integration tools must never be exposed to public ingress controllers. We needed strict, auditable network boundaries ensuring the MCP server is reachable *only* by authorized callers (the Gateway) and can connect *only* to required upstreams (WordPress and CoreDNS).
2. **Local Test Verification vs. Production Attack Surface**: In the local development environment (`k3d-urumi`), automated test suites and ephemeral in-cluster verification pods need to communicate directly with the MCP server to execute acceptance tests. However, leaving a generic `test-client` ingress rule enabled in a production profile would create an insecure bypass vector where any pod labeled `test-client` could circumvent gateway authentication.

---

## 2. Options Considered

### Option A: Standard ClusterIP without NetworkPolicies
- Deploy the MCP server as a `ClusterIP` service with no ingress or external routing.
- Rely solely on Kubernetes internal DNS obscurity.
- **Rejected**: Any pod in the cluster (e.g. compromised guest workloads) can query the MCP server directly, bypassing gateway authentication and audit logging.

### Option B: Static NetworkPolicy Allowing Ingress to Gateway and Test Runners Everywhere
- Define a single `NetworkPolicy` admitting traffic from `app.kubernetes.io/component: gateway` and `app.kubernetes.io/component: test-client`.
- Deploy identical network policies across local and production profiles.
- **Rejected**: Violates production defense-in-depth by baking a permanent test backdoor into production manifests.

### Option C: Conditional NetworkPolicies with Kernel-Level Non-Root Hardening
- Deploy the MCP server strictly as a `ClusterIP` service on port 3000 with zero Ingress or NodePort definitions.
- Enforce non-root execution (`mcpuser`, UID/GID 10001) and drop all Linux capabilities (`drop: ["ALL"]`).
- Author a dedicated `NetworkPolicy` enforced by K3s `kube-router`:
  - Ingress permitted strictly from `app.kubernetes.io/component: gateway`.
  - Ingress from `app.kubernetes.io/component: test-client` conditioned on `.Values.networkPolicy.allowTestClient` (enabled in `values-local.yaml`, strictly disabled in `values-prod.yaml`).
  - Egress restricted strictly to `urumi-wordpress:80` and `kube-dns:53`.

---

## 3. Decision

We adopt **Option C: Conditional NetworkPolicies with Non-Root Hardening**:

1. **Workload Security Context (`templates/mcp-deployment.yaml`)**:
   - The container runs as non-root user `mcpuser:mcpuser` (UID `10001`, GID `10001`).
   - `allowPrivilegeEscalation: false` prevents SUID binary privilege escalation.
   - All Linux kernel capabilities are explicitly dropped (`capabilities.drop: ["ALL"]`).
   - Default seccomp profile is enforced (`seccompProfile.type: RuntimeDefault`).

2. **ClusterIP Service Boundary (`templates/mcp-service.yaml`)**:
   - Service type is strictly `ClusterIP` on port 3000 targeting container port `http` (3000).
   - Zero Ingress routes, zero NodePort allocations, and zero hostPort bindings exist for the MCP server.

3. **Conditional NetworkPolicy (`templates/networkpolicy.yaml`)**:
   - Packet filtering is enforced at the host network interface by K3s `kube-router` (iptables).
   - In the **Production Profile (`values-prod.yaml`)**:
     - `networkPolicy.allowTestClient` defaults to `false`.
     - Ingress to `urumi-woocommerce-mcp` is permitted **exclusively** from pods labeled `app.kubernetes.io/component: gateway`.
     - Generic `test-client` ingress rules are completely omitted from rendered manifests.
   - In the **Local Development Profile (`values-local.yaml`)**:
     - `networkPolicy.allowTestClient` is explicitly set to `true`.
     - Permits ephemeral verification pods (`app.kubernetes.io/component: test-client`) to reach port 3000 for local automated acceptance testing.
   - **Egress Boundary**: The MCP pod can send traffic only to:
     - `app.kubernetes.io/name: wordpress` on port 80/TCP.
     - `k8s-app: kube-dns` on port 53/UDP.
     - Direct egress to `urumi-mariadb:3306` or the external internet is blocked.

---

## 4. Consequences & Limitations

- **Positive**:
  - Enforces zero-trust isolation: unauthorized workloads attempting to reach the MCP server are actively dropped at the packet filter level with connection refused (`curl: (7)`).
  - Eliminates production backdoors by strictly removing test-client exceptions under `values-prod.yaml`.
  - Mitigates container breakout risks via non-root execution and complete capability dropping.
  - Confines MCP pod outbound traffic to WordPress and CoreDNS, preventing lateral movement within the cluster.
- **Limitations**:
  - Requires network plugins that support the Kubernetes `networking.k8s.io/v1` NetworkPolicy API (fully satisfied by K3s `kube-router`).
  - Developers executing manual diagnostic curl requests from arbitrary debug pods must attach label `app.kubernetes.io/component: test-client` (local mode) or execute via the Gateway proxy.
