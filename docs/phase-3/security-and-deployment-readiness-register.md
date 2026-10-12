# Security & Deployment-Readiness Register

**Document Type:** Formal Risk & Deployment-Readiness Register  
**Gate:** G8 (Documentation & Phase 4 Sign-Off)  
**Component:** Platform-Wide (`infra/helm/urumi-platform`, `apps/woocommerce-mcp`)  
**Date:** 2026-10-13  
**Status:** Active Governance Record  

---

## 1. Overview & Purpose

This register establishes a strict, auditable governance record of technical debt, documented residual risks, and deployment qualifications originating from Gates G6 and G7. It defines explicit **owners**, **closure criteria**, **target milestones**, and **blocking statuses** for all items that must be resolved before production deployment.

---

## 2. Security & Deployment-Readiness Items

### Item SEC-REG-01: Container Registry Publication & Distribution Digest Pinning

| Dimension | Specification |
|---|---|
| **Risk ID** | `SEC-REG-01` |
| **Category** | Deployment Readiness / Image Immutability |
| **Severity** | **HIGH (Blocking for Production Rollout)** |
| **Current State** | Local k3d deployment uses image `urumi-woocommerce-mcp:1.0.0` with `digest: ""` and `imagePullPolicy: IfNotPresent`. Image exists only in local Docker/containerd storage with no remote distribution digest (`RepoDigests: []`). |
| **Technical Risk** | A clean production cluster or multi-node VPS will fail to pull this image (`ErrImagePull`). In addition, mutable version tags (e.g. `1.0.0`) can be overwritten, breaking immutability guarantees. |
| **Owner** | DevOps Lead / Platform Engineer |
| **Target Phase** | Phase 7 (Production VPS Deployment & Hardening) |
| **Production Blocker?** | **YES — Production deployment remains blocked until this item is closed.** |
| **Closure Criteria** | 1. Automated CI/CD pipeline builds and pushes image to an authenticated OCI container registry (e.g. GHCR, Docker Hub, or private registry).<br>2. Remote distribution manifest digest (`sha256:...`) is captured from the registry response.<br>3. `values-prod.yaml` is updated with `digest: "@sha256:<digest>"` and `imagePullPolicy: IfNotPresent`.<br>4. Clean deployment on an external node successfully pulls and runs the image via digest. |

---

### Item SEC-REG-02: Transport Layer Security (In-Cluster Transport Encryption)

| Dimension | Specification |
|---|---|
| **Risk ID** | `SEC-REG-02` |
| **Category** | Security / Transport Security |
| **Severity** | **MEDIUM (Accepted for Local Development; Mandatory for Shared Production)** |
| **Current State** | Pod-to-pod HTTP communication inside namespace `urumi` (Gateway to MCP Server, MCP Server to WordPress) travels in plaintext over port 3000 and port 80. |
| **Mitigations Active** | 1. **Cryptographic Authentication:** In-cluster REST API calls utilize RFC 5849 OAuth 1.0a HMAC-SHA256. The shared secret is never transmitted across the network, and payloads cannot be tampered with in transit.<br>2. **Network Isolation:** K3s `kube-router` packet filtering actively drops unauthorized traffic at the pod network interface. |
| **Residual Risk** | Packet sniffing by a compromised node or root process sharing the host network namespace could intercept unencrypted payload data (e.g. order catalog text). |
| **Owner** | Security Architect / Platform Engineer |
| **Target Phase** | Pre-Production Hardening / Service Mesh Evaluation |
| **Production Blocker?** | **CONDITIONAL — Acceptable on dedicated single-node VPS; Blocker for multi-tenant or shared-node environments.** |
| **Closure Criteria** | 1. Option A: Deploy lightweight mTLS (e.g. Linkerd or Istio ambient mesh) with transparent pod-to-pod encryption.<br>2. Option B: Configure internal Apache HTTPS on `urumi-wordpress` with cluster-internal certificates mounted via `cert-manager`. |

---

### Item SEC-REG-03: WooCommerce REST API Credential Least-Privilege Scoping

| Dimension | Specification |
|---|---|
| **Risk ID** | `SEC-REG-03` |
| **Category** | Security / Least Privilege |
| **Severity** | **MEDIUM (Mitigated at Application Layer)** |
| **Current State** | In-cluster WooCommerce API keys generated via WP-CLI operate with `read_write` permissions assigned to user ID 2 (`urumi-mcp-integration`, role `shop_manager`). |
| **Mitigations Active** | **Application Layer Sandboxing:** The custom MCP server exposes strictly the five approved tools (`list_products`, `create_product`, `list_orders`, `get_order`, `update_order_status`). Destructive operations (order deletions, customer modifications, refunds, arbitrary SQL, settings alterations) are physically impossible through the MCP interface. |
| **Residual Risk** | If the Kubernetes Secret `urumi-woocommerce-api` were directly compromised by an attacker, the credentials could be used to execute broader WordPress management actions outside the MCP server. |
| **Owner** | Backend Engineer / WordPress Administrator |
| **Target Phase** | Phase 7 (Production Hardening) |
| **Production Blocker?** | **NO — Application sandboxing and RBAC secret isolation provide defense-in-depth.** |
| **Closure Criteria** | 1. Author a dedicated WordPress plugin/filter (`local-rest-least-privilege.php`) restricting consumer key `urumi-mcp-integration` exclusively to: `GET /wp-json/wc/v3/products`, `POST /wp-json/wc/v3/products`, `GET /wp-json/wc/v3/orders`, `PUT /wp-json/wc/v3/orders/{id}`.<br>2. Verify that calls to `/wp-json/wc/v3/customers` or `DELETE /wp-json/wc/v3/products/{id}` return HTTP 403 Forbidden even with valid keys. |

---

## 3. Deployment-Readiness Status Summary

```
┌─────────────┬─────────────────────────────────┬──────────┬──────────────────────┐
│ Item ID     │ Title                           │ Severity │ Production Status    │
├─────────────┼─────────────────────────────────┼──────────┼──────────────────────┤
│ SEC-REG-01  │ Registry Digest Pinning         │ HIGH     │ BLOCKED (Phase 7)    │
│ SEC-REG-02  │ In-Cluster Transport Encryption │ MEDIUM   │ QUALIFIED (Single)   │
│ SEC-REG-03  │ WooCommerce API Key Scoping     │ MEDIUM   │ MITIGATED (App Sand) │
└─────────────┴─────────────────────────────────┴──────────┴──────────────────────┘
```

> [!IMPORTANT]
> The team acknowledges that Phase 3 deliverables are fully verified for local k3d cluster execution. No production deployment claim will be made until item `SEC-REG-01` is formally closed.
