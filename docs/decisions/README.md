# Architecture Decision Records (ADRs)

This directory contains the formal Architecture Decision Records for the Urumi Enterprise MCP Gateway & Store Platform.

## ADR Index

| ADR ID | Title | Status | Date | Primary Scope |
|:---|:---|:---:|:---:|:---|
| [`ADR-001`](./ADR-001-stack-and-deployment.md) | Baseline Technology Stack, K3d, Helm, and Node.js Baseline | Accepted | 2026-10-10 | Infrastructure |
| [`ADR-002`](./ADR-002-mcp-compatibility.md) | Model Context Protocol (MCP) Stream Compatibility & Spec Compliance | Accepted | 2026-10-10 | Protocol |
| [`ADR-003`](./ADR-003-secrets-and-access.md) | Kubernetes Secrets Architecture, Rotation, and RBAC Separation | Accepted | 2026-10-11 | Security |
| [`ADR-004`](./ADR-004-stateful-storage-and-workload-controllers.md) | Stateful Workload Controller and Storage Engine Selection | Accepted | 2026-10-11 | Storage |
| [`ADR-005`](./ADR-005-local-rest-api-security-boundary.md) | Local REST API Security Boundary and Loopback Hardening | Accepted | 2026-10-12 | Security |
| [`ADR-006`](./ADR-006-image-digest-locking-and-resource-tuning.md) | Container Image Digest Pinning and Resource Tuning | Accepted | 2026-10-12 | Deployment |
| [`ADR-007`](./ADR-007-in-cluster-rest-api-authentication.md) | In-Cluster Upstream Authentication & Secret Lifecycle | Accepted | 2026-10-13 | Security |
| [`ADR-008`](./ADR-008-five-tool-contract-and-pii-redaction.md) | Five Core E-Commerce Tools Contract and PII Redaction Engine | Accepted | 2026-10-13 | MCP Tools |
| [`ADR-009`](./ADR-009-kubernetes-network-isolation-and-conditional-policies.md) | Network Isolation, Egress Filtering, and Conditional NetworkPolicies | Accepted | 2026-10-14 | Networking |
| [`ADR-010`](./ADR-010-container-image-identity-and-digest-pinning-boundary.md) | Container Image Identity and Immutability Boundary | Accepted | 2026-10-14 | Deployment |
| [`ADR-011`](./ADR-011-gateway-dual-mcp-proxy-and-transport-lifecycle.md) | Gateway Dual MCP Proxy Transport Lifecycle (SSE & HTTP Stream) | Accepted | 2026-10-15 | Gateway |
| [`ADR-012`](./ADR-012-gateway-persistence-node-sqlite-and-wal.md) | Gateway Storage Engine via Node.js Built-in `node:sqlite`, WAL Concurrency | Accepted | 2026-10-15 (Rev. 2026-10-21) | Gateway Storage |
| [`ADR-013`](./ADR-013-api-key-auth-constant-time-and-admin-bootstrap.md) | API Key Authentication, Constant-Time Verification, and CLI Bootstrap | Accepted | 2026-10-15 | Security |
| [`ADR-014`](./ADR-014-two-phase-audit-logging-and-retention.md) | Two-Phase Audit Logging, Integrity Chaining, and Data Retention | Accepted | 2026-10-15 | Compliance |
| [`ADR-015`](./ADR-015-concurrency-limits-circuit-breaker-and-resilience.md) | Concurrency Limiting, Circuit Breaking, and Backpressure | Accepted | 2026-10-16 | Gateway Resilience |
| [`ADR-016`](./ADR-016-upstream-catalog-snapshot-and-health-tracking.md) | Dynamic Upstream Tool Aggregation, Catalog Snapshot, and Health Tracking | Accepted | 2026-10-16 | Upstream Management |
| [`ADR-017`](./ADR-017-network-defense-ssrf-allowlist-and-secret-rbac.md) | SSRF Defense Engine, Private Subnet Filtering, and Kubernetes Secret RBAC | Accepted | 2026-10-17 | Security |
| [`ADR-018`](./ADR-018-upstream-mock-contracts-crm-and-tasks.md) | High-Fidelity Mock Upstreams for Enterprise CRM & Task Systems | Accepted | 2026-10-17 | Upstream Integrations |
| [`ADR-019`](./ADR-019-browser-identity-session-and-csrf.md) | Browser Identity, Session Management, Scrypt KDF, and CSRF Defense | Accepted | 2026-10-21 | Dashboard Security |
| [`ADR-020`](./ADR-020-dual-listener-and-ingress-perimeter.md) | Dual-Listener Architecture and Ingress Perimeter Security | Accepted | 2026-10-21 | Gateway Architecture |
| [`ADR-021`](./ADR-021-in-dashboard-chat-agent-and-mutation-confirmation.md) | In-Dashboard Chat Agent, Model Provider Abstraction, and Mutation Confirmation Lifecycle | Accepted | 2026-10-22 | AI Agent & Security |

---

## Architectural Principles

1. **Defense in Depth**: Isolation at the network (NetworkPolicy), process (dual listeners), transport (TLS/Ingress), and application (RBAC, CSRF, Constant-time auth) layers.
2. **Minimal Dependencies**: Zero-compilation C++ footprint leveraging Node.js 24 LTS core capabilities (`node:sqlite`, `node:crypto`).
3. **Data Integrity & Traceability**: Immutable two-phase audit logging for every tool execution with correlation IDs and strict schema validation.
4. **Resilience & State Safety**: Single-replica SQLite WAL architecture with guaranteed volume unmount on pod replacement and verified backup procedures.
