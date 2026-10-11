# Urumi AI FDE — Phase 2: Stateful WooCommerce Store Deployment

**Document type:** Technical execution work order / acceptance plan  
**Phase status:** Approved to start after Phase 1 exit approval  
**Proposed execution window:** 12 October 2026, with a short Phase 1 handoff/preflight on 11 October; target Phase 2 exit by end of 12 October. If a real blocker requires spillover, permit only through 13 October morning before re-planning the downstream critical path.  
**Source of truth:** Urumi Round 1 brief, current GitHub repository, Phase 1 completion report, `docs/architecture.md`, `docs/requirements-traceability.md`, ADR-001, and the current Helm values files.  
**Scope guardrail:** Do not implement gateway routing, dashboard, chat agent, WooCommerce MCP tools, CRM MCP, task MCP, or optional bonuses in this phase.

---

## 0. Executive decision

### Phase 2 goal

Deploy a real, working WordPress + WooCommerce store to the local Kubernetes cluster using the existing Helm chart. The store must be reachable through a stable local Ingress URL, persist its database and WordPress content across pod replacement, support Cash on Delivery checkout, and expose working WooCommerce REST API endpoints for Phase 3.

### Phase 2 exit outcome

A reviewer can open the storefront, browse at least three real products, add a product to the cart, complete a COD checkout, and confirm the resulting order in WooCommerce admin. WordPress and MariaDB run inside Kubernetes with health checks, resource requests/limits, Kubernetes Secrets, and persistent volumes. A controlled restart of each workload does not lose products or orders. Setup and verification instructions are recorded in the repository.

### Important baseline facts from the current repository

- Repository: `AdityaDRathore/MCP-Gateway-Kubernetes-Wcom`, default branch `main`.
- Node runtime baseline: Node.js `24.20.0`; root `npm ci` and workspace build must be reproducible from a fresh clone.
- Kubernetes tools reported by Phase 1: `kubectl v1.37.1`, Helm `v3.17.1`, k3d `v5.8.3`.
- The Phase 1 report records that an actual cluster had **not yet been created**.
- k3d's version output in the technical context records default K3s image/version `v1.31.5-k3s1`; this is not automatically compatible with the installed kubectl minor version and must be resolved before cluster operations.
- The host's port `80` is occupied by its existing nginx service and port `3001` by Wekan. Do not stop, reconfigure, or bind over them. Re-check that `8080` and `8443` are currently free before using them.
- The chart currently has a verified scaffold, not working workloads. `infra/helm/urumi-platform/templates/configmap.yaml` is currently the only reported workload-adjacent template; MariaDB/WordPress PVCs, workload controllers, Services and Ingress remain to be implemented.
- `infra/helm/urumi-platform/values.yaml` currently declares `wordpress:6.7-php8.2-apache` and `mariadb:11.4`. Do not carry these pins forward blindly. The WordPress image must be checked against the currently maintained WordPress release and current WooCommerce compatibility before the chart is deployed.
- Existing local resource values are estimates, not measured capacity guarantees. The host was reported to have approximately 7.6 GiB total RAM and around 1.2–1.4 GiB available during Phase 1. Re-measure before starting the cluster.

### Explicit non-goals

1. No MCP gateway or MCP server implementation.
2. No dashboard or chat UI.
3. No CRM/tasks upstreams.
4. No dynamic store provisioning.
5. No actual VPS deployment in Phase 2. Keep production values renderable; deploy the local store first.
6. No cluster deletion, PVC deletion, or host-service changes as a cleanup shortcut.

---

## 1. Requirement traceability for Phase 2

| ID | Required outcome | Implementation owner | Acceptance evidence |
|---|---|---|---|
| STR-01 | WordPress + WooCommerce runs in Kubernetes with MariaDB/MySQL | Helm store workloads | `kubectl get pods` shows both workloads Ready; storefront loads; WooCommerce is active in WP Admin |
| STR-02 | Store database and WordPress content persist | PVCs mounted by MariaDB and WordPress | Both PVCs are Bound; product/order data survive replacement of both pods |
| STR-03 | Checkout works using COD or a dummy/test gateway | WooCommerce settings | Complete storefront checkout and find the order in WP Admin |
| STR-04 | Seed at least three products with categories and prices | WooCommerce store setup | Products appear in storefront and authenticated WooCommerce REST API output |
| STR-05 | Store survives pod replacement | MariaDB + WordPress persistent storage | Restart one workload at a time; products and orders remain available |
| INF-01 | Store and database run inside the cluster | Kubernetes | Neither WordPress nor MariaDB uses host-side services; pods are cluster workloads |
| INF-02 | Helm chart deploys the store | `infra/helm/urumi-platform` | `helm lint`, local and production `helm template`, server-side dry-run where practical, and successful Helm release |
| INF-03 | Local and production values are supported by the same chart | Helm values | Both values profiles render successfully; local profile is installed |
| INF-04 | Workloads have readiness and liveness checks | Helm templates | `kubectl describe pod` shows correct configured probes and Ready status |
| INF-05 | Workloads define CPU/memory requests and limits | Values + templates | Rendered and live manifests show non-empty requests and limits; measured memory behaviour recorded |
| INF-06 | Credentials are not hardcoded | Kubernetes Secret references | `git grep` and rendered manifests show no real passwords; pod env uses `secretKeyRef` |
| API-PREP-01 | WooCommerce REST API is usable for Phase 3 | Store configuration | Pretty permalinks enabled; an authenticated `wc/v3` read succeeds; create/update capability is verified using a test object or a harmless test change |

**Source requirement:** Urumi explicitly requires WordPress/WooCommerce, persistent database and content storage, Ingress URLs, probes, resource requests/limits, and Kubernetes Secrets. The storefront checkout and order verification are formal Definition of Done items. The REST API test is a dependency check for the next phase, not a substitute for Phase 2's checkout test.

---

## 2. Phase 2 work breakdown and dependency order

