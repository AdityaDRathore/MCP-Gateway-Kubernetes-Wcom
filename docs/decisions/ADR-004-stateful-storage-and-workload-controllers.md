# ADR-004: Stateful Storage Architecture and Workload Controller Selection

**Status**: Accepted  
**Date**: 2026-10-11  
**Decision Makers**: Aditya Rathore (FDE Candidate), Antigravity AI  

---

## 1. Context & Problem Statement

Phase 2 requires deploying a stateful WordPress + WooCommerce storefront backed by MariaDB on the local Kubernetes cluster (`k3d-urumi`). Both workloads require persistent storage:
- MariaDB requires persistent storage for its InnoDB tables, transaction redo logs, and user grant tables (`/var/lib/mysql`).
- WordPress requires persistent storage for plugin code (specifically WooCommerce), active themes, media uploads, and core configuration (`/var/www/html`).

We must choose:
1. The appropriate Kubernetes storage primitives and StorageClass.
2. The appropriate Kubernetes controller types (`StatefulSet` vs. `Deployment`) and rollout strategies.
3. The volume mount scope and directory boundaries for each container.

All choices must function reliably on a single-node local cluster (`k3d`), respect host memory constraints, prevent storage collisions, and survive workload restarts with zero data loss.

---

## 2. Decision

1. **StorageClass & Storage Primitive**:
   - Standardized on the default **`local-path`** StorageClass provided by K3s/k3d.
   - Pre-created explicit `PersistentVolumeClaim` manifests (`urumi-mariadb-pvc` and `urumi-wordpress-pvc`, 1Gi each) with **`ReadWriteOnce` (RWO)** access mode.
   - *Failure Boundary*: Guarantees durability across container restarts, rollout replacements, and node reboots. Does not protect against host disk destruction or provide cross-node failover (acceptable for local development).

2. **MariaDB Controller: StatefulSet**:
   - Deployed MariaDB as a single-replica **`StatefulSet`** (`urumi-mariadb`).
   - Guarantees a deterministic, ordinal pod name (`urumi-mariadb-0`), stable internal DNS address (`urumi-mariadb-0.urumi-mariadb.urumi.svc.cluster.local`), and dedicated volume binding.
   - Exposes port 3306 exclusively through an internal `ClusterIP` Service (`urumi-mariadb:3306`). Zero external Ingress exposure.

3. **WordPress Controller: Deployment with `Recreate` Strategy**:
   - Deployed WordPress as a single-replica **`Deployment`** (`urumi-wordpress`), but configured with `strategy.type: Recreate` instead of the default `RollingUpdate`.
   - *Rationale*: Because `urumi-wordpress-pvc` has `ReadWriteOnce` access mode, a `RollingUpdate` would attempt to start a new pod while the old pod still holds the volume mount, resulting in Kubernetes `Volume Multi-Attach` locking errors. `Recreate` strictly terminates the old pod before launching the new pod, releasing the volume mount cleanly.

4. **Full-Webroot Volume Mounting (`/var/www/html`)**:
   - Mounted `urumi-wordpress-pvc` across the entire `/var/www/html` webroot rather than solely `/var/www/html/wp-content/uploads`.
   - *Rationale*: WooCommerce is installed as a plugin under `wp-content/plugins/woocommerce/`. Mounting only uploads would cause plugin code and active theme configurations to vanish upon pod restart.
   - *Trade-off*: Updating the WordPress container image tag will not automatically update core files on an existing volume; WordPress core upgrades must be managed via WP-CLI or Admin.

---

## 3. Alternatives Considered & Rejected

| Alternative | Reason for Rejection |
| :--- | :--- |
| **`RollingUpdate` for WordPress** | Triggers Kubernetes `Volume Multi-Attach` error when both pods attempt to attach the same `ReadWriteOnce` volume simultaneously on rolling restarts. |
| **`StatefulSet` for WordPress** | Unnecessary architectural overhead. WordPress web instances do not require stable network ordinal identities (`wordpress-0`, `wordpress-1`) or ordered scale-down; a Deployment with `Recreate` is idiomatic. |
| **Mounting only `/wp-content/uploads`** | Causes WooCommerce plugin code (`wp-content/plugins/woocommerce/`) to be lost whenever the container is replaced. |
| **Shared RWX Storage (NFS / Ceph)** | Excessive operational overhead, higher memory footprint, and well-known SQLite/PHP file-locking latency penalties for local single-node development. |
| **Ephemeral `emptyDir` Volumes** | Violates Phase 2 persistence requirement. All catalog data and orders would be wiped out upon pod restart. |

---

## 4. Consequences & Verification

- **Positive**: 
  - Complete data retention verified: both MariaDB and WordPress pods survived controlled `kubectl rollout restart` with zero data loss (products and Order #14 intact).
  - Clean volume detachment and re-attachment without multi-attach deadlocks.
- **Negative / Constraints**:
  - Brief downtime (~10–15 seconds) during WordPress rollout restarts because `Recreate` terminates the old pod before starting the replacement pod. Acceptable for local single-replica architecture.
  - Image tag bumps do not automatically overwrite existing webroot files on the persistent volume.
