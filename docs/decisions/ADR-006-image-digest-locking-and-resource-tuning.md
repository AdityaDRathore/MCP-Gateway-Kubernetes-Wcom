# ADR-006: Kubernetes Version Parity, Immutable Image Digest Locking, and Cgroup Memory Budgeting

**Status**: Accepted  
**Date**: 2026-10-12  
**Decision Makers**: Aditya Rathore (FDE Candidate), Antigravity AI  

---

## 1. Context & Problem Statement

During Phase 2 implementation, three interrelated infrastructure, compatibility, and resource challenges emerged:

1. **Kubernetes Version Skew**: Host machine had `kubectl v1.37.1` installed. The default k3d cluster creation command created a K3s cluster with `v1.31.x` (a 6-minor version skew, exceeding Kubernetes' supported $\pm 1$ minor skew policy and triggering deprecation warnings).
2. **Application Compatibility & Mutable Tags**: The Phase 1 scaffold specified `wordpress:6.7-php8.2-apache`. However, WooCommerce 11.2+ officially declares a minimum requirement of WordPress 7.0+. Furthermore, floating image tags (e.g., `:11.4` or `:latest`) represent mutable artifacts that fail supply-chain security standards.
3. **Cgroup Memory Starvation during WP-CLI Automation**: When executing administrative automation (`scripts/bootstrap-store.sh`), the WordPress container suddenly crashed with `Exit Code 137` (`Reason: OOMKilled`). The original memory limit was `384Mi`. Under concurrent load, the Apache web server (~150 MiB) running alongside a child PHP CLI process executing WP-CLI (~180 MiB) exceeded the 384Mi cgroup limit.

---

## 2. Decision

1. **Zero-Skew Cluster Initialization**:
   - Pinned the local k3d cluster image explicitly to **`rancher/k3s:v1.37.1-k3s1`**.
   - Guarantees **0 minor version skew** between host client (`v1.37.1`) and cluster server (`v1.37.1+k3s1`), eliminating version mismatch warnings and API schema drift.

2. **WordPress 7.1 Compatibility Upgrade**:
   - Upgraded and pinned the base image to **`wordpress:7.1.3-php8.3-apache`**.
   - Fully satisfies WooCommerce 11.2.1's requirement for WordPress 7.0+, running on the actively maintained PHP 8.3 line with Apache 2.4.

3. **Supply-Chain Digest Pinning in Helm**:
   - Updated Helm templates (`wordpress-deployment.yaml` and `mariadb-statefulset.yaml`) to support cryptographic digest pinning via `.Values.store.<component>.digest`:
     ```yaml
     image: {{ if .Values.store.wordpress.digest }}{{ printf "%s@%s" .Values.store.wordpress.image .Values.store.wordpress.digest | quote }}{{ else }}...{{ end }}
     ```
   - Locked immutable SHA-256 digests in [`infra/helm/urumi-platform/values.yaml`](../infra/helm/urumi-platform/values.yaml):
     - WordPress: `wordpress:7.1.3-php8.3-apache@sha256:8ecd8d8e374167ea22235acf30f80d1165b82f07ffa5bcef90c1cad8f7be251f`
     - MariaDB: `mariadb:11.4.5@sha256:49117dcc565cf51aa57ac5fca59ab31213402ff0eae6ffc13c46a37b938f7e4b`
   - Guarantees 100% reproducible, tamper-proof container pulls on any machine.

4. **Resource Budgeting & Headroom Tuning**:
   - Based on host RAM analysis (`free -m` indicated ~2.0 GiB available memory), tuned container cgroup allocations:
     - **WordPress**: `requests: 256Mi`, `limits: 512Mi` (CPU: `100m` req, `500m` lim)
     - **MariaDB**: `requests: 128Mi`, `limits: 384Mi` (CPU: `100m` req, `500m` lim)
   - Total store peak footprint (~896 MiB) operates comfortably within machine capacity while providing ample memory for WP-CLI child processes executing inside the WordPress container alongside active Apache worker pools.

---

## 3. Alternatives Considered & Rejected

| Alternative | Reason for Rejection |
| :--- | :--- |
| **Default k3d K3s Version** | 6-minor version skew with host `kubectl v1.37.1`. Risk of unrecognized API fields and client deprecation failures. |
| **Staying on WordPress 6.7** | Incompatible with WooCommerce 11.2+, which enforces a WordPress 7.0+ minimum requirement. |
| **Mutable Image Tags without Digests** | Fails supply-chain reproducibility. Upstream tag re-pushes could introduce breaking changes or security vulnerabilities without warning. |
| **Maintaining 384Mi Limit for WordPress** | Triggers Linux cgroup OOM Killer (`SIGKILL` / exit code 137) during WP-CLI database migrations and product seeding. |
| **Unbounded Container Limits (`limits: {}`)** | Dangerous. A memory leak or runaway PHP script could exhaust all 7.6 GiB of host RAM, crashing Docker Engine or the host OS desktop. |

---

## 4. Consequences & Verification

- **Positive**: 
  - `k3d cluster create` produces a zero-skew cluster matching client version `v1.37.1`.
  - Helm templates render immutable digest references; verified via `helm lint` (0 errors) and `helm template`.
  - `./scripts/bootstrap-store.sh` executes from start to finish with 0 restarts and 0 OOMKills.
- **Negative / Constraints**:
  - Updating container images now requires updating both the tag and the sha256 digest in `values.yaml` and `docs/phase-2/image-lock.md`.