```text
2.0 Phase 1 handoff cleanup and environment re-check
  ├── Confirm fresh-clone dependency install/build
  ├── Confirm documentation/status labels reflect actual resources
  └── Confirm current values still pin one gateway replica (no gateway work)

2.1 Kubernetes version and local cluster preflight
  ├── Check host ports, memory/disk, cluster list, current context
  ├── Select supported K3s image compatible with kubectl
  └── Create/verify k3d cluster and default storage/Ingress

2.2 Image and secret decisions
  ├── Verify WordPress image tag and WooCommerce compatibility
  ├── Verify exact MariaDB image tag
  ├── Record image tags/digests and selected versions
  └── Create local secret file and Kubernetes Secret safely

2.3 Helm implementation for the store
  ├── MariaDB PVC + controller + internal Service + probes/resources
  ├── WordPress PVC + Deployment + internal Service + probes/resources
  ├── Ingress for storefront only
  └── Values-driven image, storage, resources, and host configuration

2.4 Deploy and stabilize
  ├── Lint/render/schema-check chart
  ├── Install/upgrade the release in explicit namespace/context
  └── Verify PVC binding, DB readiness, WP readiness and Ingress routing

2.5 WooCommerce setup and test data
  ├── Complete WordPress installer
  ├── Install and activate pinned WooCommerce version
  ├── Configure INR/test store details, pretty permalinks, shipping and COD
  └── Create three products and perform a checkout

2.6 REST API readiness for Phase 3
  ├── Create a least-privilege integration user/key
  ├── Verify authenticated wc/v3 product/order reads
  └── Store credentials in a Kubernetes Secret without committing them

2.7 Persistence and failure verification
  ├── Restart WordPress pod; verify products/orders
  ├── Restart MariaDB pod; verify products/orders
  └── Record evidence and known limitations

2.8 Documentation and Phase 2 exit gate
```

The dependency ordering is intentional: do not debug WordPress or WooCommerce until the cluster, database, PVCs, and Ingress are healthy. Do not start Phase 3 until a real store and REST API work.

---

## 3. Task 2.0 — Phase 1 handoff cleanup

**Priority:** P0, time-box to approximately 30–45 minutes. Do not reopen already-passed Phase 1 work without evidence of a regression.

### Actions

1. Inspect current `main` state and report any uncommitted or unpushed work. The implementation AI must not commit, push, reset, or rewrite Git history; repository ownership/staging remains with the owner.
2. Perform a clean-clone reproduction check in a separate temporary directory, not over the active worktree:

   ```bash
   git clone https://github.com/AdityaDRathore/MCP-Gateway-Kubernetes-Wcom.git /tmp/urumi-phase2-clean-clone
   cd /tmp/urumi-phase2-clean-clone
   nvm use
   npm ci
   npm run build
   ```

   If `nvm use` is not available in that shell, explicitly select the already-installed Node 24.20.0 binary as documented by the repository. Record exact output and any discrepancy between `package.json`, lockfile, and README.
3. Confirm `docs/phase-1/environment-audit.md` reflects the currently installed tools and is dated/marked as an observation, not permanent truth. Do not assume its old port, memory, or process findings remain current.
4. Confirm requirements-traceability statuses distinguish “Scaffold Verified” from “Workload Deployed/Verified”. Phase 1 Helm rendering must not be described as proof that WordPress, MariaDB, PVCs, or Ingress are deployed.
5. Confirm `values-prod.yaml` retains `gateway.replicas: 1` while gateway data uses SQLite on a single PVC. This is a Phase 1 consistency check only; do not implement the gateway.

### Exit criteria

- Fresh-clone `npm ci` and `npm run build` pass, or a concrete lockfile/reproducibility issue is recorded and fixed with minimal scope.
- The actual environment is re-audited before cluster creation.
- No source changes unrelated to the store have been introduced.

### Deliverable

Update the existing environment audit if needed and add a short `docs/phase-2/phase-2-execution-log.md` with the start state, tool versions, cluster/version decisions, and command evidence.

---

## 4. Task 2.1 — Kubernetes and k3d preflight

**Priority:** P0; this is a blocking task.

### 4.1 Recheck the host safely

Run read-only checks first:

```bash
node --version
npm --version
docker version
docker info
kubectl version --client
helm version --short
k3d version
k3d cluster list
kubectl config current-context
ss -ltnp | grep -E ':(8080|8443)\b' || true
df -h /
free -h
```

- Do not stop or change host nginx on port 80.
- Do not stop or change Wekan on port 3001.
- If 8080 or 8443 has become occupied, stop and decide on a documented alternative mapping. Do not silently change it.
- Re-measure available memory and Docker disk usage. Image pulls plus a local Kubernetes control plane and the two store workloads can create pressure on the recorded host. If the host is actively swapping or close to OOM, investigate capacity before scheduling the store.
- If a cluster named `urumi` already exists, inspect it and its port mappings; do not delete or recreate it automatically.

### 4.2 Resolve the Kubernetes client/server version skew

The Phase 1 context records `kubectl v1.37.1` and k3d's default K3s version `v1.31.5-k3s1`. Those versions are six minor versions apart. Kubernetes documents that `kubectl` is supported only within one minor version of the API server. Do not create a cluster with the k3d default and assume this pairing is supported.

Preferred path:

1. Verify an available, stable `rancher/k3s` image at a currently supported minor version compatible with the installed `kubectl` (1.36 or 1.37 would satisfy the one-minor rule for kubectl 1.37, if the selected K3s tag exists and is stable).
2. Confirm the exact registry tag by inspecting the manifest before cluster creation. Do not guess or copy a tag suffix from a web page without verifying it in the registry.
3. Pin the selected K3s image/version in the execution log. Keep `kubectl` and the server within supported skew.
4. If a suitable image is unavailable or k3d cannot run it, choose and install a compatible `kubectl` for the selected cluster version; document why. Do not operate using an unsupported combination.

Examples of checks (replace the candidate tag with the verified one):

```bash
docker manifest inspect rancher/k3s:<verified-supported-version>
```

Then create a single-server local cluster with explicit port mappings, for example:

```bash
k3d cluster create urumi \
  --image rancher/k3s:<verified-supported-version> \
  --port "8080:80@loadbalancer" \
  --port "8443:443@loadbalancer" \
  --timeout 120s
```

This command is a template. Run it only after confirming the exact image tag, current ports, and that no conflicting `urumi` cluster exists. Do not use `--no-lb`; the chart relies on ingress through the k3d load balancer.

### 4.3 Verify the cluster before deploying anything

