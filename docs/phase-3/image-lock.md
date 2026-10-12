# Phase 3 Container Image & Version Lock

**Document Type:** Formal Version Lock & Compatibility Record  
**Phase:** Phase 3 (Custom WooCommerce MCP Server on Kubernetes)  
**Host Architecture:** `x86_64` (`linux/amd64`)  
**Date Locked:** 12 October 2026 (Remediated: 12 October 2026)  

---

## 1. Locked Container Images

| Component | Repository & Tag | Platform | Image ID / Config SHA256 | Registry Manifest Digest | Notes / Selection Rationale |
|---|---|---|---|---|---|
| **MCP Base Runtime** | `node:24-alpine` | `linux/amd64` | `sha256:7bc03cf84ddae0b...` | `sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1` | Pinned Alpine base for Node.js 24 (`v24.21.0`), matching `.nvmrc` (`v24.20.0` series) with minimal security surface. |
| **WooCommerce MCP Server** | `urumi-woocommerce-mcp:1.0.0` | `linux/amd64` | `sha256:d831a5b6b4c3b21c6d930eece6e484c4ccebcbbcdf9bf00ccea98c61eb9fee6a` | *N/A (Local build, unpushed)* | Multi-stage production build; non-root user `mcpuser` (UID 10001); size 187 MB. Pinned semantic version `1.0.0`. |

---

## 2. Image Identity & Digest Reconciliation (Remediation)

### 2.1 Image ID vs. Distribution Manifest Digest
- **Built Image ID (Config Hash):** `sha256:d831a5b6b4c3b21c6d930eece6e484c4ccebcbbcdf9bf00ccea98c61eb9fee6a`. This is the local Docker image configuration JSON checksum (`docker inspect --format '{{.Id}}'`).
- **Registry Manifest Digest (`RepoDigests`):** Empty array (`[]`). Because `urumi-woocommerce-mcp:1.0.0` is built locally and imported directly into the `k3d-urumi` cluster via `k3d image import`, it does not reside on a remote distribution registry and has no OCI distribution manifest digest.
- **CRI / containerd Resolution:** In containerd, passing an `@sha256:...` reference instructs the runtime to query a distribution registry manifest. Because no registry exists for this local image, referencing the config hash as an image digest causes `ErrImagePull` (`pull access denied, repository does not exist`).

### 2.2 Reconciled Helm Configuration
The image reference has been reconciled across all Helm values profiles:
- **`values.yaml` (Base):** `image: "urumi-woocommerce-mcp:1.0.0"`, `digest: ""` (removed previous unverified placeholder `sha256:989be8...`).
- **`values-local.yaml` (Local k3d):** `image: "urumi-woocommerce-mcp:1.0.0"`, `digest: ""`, `imagePullPolicy: "IfNotPresent"`.
- **`values-prod.yaml` (Production-like):** `image: "urumi-woocommerce-mcp:1.0.0"`, `digest: ""`, `imagePullPolicy: "IfNotPresent"`.

Both local and production-like profiles render `image: "urumi-woocommerce-mcp:1.0.0"`, resolving deterministically to local containerd image ID `sha256:d831a5b6b4c3b21c6d930eece6e484c4ccebcbbcdf9bf00ccea98c61eb9fee6a`.

---

## 3. Pinned Application & Protocol Dependencies

| Component | Pinned Version | Scope | Purpose / Verification Boundary |
|---|---|---|---|
| **Node.js Runtime** | `24.21.0` | Container Runtime | Linux Alpine Node 24 runtime; matches `.nvmrc` development series. |
| **@modelcontextprotocol/sdk** | `1.32.1` | Application Dependency | Official Model Context Protocol TypeScript SDK; stateless Streamable HTTP transport. |
| **express** | `4.21.2` | Application Dependency | Production web server hosting `/health` and Streamable HTTP `/mcp`. |
| **zod** | `3.24.2` | Application Dependency | Strict schema validation for environment configuration, tool inputs, and upstream responses. |
| **npm CLI** | `11.19.0` | Build Stage | Pinned in development and base image for deterministic package locking via `package-lock.json`. |

---

## 4. Container Security Context & Runtime Specifications

1. **User Identity & Linux Capabilities**:
   - Runtime UID/GID: `10001:10001` (`mcpuser:mcpuser`).
   - `runAsNonRoot: true`, `allowPrivilegeEscalation: false`.
   - Linux capabilities: `drop: ["ALL"]`.
   - Seccomp profile: `RuntimeDefault`.
2. **Layer Pruning & Content Boundary**:
   - Zero `.ts` source files, tests, test fixtures, `.env`, `.secrets`, `.git`, or development dependencies in runtime layer.
   - Verified via container filesystem audit (`ls -la /app`: `dist`, `node_modules`, `package.json`).
3. **Signal Handling**:
   - Node process receives `SIGTERM` and shuts down with exit code 0 within its configured 30-second grace period.
