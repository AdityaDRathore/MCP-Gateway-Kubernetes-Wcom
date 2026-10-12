# Phase 3 Container Image & Version Lock

**Document Type:** Formal Version Lock & Compatibility Record  
**Phase:** Phase 3 (Custom WooCommerce MCP Server on Kubernetes)  
**Host Architecture:** `x86_64` (`linux/amd64`)  
**Date Locked:** 12 October 2026  

---

## 1. Locked Container Images

| Component | Repository & Tag | Platform | Digest (SHA256) | Notes / Selection Rationale |
|---|---|---|---|---|
| **MCP Base Runtime** | `node:24-alpine` | `linux/amd64` | `sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1` | Pinned Alpine base for Node.js 24 (`v24.21.0`), matching `.nvmrc` (`v24.20.0` series) with minimal security surface. |
| **WooCommerce MCP Server** | `urumi-woocommerce-mcp:1.0.0` | `linux/amd64` | `sha256:d831a5b6b4c3b21c6d930eece6e484c4ccebcbbcdf9bf00ccea98c61eb9fee6a` | Multi-stage production build; non-root user `mcpuser` (UID 10001); size 187 MB. Contains only compiled `dist/` and production `node_modules/`. |

---

## 2. Pinned Application & Protocol Dependencies

| Component | Pinned Version | Scope | Purpose / Verification Boundary |
|---|---|---|---|
| **Node.js Runtime** | `24.21.0` | Container Runtime | Linux Alpine Node 24 runtime; matches `.nvmrc` development series. |
| **@modelcontextprotocol/sdk** | `1.32.1` | Application Dependency | Official Model Context Protocol TypeScript SDK; stateless Streamable HTTP transport. |
| **express** | `4.21.2` | Application Dependency | Production web server hosting `/health` and Streamable HTTP `/mcp`. |
| **zod** | `3.24.2` | Application Dependency | Strict schema validation for environment configuration, tool inputs, and upstream responses. |
| **npm CLI** | `11.19.0` | Build Stage | Pinned in development and base image for deterministic package locking via `package-lock.json`. |

---

## 3. Container Security Context & Runtime Specifications

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