Use an explicit Kubernetes context in all subsequent commands; do not silently change the user's active context. For example, set the `--context` option to the context produced for the k3d cluster and pass the equivalent `--kube-context` to Helm.

```bash
kubectl --context k3d-urumi version
kubectl --context k3d-urumi get nodes -o wide
kubectl --context k3d-urumi get namespaces
kubectl --context k3d-urumi get storageclass
kubectl --context k3d-urumi get ingressclass
kubectl --context k3d-urumi get pods -A
```

Confirm:

- The server version is compatible with the selected `kubectl` version.
- The node is `Ready`.
- The expected StorageClass (`local-path` for the current K3s plan) exists. Use its actual name, not an assumed name, in the chart values.
- The expected IngressClass (`traefik` for the current plan) exists and has a running controller.
- `8080` and `8443` map to the cluster load balancer as planned.

### Exit criteria

No chart deployment starts until the cluster has a Ready node, compatible client/server versions, a verified Ingress controller, and a confirmed StorageClass.

---

## 5. Task 2.2 — Select and pin compatible container images

**Priority:** P0.

### 5.1 WordPress + WooCommerce compatibility

The committed chart default currently uses `wordpress:6.7-php8.2-apache`. Do not retain this by inertia. WordPress's official release archive identifies the actively maintained 7.1 series and lists WordPress 7.1.3 dated 6 October 2026. The current WooCommerce plugin listing reports version 11.2.1, requires WordPress 7.0 or later, and lists testing through WordPress 7.1.3. Those facts establish that the Phase 1 WordPress 6.7 tag should not be used with the current WooCommerce release without a verified compatibility rationale.

Implementation steps:

1. Inspect the official WordPress Docker image's published tags and verify an exact `*-php8.3-apache` or another current supported PHP/Apache tag actually exists. A WordPress.org core release does not prove that the corresponding Docker tag has already been published.
2. Prefer a fully versioned WordPress tag on a currently maintained branch; avoid `latest`, `apache`, `7`, or another moving alias.
3. Verify that the exact tag exists for `linux/amd64`, matching the recorded x86_64 host, and record its digest.
4. Use a WooCommerce plugin release compatible with the selected WordPress version. Verify the plugin's release/version at execution time. Record the version actually installed; do not write a different version in documentation than the one running in the store.
5. Do not build a custom WooCommerce MCP plugin/server into the WordPress image. Phase 3 requires that MCP server to be written separately. Installing the official WooCommerce ecommerce plugin is normal and required.

Possible checks:

```bash
docker manifest inspect wordpress:<verified-exact-tag>
docker pull wordpress:<verified-exact-tag>
docker image inspect wordpress:<verified-exact-tag> --format '{{json .RepoDigests}}'
```

Use the tag verified at execution time. If the most recent WordPress.org patch is not yet available as an official Docker tag, select the most recent fully versioned maintained tag actually published, record the patch gap, and do not silently use an unsupported old branch.

### 5.2 MariaDB image

The chart currently uses `mariadb:11.4`, which is a minor-series alias rather than a fixed patch tag. Verify the currently published stable patch in the 11.4 series (or document a justified maintained stable-series choice), check the manifest for `linux/amd64`, and record the exact tag/digest. Do not use `mariadb:latest`.

```bash
docker manifest inspect mariadb:<verified-exact-tag>
docker pull mariadb:<verified-exact-tag>
docker image inspect mariadb:<verified-exact-tag> --format '{{json .RepoDigests}}'
```

### 5.3 Image lock note

Create `docs/phase-2/image-lock.md` with:

- Image name, full version tag, registry, platform, digest and date checked.
- WordPress core version / PHP flavor.
- WooCommerce plugin version after installation.
- MariaDB server version.
- Why these versions were selected and any compatibility caveat.

### Exit criteria

The WordPress image tag is verified and compatible with the chosen WooCommerce release; the MariaDB tag is verified; no floating `latest` tags are used; image-lock evidence is documented.

---

## 6. Task 2.3 — Secret and values contract

**Priority:** P0. Credentials must not be placed in values files or chart templates as plaintext.

### 6.1 Secret contents

Use one locally created Kubernetes Secret for the store database credentials, for example `urumi-store-secrets`, in the same namespace as the workloads. Keep non-sensitive database names, usernames and service names in Helm values/ConfigMaps; put passwords only in Secret data.

Suggested Secret keys:

- `MARIADB_ROOT_PASSWORD`
- `MARIADB_PASSWORD` (the application DB user's password)

Configure the MariaDB and WordPress containers with `secretKeyRef` so the application user password is the same on both sides. `MARIADB_DATABASE`, `MARIADB_USER`, `WORDPRESS_DB_NAME`, `WORDPRESS_DB_USER`, and `WORDPRESS_DB_HOST` are configuration rather than secret values; they must agree across the two workloads.

### 6.2 Create a local secret file safely

- Create a gitignored local secret file such as `.secrets/phase2-store.env` with file mode `0600`.
- Generate strong random values without printing them to logs or committing them.
- Keep the root password distinct from the application user password.
- Do not place production passwords in `values-prod.yaml`; production secret provisioning remains an environment-specific step.

Use a secret-generation helper that writes directly to a file with restrictive permissions, or another documented method that does not print secrets. Avoid literal secrets in shell history, command-line arguments, screenshots, AI prompts, or the execution log.

After the file exists, create/update the Kubernetes Secret in the intended namespace from that file. Do not render secret bytes into Helm templates or `helm get values` output.

Example pattern (after the file format is defined and reviewed):

```bash
kubectl --context k3d-urumi -n urumi create secret generic urumi-store-secrets \
  --from-env-file=.secrets/phase2-store.env \
  --dry-run=client -o yaml | kubectl --context k3d-urumi apply -f -
```

Run it from the repository root so the relative path is predictable. The output should not include the file contents. Ensure `urumi` namespace exists first.

### 6.3 Persistent database initialization semantics

MariaDB container initialization variables such as database/user/password are applied when the data directory is initialized. Changing a Kubernetes Secret later does not automatically rotate a password inside an already initialized database. Record this behavior in the runbook. If the password must change after initial setup, perform and verify an actual MariaDB credential rotation; do not assume a Secret update alone is sufficient.

### 6.4 WordPress admin credentials

Use the WordPress web installer or a documented setup path. Do not commit an admin password or store it in a public config map. Store it only in local secret storage if it must be retained for the demo. The account must be a development/demo account with a strong password and no real customer data.

### Exit criteria

- Credentials are supplied via Kubernetes Secret references.
- No secret value is committed to Git or written to logs.
- Local/production environment distinction is explicit.
- A rotation/reinitialization limitation is documented.

---

## 7. Task 2.4 — Implement the store in Helm

**Priority:** P0.

Implement real resource templates in the existing chart. Do not create a second chart or a separate YAML-only deployment path; Helm is mandatory and the same chart must support environment-specific values.

### 7.1 Proposed resource inventory

The exact template filenames may follow the repository's naming conventions, but the rendered resources should include:

**Namespace/release:**
- Use one explicitly named application namespace for the Phase 2 workloads, proposed as `urumi`. Install with Helm `--namespace urumi --create-namespace` unless a namespace already exists and has been reviewed.

**MariaDB:**
- `PersistentVolumeClaim` or a single-replica `StatefulSet` with durable storage. For this assignment, a `StatefulSet` with a persistent volume is preferred for the database identity; use the simplest schema that keeps the PVC stable across upgrades.
- Internal `ClusterIP` Service on TCP 3306. No Ingress, NodePort, hostPort or host publication for MariaDB.
- `startupProbe`, `readinessProbe`, and `livenessProbe`. Prefer the official image's documented `healthcheck.sh --connect --innodb_initialized` pattern if verified present in the selected MariaDB image. Use a startup probe tolerant of first-time database initialization/recovery.
- Explicit CPU/memory requests and limits from values.
- Environment variables sourced from values for non-secret settings and `secretKeyRef` for passwords.
- A persistence mount at `/var/lib/mysql`.

**WordPress:**
- Single-replica `Deployment`, preferably with `Recreate` rollout strategy while using a single local-path `ReadWriteOnce` volume, to avoid overlap during rollout.
- Internal `ClusterIP` Service on port 80.
- Liveness/readiness/startup checks appropriate to the selected image. Do not make liveness depend on WooCommerce external network access. A TCP liveness probe can test the web server process; an HTTP readiness probe such as `/wp-login.php` can test that the app responds. Tune startup delays using observed startup time.
- Explicit CPU/memory requests and limits.
- Persistent volume mounted according to the approved storage decision. The current repository's stated default is a PVC mounted at `/var/www/html`; this persists WordPress code, plugins, themes and uploads, but means changing the container image tag does not itself upgrade the copy already stored on that volume. Keep this behavior explicit in the architecture/runbook and do not treat an image-tag bump as a complete WordPress upgrade.
- WordPress DB environment values using `WORDPRESS_DB_HOST` pointing to the MariaDB Service and database credentials via `secretKeyRef`.

**Ingress:**
- An `Ingress` using the verified class (planned `traefik`) for the storefront host only.
- Local hostname from `values-local.yaml`: `shop.127.0.0.1.nip.io`.
- Route `/` to the WordPress Service on port 80.
- Local TLS disabled.
- Do not expose MariaDB or create an external Ingress for any backend service.
- The dashboard/MCP domain values may remain in the existing ConfigMap as planned future configuration, but do not create gateway/dashboard Services, Deployments or routes in Phase 2.

**Configuration:**
- Keep service names, image refs, persistence sizes/storage classes, resources, probes, and ingress host/class values-driven.
- `values-local.yaml` should choose the verified local StorageClass and host.
- `values-prod.yaml` should remain renderable with production host/TLS configuration, but a functioning production certificate/DNS/VPS deployment is not a Phase 2 exit requirement.
- Do not put actual credentials in either values file.

### 7.2 Storage decisions

Recommended baseline consistent with Phase 1:

- MariaDB PVC: `1Gi` local profile, mounted at `/var/lib/mysql`.
- WordPress PVC: `1Gi` local profile, mounted at `/var/www/html`.
- Access mode: `ReadWriteOnce` for local-path unless the verified StorageClass/driver documents a different requirement.
- StorageClass: use the class actually observed in the cluster (expected to be `local-path`), not a hard-coded name that hasn't been checked.

These sizes are initial test-environment values, not general production sizing. Product data and images are small for the assignment. If PVCs approach capacity, record the measurement and resize deliberately; do not delete and recreate a volume to “fix” capacity.

### 7.3 Resource requests and limits

Use `values-local.yaml` as the local profile and verify the actual memory budget after the cluster and store start. The Phase 1 values currently reduce WordPress's memory limit to 256Mi and MariaDB to 256Mi; WooCommerce may need more headroom than a minimal WordPress landing page.

Starting values to test—not an assertion of actual usage—can be:

| Workload | CPU request | CPU limit | Memory request | Memory limit |
|---|---:|---:|---:|---:|
| MariaDB | `50m`–`100m` | `300m`–`500m` | `96Mi`–`128Mi` | `256Mi`–`384Mi` |
| WordPress + WooCommerce | `100m` | `500m` | `128Mi`–`192Mi` | `384Mi`–`512Mi` |

The implementation agent should start at the lowest values that fit the observed host, then adjust only from evidence such as `OOMKilled`, container restarts, PHP fatal-memory errors, slow health checks, or measured `docker stats`/`kubectl top` output. If Metrics Server is unavailable, record that and use Docker/cgroup measurements rather than claiming `kubectl top` was successful.

Do not remove required requests/limits to make pods schedule. If memory pressure becomes severe, pause, gather evidence, and lower nonessential concurrent workloads or adjust justified limits.

### 7.4 Helm validation loop

After templates are added:

```bash
helm lint infra/helm/urumi-platform
helm template urumi-store infra/helm/urumi-platform \
  --namespace urumi \
  -f infra/helm/urumi-platform/values-local.yaml \
  > /tmp/urumi-store-local.yaml
helm template urumi-store infra/helm/urumi-platform \
  --namespace urumi \
  -f infra/helm/urumi-platform/values-prod.yaml \
  > /tmp/urumi-store-prod.yaml
```

Inspect the rendered YAML, not just the exit code. Confirm resource names/selectors match, secret values do not appear, PVC mounts are correct, Services are internal, and only the storefront has Ingress. Use a Kubernetes server-side dry-run against the selected context where feasible:

```bash
kubectl --context k3d-urumi apply --dry-run=server -f /tmp/urumi-store-local.yaml
```

If the chart renders resources for future components that are not implemented, do not accidentally deploy fake placeholder workloads. Ensure feature flags leave those workloads disabled and no placeholder image pulls are attempted.

### Exit criteria

Chart passes lint and render for both local and production values; local manifests pass API validation; WordPress and MariaDB resources have probes/limits/PVCs; the only public app endpoint created is the storefront Ingress; no plaintext secrets appear in rendered manifests.

---

## 8. Task 2.5 — Deploy and validate the Kubernetes store

**Priority:** P0.

### 8.1 Installation

Only after Tasks 2.1–2.4 pass:

1. Create the `urumi` namespace if not present.
2. Create/update the Kubernetes Secret in `urumi`.
3. Install the chart using the explicit k3d context and local values.

Command template:

```bash
helm --kube-context k3d-urumi upgrade --install urumi-store \
  infra/helm/urumi-platform \
  --namespace urumi \
  --create-namespace \
  -f infra/helm/urumi-platform/values-local.yaml
```

Use the verified context name from `kubectl config get-contexts`; `k3d-urumi` is the expected k3d naming convention, not a fact to assume without checking.

### 8.2 Progressive verification

Check each layer independently in this order:

```bash
kubectl --context k3d-urumi -n urumi get deploy,statefulset,pod,svc,pvc,ingress
kubectl --context k3d-urumi -n urumi get events --sort-by=.lastTimestamp
kubectl --context k3d-urumi -n urumi describe pvc
kubectl --context k3d-urumi -n urumi describe pod <wordpress-pod>
kubectl --context k3d-urumi -n urumi describe pod <mariadb-pod>
kubectl --context k3d-urumi -n urumi logs <mariadb-pod> --tail=100
kubectl --context k3d-urumi -n urumi logs <wordpress-pod> --tail=100
```

Do not paste secret environment variables or unfiltered debug dumps into the report. Redact sensitive values from any logs.

Order of operations to verify:

1. MariaDB PVC is `Bound` and data directory initializes.
2. MariaDB becomes Ready and remains stable.
3. WordPress PVC is `Bound`.
4. WordPress becomes Ready and can connect to MariaDB.
5. Internal WordPress Service has endpoints.
6. Ingress has the intended host/class/backend.
7. Local browser/HTTP request reaches WordPress at `http://shop.127.0.0.1.nip.io:8080` (or the exact approved host:port after validating host mapping).

Commands for network checks:

```bash
kubectl --context k3d-urumi -n urumi get endpoints
curl -sS -D /tmp/wordpress-headers.txt -o /tmp/wordpress-body.html \
  http://shop.127.0.0.1.nip.io:8080/
head -n 20 /tmp/wordpress-headers.txt
```

A WordPress setup page or redirect is acceptable before installation; a connection refusal, Ingress 404, backend 503, or repeated 5xx is not. Diagnose the actual layer instead of editing multiple components simultaneously.

### 8.3 Common failure handling

| Symptom | First diagnostic step | Do not do this |
|---|---|---|
| PVC Pending | `kubectl describe pvc` and inspect StorageClass/provisioner/events | Do not delete a PVC and lose data |
| MariaDB CrashLoopBackOff | inspect previous/current container logs and Secret references; check PVC permissions and init state | Do not repeatedly delete its data directory |
| WordPress DB connection error | confirm DB Service endpoints, DB readiness, DB/user/database config consistency | Do not expose DB through NodePort or hostPort |
| `ImagePullBackOff` | confirm tag exists for linux/amd64, pull status and registry connectivity | Do not switch to `latest` as a blind fix |
| Ingress 404 | verify host header, Ingress class/controller, rule and service name/port | Do not modify host nginx or bind host port 80 |
| Redirect loop/wrong site URL | inspect response `Location` and WordPress `home`/`siteurl`, including local `:8080` port | Do not blindly rewrite all WordPress database URLs |
| OOMKilled | inspect pod state, `kubectl describe`, host memory and container stats | Do not remove all limits or assume requests equal actual usage |

### Exit criteria

MariaDB and WordPress pods are Ready and stable, PVCs are Bound, the store loads on the expected Ingress URL, no database port is exposed outside the cluster, and diagnostics are recorded.

---

## 9. Task 2.6 — Complete the WordPress and WooCommerce setup

**Priority:** P0.

This is the first time the actual store is configured. Do not substitute mocked data or a hardcoded products endpoint.

### 9.1 WordPress initial setup

1. Open the storefront URL through Ingress.
2. Complete the official WordPress web installer.
3. Use a strong, unique development admin password; do not reuse a personal or production password.
4. Record the store URL and admin username in local, access-controlled notes if needed for the demo. Do not commit the password.
5. Verify the admin URL is reachable and login works.
6. Go to **Settings → Permalinks** and select a human-readable permalink setting such as **Post name**. The WooCommerce REST API documentation lists pretty permalinks as a requirement; default permalinks may not work for the required `wc/v3` API paths.

### 9.2 WooCommerce installation and version record

1. Install the exact verified WooCommerce release selected in Task 2.2 using WordPress admin/plugin upload or the WordPress plugin repository.
2. Activate it and complete the setup wizard with a test store configuration.
3. Set the currency to **INR** for demo consistency. Use non-real contact details and a test address; do not enter private or payment-provider credentials.
4. Capture the WooCommerce version from the plugin list and record it in `docs/phase-2/image-lock.md`/`docs/phase-2/store-bootstrap.md`.
5. Verify WooCommerce menus load without PHP fatal errors or plugin warnings that block checkout.

### 9.3 Shipping and payment configuration

COD is the assignment's allowed test checkout method. Configure only the minimum needed to make a physical product order successful:

1. Enable **Cash on Delivery** in WooCommerce payment settings.
2. Configure a shipping zone and a valid test shipping method (for example, a zero-cost flat-rate test method) for the test destination if checkout requires shipping.
3. Ensure the COD payment method is available for that shipping method / destination.
4. Do not add a live card processor or real payment credentials.
5. Save settings, log out/reopen a fresh storefront session, and verify the checkout options appear for the intended test cart.

### 9.4 Seed products

Create at least three **published, simple products** that are easy to recognize in both the storefront and REST API. Suggested test data:

| Product name | SKU | Test regular price (INR) | Category |
|---|---|---:|---|
| Urumi Test Mug | `URUMI-MUG-001` | `299` | Accessories |
| Wireless Mouse Demo | `URUMI-MOUSE-001` | `799` | Electronics |
| Notebook Demo | `URUMI-NOTE-001` | `149` | Stationery |

These are sample test values, not business requirements. Verify each price is a valid decimal string/numeric value for WooCommerce, each product is published, and each category exists. If a product's SKU is already present after a rerun, update/verify that product instead of creating duplicates.

### 9.5 Checkout test

1. Open a private/incognito browser session to avoid admin cookies influencing the flow.
2. Open one product page, add it to cart, navigate to cart and checkout.
3. Fill a fictional test customer name/address/email/phone. Do not use a real customer's personal data.
4. Select Cash on Delivery and submit the order.
5. Wait for the order confirmation page and record the **actual** Order ID and status shown by WooCommerce.
6. Open **WooCommerce → Orders** in admin and verify the matching order, line item, quantity, total, payment method, and timestamp.
7. Confirm the order references one of the seeded products.

Do not assume the order's initial status; record what WooCommerce reports with the selected COD/configuration.

### Exit criteria

A human can complete a real end-to-end storefront checkout, and the order exists in WooCommerce admin with the correct product, total, payment method and status.

---

## 10. Task 2.7 — Verify the WooCommerce REST API for Phase 3

**Priority:** P1 but mandatory before Phase 2 exit if there is no independent blocker. The later custom MCP server is planned to use WooCommerce REST API, so test it now while diagnosing store configuration is cheap.

### 10.1 Create a dedicated integration identity

1. Create a WordPress user specifically for the MCP integration, e.g. `urumi-mcp-integration`.
2. Assign a role capable of managing products and orders for the required five operations. Start with the built-in **Shop manager** role unless a tested, narrower custom capability set is implemented. Do not use the site administrator credential as an API credential.
3. In **WooCommerce → Settings → Advanced → REST API**, create a Read/Write API key for that user.
4. Store the consumer key and consumer secret directly in a Kubernetes Secret for Phase 3 (e.g. `urumi-woocommerce-api`) or secure local secret storage until the workload is implemented. Do not put the keys in Helm values, source code, screenshots, a chat prompt or the execution log.
5. Record the key's owner/permissions and Secret name only, not its value.

### 10.2 Verify API endpoints

The WooCommerce REST API uses `wc/v3` and requires a supported authentication configuration. Prefer Basic Authentication over HTTPS in production; local HTTP is acceptable for the local development-only cluster but must not be represented as production-secure transport. The API docs also call out pretty permalinks.

Use the safest available method to test authentication. If using `curl`, do not pass secrets as literal command-line arguments or print them. Prefer a temporary mode-`0600` curl config file outside the repo, a short local script that reads environment variables without logging them, or an equivalent secret-safe tool.

Verify at minimum:

- Authenticated `GET /wp-json/wc/v3/products?per_page=10` returns the seeded products.
- Authenticated `GET /wp-json/wc/v3/orders?per_page=10` returns the COD order.
- The authentication failure is distinguishable from a route/permalink failure (for example, expected unauthorized response versus REST route not found).
- If practical, create and delete a clearly named disposable product using the integration key to prove write access; otherwise document the permissions and defer write-path proof to Phase 3's `create_product` test.

The MCP server will need to create products, list/get orders and update order status. Read-only API verification alone does not prove these write operations work. Do not mark write access verified unless it was tested successfully.

### Exit criteria

The REST API endpoint and authentication are proven to work with the actual store. The integration key is stored safely and not exposed to browser users or Git.

---

## 11. Task 2.8 — Persistence and controlled restart tests

**Priority:** P0. This is the main stateful-application proof, not an optional hardening task.

### 11.1 Pre-restart baseline

Before restarting pods, record:

- Names and readiness of WordPress and MariaDB pods.
- PVC names, status, storage class and capacity.
- Three seeded product names and IDs (from admin/API).
- Checkout Order ID, line item, total, payment method, and current status.
- A successful storefront URL response and authenticated API responses.
- Container restart counts and any events.

Do not collect secret values as baseline evidence.

### 11.2 Restart WordPress only

Trigger a controlled WordPress pod replacement, for example with `kubectl rollout restart deployment/<wordpress-deployment>` using the explicit context. Wait for rollout completion and Ready status.

Re-check the same product IDs and the same order ID through the UI/API. The products/order must still exist; WordPress should serve the storefront normally.

### 11.3 Restart MariaDB only

After the WordPress check passes, restart/replace the MariaDB pod. Wait for its startup/readiness probes to pass and then verify WordPress can reconnect.

Re-query the same products and order. Confirm the database PVC was not deleted/recreated and the order remains present.

### 11.4 Evidence interpretation

- This test establishes survival across application pod replacement while using the same PVCs.
- It does **not** establish protection against disk destruction, PVC deletion, a bad database migration, or a full host failure.
- Do not claim backup/disaster recovery or off-host durability unless tested separately.
- Never delete a PVC as part of the test.

### Exit criteria

Both workloads can be replaced while the same underlying PVCs remain in place; all seeded products and the COD order still exist after the restart tests.

---

## 12. Task 2.9 — Operational documentation and reproducibility

**Priority:** P1; complete alongside the deployment rather than leaving it until the final night.

Add a Phase 2 runbook, preferably `docs/phase-2/store-deployment.md`, and update root `README.md` without overwriting useful Phase 1 content.

The runbook must document:

1. Prerequisites and verified tool versions.
2. Cluster version/image decision, explicit context name, host port mapping, hostname strategy and verified Ingress class.
3. How to create local secrets without printing or committing them.
4. The exact Helm install/upgrade command.
5. Local storefront/admin URLs and expected behavior before/after WordPress installation.
6. How WooCommerce was installed and the actual plugin version.
7. Currency, shipping, COD setup and product seed data.
8. How to perform and verify checkout.
9. How to perform a safe WordPress restart test and MariaDB restart test.
10. Common failure modes and their observed resolution.
11. Known limitations, especially: local HTTP only, local-path storage, untested host/disk disaster recovery, manual bootstrap actions, and full-webroot PVC image-upgrade implications.
12. A command-by-command verification log with pass/fail status and date.

Update `docs/requirements-traceability.md` only with evidence that was actually obtained. Mark the store-related requirements as **Verified** only after the corresponding tests pass. Do not mark Ingress or persistence verified because a manifest renders.

---

## 13. Phase 2 detailed test matrix

| Test ID | Test | Expected result | Evidence to keep |
|---|---|---|---|
| P2-ENV-01 | Clean clone: `npm ci`, `npm run build` | Reproducible install/build, or blocker explicitly documented | Command output summary, Node/npm versions |
| P2-K8S-01 | Verify client/server versions | `kubectl` is within one minor of API server | `kubectl version` output summary |
| P2-K8S-02 | Node/storage/ingress readiness | Node Ready; expected StorageClass and IngressClass exist | `get nodes`, `get storageclass`, `get ingressclass` |
| P2-HELM-01 | Lint + local render | Passes; templates render expected resources | Lint output and rendered manifest review |
| P2-HELM-02 | Production values render | Passes; no plaintext secrets; WordPress/MariaDB configured | Render command output and manifest review |
| P2-SEC-01 | Secret check | No credentials in Git, values, logs or rendered manifest | `git grep` summary and env refs (values redacted) |
| P2-STORE-01 | WordPress workload ready | Pod Ready and storefront reachable via Ingress | `kubectl get pod/ingress`, HTTP headers/status |
| P2-STORE-02 | MariaDB internal only | ClusterIP Service exists; no Ingress/NodePort/hostPort | `kubectl get svc/ingress` and manifest review |
| P2-STORE-03 | WooCommerce plugin active | Plugin version recorded; WP Admin shows active | Screenshot/text record without passwords |
| P2-STORE-04 | Product seed | Three products published; categories and prices correct | Product IDs from API/admin |
| P2-CHECKOUT-01 | COD checkout | Order confirmation and new order in admin | Order ID/status/total/payment method |
| P2-API-01 | REST API product listing | Authenticated `wc/v3/products` returns seeded products | Sanitized output/count, no keys |
| P2-API-02 | REST API order listing | Authenticated `wc/v3/orders` returns the checkout order | Sanitized output/order ID |
| P2-PERSIST-01 | WordPress pod replacement | Product and order remain | Before/after IDs and pod names |
| P2-PERSIST-02 | MariaDB pod replacement | Product and order remain | Before/after IDs, PVC names/status |
| P2-RESOURCE-01 | Resource/probe check | Requests/limits and probes present; workloads stable | `describe pod`, events, usage measurements |
| P2-DOC-01 | Fresh runbook walkthrough | Another person can reproduce the store without guesswork | Checked runbook steps |

---

## 14. Phase 2 exit gate (Go/No-Go)

Phase 2 is **not** complete until every P0 item is supported by execution evidence.

### P0 — must pass

- [ ] `kubectl` and the cluster server version are within supported minor-version skew.
- [ ] k3d cluster has a Ready node; correct context is used explicitly.
- [ ] StorageClass and Ingress controller are verified.
- [ ] MariaDB is deployed in-cluster with an internal ClusterIP Service, persistent storage, probes, and resource requests/limits.
- [ ] WordPress is deployed in-cluster with persistent storage, probes, and resource requests/limits.
- [ ] Only the storefront is exposed through local Ingress; MariaDB is not externally exposed.
- [ ] The chart passes `helm lint` and both environment value profiles render without errors or leaked secret content.
- [ ] WooCommerce is installed/active at the recorded compatible version.
- [ ] At least three published products exist with recorded IDs, categories and prices.
- [ ] A COD checkout completes and the resulting order is visible in WooCommerce admin.
- [ ] Product and order data survive WordPress pod replacement.
- [ ] Product and order data survive MariaDB pod replacement with the same PVC.
- [ ] No real credentials are committed or included in execution logs.

### P1 — should pass before Phase 3 starts

- [ ] A dedicated WooCommerce integration user and REST key are created with appropriate product/order access.
- [ ] Authenticated `wc/v3` product and order reads succeed.
- [ ] Write access is verified, or an explicit technical blocker is recorded for Phase 3 to resolve first.
- [ ] `docs/phase-2/store-deployment.md`, `docs/phase-2/image-lock.md`, `docs/phase-2/phase-2-execution-log.md`, README and traceability statuses are updated.

### Decision rule

- **Go:** all P0 tests pass; proceed to Phase 3 custom WooCommerce MCP server.
- **Conditional go:** P0 passes but one P1 REST write test is blocked for a documented, narrow reason. Do not let Phase 3 assume write capability; its first task is to resolve the REST API write issue.
- **No-go:** checkout fails, data does not survive pod replacement, database is exposed externally, probes/resources/secrets are missing, or cluster client/server version skew is unsupported. Fix the blocking issue before adding MCP code.

---

## 15. Required handoff report from the implementation AI

At the end of Phase 2, the implementing AI must deliver:

1. **Summary:** completed, blocked and deferred work.
2. **Files changed:** exact paths and reason for each change.
3. **Images:** verified WordPress/MariaDB tags and digests, WooCommerce version, compatibility source.
4. **Kubernetes evidence:** cluster server version, node readiness, namespace, PVCs, workloads, Services, Ingress, probes, resource requests/limits.
5. **Store evidence:** product IDs, checkout Order ID/status/total/payment method, without personal data or secrets.
6. **Persistence evidence:** before/after resource IDs and pod replacement evidence for WordPress and MariaDB.
7. **REST API evidence:** endpoint paths and result status/count, with keys redacted.
8. **Validation commands:** the actual `helm lint`, template, API validation, deployment and test commands executed, each marked pass/fail.
9. **Known gaps:** remaining work and impact on Phase 3.
10. **Git status:** changes staged/unstaged/untracked, but do not commit or push on the owner's behalf.

Do not accept “it should work”, “manifests look right”, or “the pod is running” as evidence for checkout or persistence.

---

## 16. Copy/paste work order for the coding AI

> You are implementing Phase 2 of the Urumi AI FDE take-home repository. Phase 1 has been approved. Implement only the stateful WooCommerce store deployment and its verification. Do not implement gateway routing, any dashboard UI, chat, the WooCommerce MCP server, CRM/tasks MCP servers, or optional bonuses.
>
> **First:** inspect current Git state and files, perform a fresh-clone `npm ci` + build reproduction check in a separate temporary directory, refresh environment measurements, and verify the actual cluster/context/ports. Do not commit, push, reset Git history, delete clusters, delete PVCs, or touch host nginx/port 80 or Wekan/port 3001.
>
> **Blocking technical check:** Phase 1 records `kubectl v1.37.1` but k3d's default K3s is `v1.31.5-k3s1`. Kubernetes supports kubectl only within one minor version of the API server. Verify the exact available stable K3s image and select a compatible server/client pair before cluster operations. Check 8080/8443 and verify StorageClass/IngressClass after cluster creation.
>
> **Image selection:** current chart values use `wordpress:6.7-php8.2-apache` and `mariadb:11.4`. Do not blindly retain these. Verify exact current published tags and platform support; use a maintained WordPress branch compatible with the exact WooCommerce release being installed, and a pinned MariaDB patch tag. Capture image digests/version evidence in `docs/phase-2/image-lock.md`. Never use a floating `latest` tag.
>
> **Helm resources:** extend `infra/helm/urumi-platform` with real store templates for MariaDB persistent storage/controller/Service/probes/resources, WordPress persistent storage/Deployment/Service/probes/resources, and the storefront Ingress. Database must remain internal ClusterIP only. Expose only the storefront via the verified Ingress class. Keep local and production profiles in existing values files. Do not put real secrets into values files or templates; use Kubernetes Secret references. Preserve SQLite/gateway single-replica assumptions in production values, but do not implement the gateway.
>
> **Secrets:** use a gitignored local secrets file with restrictive permissions and create `urumi-store-secrets` in the `urumi` namespace. Use a distinct database root password and application database password. Wire MariaDB and WordPress with `secretKeyRef`. Never log or commit any secret. Document that MariaDB initialization variables do not rotate existing database credentials on an already populated PVC.
>
> **Store setup:** deploy the real WordPress site, complete initial WordPress installation, enable pretty permalinks, install/activate the verified WooCommerce version, configure INR, a test shipping method and Cash on Delivery, and create three published products with categories/prices. Then complete a human checkout using fictional test customer data and verify the resulting order in WooCommerce admin.
>
> **REST API prep:** create a dedicated WordPress integration user with the permissions required for product and order operations. Generate a WooCommerce REST API key, store it only in a Kubernetes Secret/local secret store, and verify authenticated `wc/v3/products` and `wc/v3/orders` calls. Do not echo the key, pass it to a browser, or include it in the report. Report separately whether write access was actually tested.
>
> **Persistence tests:** record baseline product IDs/order ID and PVC names. Restart WordPress and verify the same products/order remain. Then restart MariaDB and verify the same products/order remain, without deleting or recreating PVCs. State precisely that this tests pod replacement, not host disk disaster recovery.
>
> **Documentation:** add `docs/phase-2/store-deployment.md`, `docs/phase-2/image-lock.md`, and `docs/phase-2/phase-2-execution-log.md`; update README and requirement statuses with observed evidence. Run Helm lint and render both local and production profiles. Inspect generated manifests for correct selectors, internal-only DB Service, secret references, PVC mounts, probes/limits, and no placeholder workloads being deployed.
>
> **Definition of done:** real WordPress + WooCommerce in Kubernetes; persistent DB and WordPress content; only storefront exposed via Ingress; working COD checkout visible in admin; three real products; data survives replacement of both WordPress and MariaDB pods; REST API read calls succeed or the exact blocker is documented; no real credentials exposed; all work is reported with exact files, commands and results.
>
> **Final response format:** summary; environment and version decisions; changed files; commands/results; Kubernetes/PVC/Ingress evidence; product/order evidence; persistence evidence; REST API evidence; known gaps; next Phase 3 blockers. Report only tests actually run. Do not commit/push.

---

## 17. Authoritative references

These public sources are provided so the implementer can verify the chosen versions and behavior at execution time. The current registry/release state must be checked when the phase runs; this document intentionally does not guess unavailable image tags.

1. Urumi assignment brief: <https://docs.google.com/document/d/1wE4j9_Y_iydrkiMu7p9N_Kd4ltFztUqjssyBd4tSwkU/view>
2. Repository / Phase 1 completion report: <https://github.com/AdityaDRathore/MCP-Gateway-Kubernetes-Wcom/blob/main/docs/phase-1/phase-1-completion-report.md>
3. Current chart values: <https://github.com/AdityaDRathore/MCP-Gateway-Kubernetes-Wcom/tree/main/infra/helm/urumi-platform>
4. WordPress release archive: <https://wordpress.org/download/releases/>
5. Official WordPress Docker image documentation and tags: <https://hub.docker.com/_/wordpress>
6. WooCommerce plugin release/compatibility information: <https://wordpress.org/plugins/woocommerce/>
7. WooCommerce REST API documentation: <https://developer.woocommerce.com/docs/apis/rest-api/>
8. WooCommerce REST API authentication documentation: <https://developer.woocommerce.com/docs/apis/rest-api/authentication>
9. MariaDB official Docker image documentation: <https://hub.docker.com/_/mariadb/>
10. MariaDB official image health check: <https://mariadb.com/docs/server/server-management/automated-mariadb-deployment-and-administration/docker-and-mariadb/using-healthcheck-sh>
11. Kubernetes version skew policy: <https://kubernetes.io/releases/version-skew-policy/>
12. Kubernetes persistent volumes/access modes: <https://kubernetes.io/docs/concepts/storage/persistent-volumes/>
13. Kubernetes liveness/readiness/startup probes: <https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/>
14. k3d cluster create options: <https://github.com/k3d-io/k3d/blob/main/docs/usage/commands/k3d_cluster_create.md>
15. K3s releases: <https://github.com/k3s-io/k3s/releases>

---

## Final management instruction

Phase 2 is complete when the store behaves like a real store, not merely when the pods say `Running`. The most important proof is the full path: **Ingress → WordPress/WooCommerce → MariaDB**, followed by a successful COD order and persistence verification. Keep all later gateway/dashboard work out of scope until these tests pass.
