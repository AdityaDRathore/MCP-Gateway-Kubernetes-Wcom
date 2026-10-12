# Urumi Platform — Phase 2 Project Study Material
## A Comprehensive Self-Study Guide to Stateful Workloads, Kubernetes Storage, WordPress & MariaDB Architecture, and E-Commerce APIs

> **Author**: Aditya Rathore  
> **Phase**: Phase 2 (Stateful WooCommerce Store Deployment)  
> **Target Audience**: Self-study, technical interviews, team knowledge transfer  
> **Context**: Urumi AI Founding DevOps / Forward Deployed Engineer (FDE) Assignment  
> **Last Updated**: October 2026  

---

## Table of Contents
1. [Introduction: Why This Document Exists](#1-introduction-why-this-document-exists)
2. [The Big Architectural Leap: Stateless vs. Stateful Workloads](#2-the-big-architectural-leap-stateless-vs-stateful-workloads)
   - [What is "State" in Software?](#what-is-state-in-software)
   - [The "Cattle vs. Pets" Analogy](#the-cattle-vs-pets-analogy)
   - [Why Kubernetes Was Originally Bad at State (and How It Evolved)](#why-kubernetes-was-originally-bad-at-state-and-how-it-evolved)
3. [Deep Dive: Kubernetes Storage Architecture](#3-deep-dive-kubernetes-storage-architecture)
   - [The 4 Storage Primitives: Volume, PV, PVC, StorageClass](#the-4-storage-primitives-volume-pv-pvc-storageclass)
   - [The Real Estate Analogy](#the-real-estate-analogy)
   - [Access Modes Explained: RWO, ROX, RWX](#access-modes-explained-rwo-rox-rwx)
   - [How `local-path-provisioner` Works in K3s/k3d](#how-local-path-provisioner-works-in-k3sk3d)
   - [Storage Failure Boundaries: What Survives and What Does Not](#storage-failure-boundaries-what-survives-and-what-does-not)
4. [Workload Controllers: Deployments vs. StatefulSets](#4-workload-controllers-deployments-vs-statefulsets)
   - [Why MariaDB Uses a StatefulSet](#why-mariadb-uses-a-statefulset)
   - [Why WordPress Uses a Deployment with `Recreate` Strategy](#why-wordpress-uses-a-deployment-with-recreate-strategy)
   - [The Dreaded Volume Multi-Attach Error](#the-dreaded-volume-multi-attach-error)
5. [The Database Tier: MariaDB 11.4 LTS on Kubernetes](#5-the-database-tier-mariadb-114-lts-on-kubernetes)
   - [MariaDB vs. MySQL: History and Selection Rationale](#mariadb-vs-mysql-history-and-selection-rationale)
   - [The InnoDB Storage Engine Internals](#the-innodb-storage-engine-internals)
   - [Container Initialization Mechanics & Password Gotchas](#container-initialization-mechanics--password-gotchas)
   - [Container Health Probing with `healthcheck.sh`](#container-health-probing-with-healthchecksh)
   - [Network Isolation: Why No Database Ingress?](#network-isolation-why-no-database-ingress)
6. [The Application Tier: WordPress Core & Apache](#6-the-application-tier-wordpress-core--apache)
   - [Containerized LAMP Stack: Apache 2.4 + PHP 8.3](#containerized-lamp-stack-apache-24--php-83)
   - [The Full-Webroot Persistence Model (`/var/www/html`)](#the-full-webroot-persistence-model-varwwwhtml)
   - [How WordPress Talks to MariaDB](#how-wordpress-talks-to-mariadb)
   - [Apache `.htaccess` & Pretty Permalinks: Why Rewrite Rules Matter](#apache-htaccess--pretty-permalinks-why-rewrite-rules-matter)
7. [The Commerce Tier: WooCommerce 11.2 Architecture](#7-the-commerce-tier-woocommerce-112-architecture)
   - [What is WooCommerce?](#what-is-woocommerce)
   - [Database Schema Extensions: CPTs vs. Custom Tables](#database-schema-extensions-cpts-vs-custom-tables)
   - [Products, SKUs, and Catalog Lifecycle](#products-skus-and-catalog-lifecycle)
   - [The Checkout Flow & Why Cash on Delivery (COD)?](#the-checkout-flow--why-cash-on-delivery-cod)
   - [Shipping Zones & Method Option Persistence](#shipping-zones--method-option-persistence)
8. [Automation & Administration: WP-CLI Demystified](#8-automation--administration-wp-cli-demystified)
   - [What is WP-CLI and Why Not Use a Web Browser?](#what-is-wp-cli-and-why-not-use-a-web-browser)
   - [How WP-CLI Executes Commands Inside Containers](#how-wp-cli-executes-commands-inside-containers)
   - [Key WP-CLI Subcommands Explained](#key-wp-cli-subcommands-explained)
   - [The Ephemeral Container vs. Persistent Storage Dilemma](#the-ephemeral-container-vs-persistent-storage-dilemma)
9. [WooCommerce REST API & Security Boundaries](#9-woocommerce-rest-api--security-boundaries)
   - [How the REST API Works (`/wp-json/wc/v3`)](#how-the-rest-api-works-wp-jsonwcv3)
   - [API Key Architecture: Consumer Key & Consumer Secret](#api-key-architecture-consumer-key--consumer-secret)
   - [The Problem: Basic Auth Rejection Over Plain HTTP](#the-problem-basic-auth-rejection-over-plain-http)
   - [The Solution: Hardened Must-Use Plugin (`local-dev-rest-ssl.php`)](#the-solution-hardened-must-use-plugin-local-dev-rest-sslphp)
   - [The Security Boundary: Why This Is Strictly Local-Only](#the-security-boundary-why-this-is-strictly-local-only)
10. [Kubernetes Secrets, Contracts, and Supply-Chain Security](#10-kubernetes-secrets-contracts-and-supply-chain-security)
    - [The Two-Layer Secret Contract](#the-two-layer-secret-contract)
    - [How `secretKeyRef` Injects Credentials](#how-secretkeyref-injects-credentials)
    - [Container Image Digest Pinning (Immutable Artifacts)](#container-image-digest-pinning-immutable-artifacts)
11. [Resource Management & The Linux OOM Killer](#11-resource-management--the-linux-oom-killer)
    - [CPU Throttling vs. Memory SIGKILL (Exit Code 137)](#cpu-throttling-vs-memory-sigkill-exit-code-137)
    - [The Phase 2 OOM Debug Case: Why 384Mi Broke and 512Mi Succeeded](#the-phase-2-oom-debug-case-why-384mi-broke-and-512mi-succeeded)
12. [Deep Breakdown of the Automation Script (`scripts/bootstrap-store.sh`)](#12-deep-breakdown-of-the-automation-script-scriptsbootstrap-storesh)
13. [Interview & Conceptual Cheat Sheet](#13-interview--conceptual-cheat-sheet)

---

## 1. Introduction: Why This Document Exists

In Phase 1, we established the project's foundation: we validated the **Model Context Protocol (MCP)** wire transport over Streamable HTTP, created a monorepo workspace, built an automated protocol spike, and authored the skeleton of a unified Helm chart.

However, an AI Gateway that connects to tools is meaningless if there are **no real, stateful systems** for those tools to interact with.

In Phase 2, we took on one of the most challenging tasks in modern DevOps: **deploying and operating stateful, transactional e-commerce workloads (WordPress, WooCommerce, and MariaDB) inside Kubernetes**.

This document is your **personal technical textbook**. It does not assume you already know how Kubernetes PersistentVolumes work, why an e-commerce database needs special controllers, or how WooCommerce handles REST authentication. It breaks down every single decision, mechanism, and failure mode from first principles.

---

## 2. The Big Architectural Leap: Stateless vs. Stateful Workloads

### What is "State" in Software?

In software architecture, **state** refers to any data that must be remembered across time, requests, or server restarts.

| Workload Type | Definition | Examples | What happens if killed? |
|---|---|---|---|
| **Stateless** | Does not store any persistent data locally. Every request contains all context needed, or state is delegated to a remote database. | Node.js MCP Gateway, React SPA, Nginx reverse proxy | Zero impact. A replacement container spins up in 2 seconds and handles requests immediately. |
| **Stateful** | Stores data locally on disk that represents critical business truth (orders, accounts, products, files). | MariaDB, PostgreSQL, WordPress uploads, Redis cache | Catastrophic if storage is lost. If the disk vanishes, customers lose their shopping carts and orders disappear. |

### The "Cattle vs. Pets" Analogy

In traditional IT operations, servers were treated like **pets**:
- You gave them names (e.g., `db-server-prod-01`).
- When they got sick, you lovingly nursed them back to health, tuned their kernel parameters, and backed them up manually.
- If a pet died, everyone grieved because rebuilding it was manual and painful.

In cloud-native Kubernetes architecture, servers and pods are treated like **cattle**:
- They are given random serial numbers (e.g., `urumi-wordpress-6b6c5d5c45-ffqb8`).
- When a pod gets slow or fails a health probe, Kubernetes shoots it in the head (`SIGKILL`) and immediately replaces it with a fresh one.
- You do not mourn a cattle pod.

**The Paradox of Stateful Workloads:**  
How do you treat a database container like cattle when its data is a cherished pet?  
**Answer:** You decouple the **compute container** (the cattle) from the **underlying storage volume** (the pet).

```
┌─────────────────────────────────┐
│     Compute Pod (Cattle)        │ <--- Can be killed, rescheduled,
│  urumi-mariadb-0 [Container]    │      or upgraded at any time.
└────────────────┬────────────────┘
                 │ Mounts via Linux VFS
                 ▼
┌─────────────────────────────────┐
│ Persistent Volume Claim (Pet)   │ <--- Survives pod termination.
│ urumi-mariadb-pvc (1Gi Storage) │      Re-attaches to the next pod.
└─────────────────────────────────┘
```

---

## 3. Deep Dive: Kubernetes Storage Architecture

Kubernetes separates storage concerns using four core primitives. Understanding how they relate is essential.

### The 4 Storage Primitives: Volume, PV, PVC, StorageClass

```
┌─────────────────────────┐
│      StorageClass       │  "The Storage Factory" (e.g. local-path, aws-ebs)
└────────────┬────────────┘
             │ Dynamically provisions
             ▼
┌─────────────────────────┐
│    PersistentVolume     │  "The Physical Land" (Actual directory on host disk)
│          (PV)           │
└────────────▲────────────┘
             │ Bound 1-to-1
             ▼
┌─────────────────────────┐
│  PersistentVolumeClaim  │  "The Rental Lease" (Requested 1Gi with RWO access)
│          (PVC)          │
└────────────▲────────────┘
             │ Claimed by
             ▼
┌─────────────────────────┐
│       Pod Volume        │  "The Tenant" (Mounted at /var/lib/mysql inside pod)
└─────────────────────────┘
```

### The Real Estate Analogy

1. **StorageClass**: The city zoning office or construction contractor. It defines what type of storage can be created (e.g., fast SSD, network NFS, or host local disk).
2. **PersistentVolume (PV)**: The actual plot of land built by the contractor. It has a concrete capacity (e.g., 1 GiB) and an exact physical location.
3. **PersistentVolumeClaim (PVC)**: The rental lease signed by a tenant. It says: *"I need 1 GiB of storage with single-node read/write access."* Kubernetes searches for an available PV (or uses the StorageClass to build one) and **binds** the PVC to the PV.
4. **Pod**: The tenant who moves into the house. The pod definition says: *"Mount the leased volume specified in `urumi-mariadb-pvc` into my bedroom closet at `/var/lib/mysql`."*

### Access Modes Explained: RWO, ROX, RWX

When requesting a PVC, you must specify an **Access Mode**:

| Access Mode | Code | Meaning | Used in Phase 2? |
|---|---|---|---|
| **ReadWriteOnce** | `RWO` | The volume can be mounted as read-write by a **single Kubernetes node** at a time. | **YES** (Used for both WordPress and MariaDB). |
| **ReadOnlyMany** | `ROX` | The volume can be mounted as read-only by **multiple nodes** simultaneously. | No. |
| **ReadWriteMany** | `RWX` | The volume can be mounted as read-write by **multiple nodes** simultaneously (requires NFS, Ceph, GlusterFS). | No. |

> [!NOTE]
> `ReadWriteOnce` means *single node*, not *single pod*. Multiple pods scheduled on the *same physical node* can technically mount it, but if pods land on different nodes, mounts will fail.

### How `local-path-provisioner` Works in K3s/k3d

In our local development environment (`k3d-urumi`), we use the default StorageClass: `local-path`.

**How does `local-path` actually create a PersistentVolume?**
1. When you deploy the Helm chart with `urumi-mariadb-pvc`, the `local-path-provisioner` pod running in `kube-system` intercepts the claim.
2. It generates a directory on the node's local filesystem:  
   `/var/lib/rancher/k3s/storage/pvc-58d7357d-5671-476d-904a-cda0a12cf269_urumi_urumi-mariadb-pvc`
3. Inside the k3d container (which represents the virtual Kubernetes node), that directory is bind-mounted directly into the container's `/var/lib/mysql`.
4. When the pod terminates, **the directory on the host disk remains untouched**. When the replacement pod starts, it binds to the exact same directory.

### Storage Failure Boundaries: What Survives and What Does Not

It is critical for a DevOps engineer to honestly understand what their storage model protects against:

```
Scenario                                  Will Data Survive?   Why?
Pod crash / Process segfault                    YES            Container restarts; rebinds to same volume directory.
Deployment rollout restart (`kubectl rollout`)   YES            New pod replaces old pod; claim remains bound.
Kubelet node reboot                             YES            Host filesystem preserves data; pod starts up upon reboot.
Physical host disk corruption / SSD failure      NO            local-path does NOT replicate data off-host.
Multi-node Kubernetes failover                   NO            local-path data exists ONLY on node 0; node 1 cannot read it.
```

---

## 4. Workload Controllers: Deployments vs. StatefulSets

In Kubernetes, you never create raw `Pod` objects directly in production. You manage them using **Controllers**. In Phase 2, we deliberately used **two different controllers** for two different workloads:

### Why MariaDB Uses a StatefulSet

A `StatefulSet` is designed specifically for stateful applications like databases, Kafka brokers, or ZooKeeper clusters.

Key characteristics of a StatefulSet:
1. **Stable Network ID**: Pods are not given random hashes; they receive deterministic, ordinal names: `urumi-mariadb-0`, `urumi-mariadb-1`.
2. **Stable Hostname**: Inside the cluster DNS, pod 0 is always addressable as `urumi-mariadb-0.urumi-mariadb.urumi.svc.cluster.local`.
3. **Ordered Deployment & Scaling**: Pod 0 is guaranteed to start and pass readiness probes before Pod 1 is ever created.
4. **Persistent Storage Binding**: If `urumi-mariadb-0` dies, the replacement pod will always be named `urumi-mariadb-0` and will re-attach to the exact volume dedicated to ordinal 0.

### Why WordPress Uses a Deployment with `Recreate` Strategy

WordPress is a web application with persistent assets (`wp-content/uploads`, themes, plugins). We deployed it using a standard `Deployment`, but with a crucial setting:

```yaml
spec:
  replicas: 1
  strategy:
    type: Recreate
```

#### Why Not the Default `RollingUpdate`?

By default, a Kubernetes Deployment uses `RollingUpdate`:
1. It spins up `Pod-v2` alongside `Pod-v1`.
2. It waits for `Pod-v2` to pass health checks.
3. It kills `Pod-v1`.

**The Failure Mode: The Volume Multi-Attach Error!**  
Both WordPress pods need to mount `urumi-wordpress-pvc`, which has `ReadWriteOnce` access. If Kubernetes tries to start `Pod-v2` while `Pod-v1` is still running, the storage controller throws an error:
```
Multi-Attach error for volume "pvc-78d0d23b" Volume is already exclusively attached to pod urumi-wordpress-old
```
`Pod-v2` stays stuck in `ContainerCreating` forever, and the deployment hangs!

**The Fix:**  
With `strategy.type: Recreate`, Kubernetes strictly terminates `Pod-v1` first. The volume is cleanly unmounted. Then and only then, Kubernetes launches `Pod-v2`, mounting the volume without conflicts.

---

## 5. The Database Tier: MariaDB 11.4 LTS on Kubernetes

### MariaDB vs. MySQL: History and Selection Rationale

In 2009, Oracle acquired Sun Microsystems, which owned MySQL. Monty Widenius (the original author of MySQL) was concerned about Oracle's stewardship and forked MySQL to create **MariaDB**.

Why MariaDB 11.4 LTS in our architecture?
1. **100% Binary Drop-In Compatibility**: WordPress speaks standard MySQL protocol; MariaDB supports standard MySQL clients, PDO drivers, and WP-CLI seamlessly.
2. **Open-Source Freedom**: MariaDB is governed by the MariaDB Foundation under GPLv2, free from corporate licensing restrictions.
3. **Long-Term Support (LTS)**: Version 11.4 is an active LTS release (supported through 2029).
4. **Memory Efficiency**: In small container environments, MariaDB's thread pool and InnoDB memory footprint can be tuned more compactly than modern MySQL 8.4.

### The InnoDB Storage Engine Internals

MariaDB uses **InnoDB** as its default ACID-compliant storage engine. Understanding how InnoDB writes data helps explain persistence:

```
[WordPress SQL Query]
       │
       ▼
┌────────────────────────────────────────────────────────┐
│               MariaDB Buffer Pool (RAM)               │
│               (Cached data & index pages)              │
└──────────────┬─────────────────────────┬───────────────┘
               │ Write Ahead Log (WAL)   │ Periodic Checkpoint (Flushing)
               ▼                         ▼
┌───────────────────────────┐ ┌──────────────────────────┐
│ Redo Logs: ib_logfile0    │ │ Tablespaces: ibdata1,    │
│ (Sequential, fast writes) │ │ wp_posts.ibd             │
└───────────────────────────┘ └──────────────────────────┘
               ▲                         ▲
               └────────────┬────────────┘
                            │
               Mounted Persistent Volume:
                   /var/lib/mysql
```

- When WordPress inserts an order into `wp_posts`, MariaDB writes the change to memory and appends it to the sequential **Redo Log** (`ib_logfile0`).
- Because `/var/lib/mysql` is on a PersistentVolume, even if the container is killed abruptly, InnoDB replays the redo log during startup (**crash recovery**) and restores complete data integrity.

### Container Initialization Mechanics & Password Gotchas

The official MariaDB Docker image uses an entrypoint script (`docker-entrypoint.sh`).

> [!IMPORTANT]
> **The First-Run Initialization Rule**:  
> The environment variables `MARIADB_ROOT_PASSWORD`, `MARIADB_DATABASE`, `MARIADB_USER`, and `MARIADB_PASSWORD` are **ONLY evaluated if `/var/lib/mysql` is completely empty**!  
> If the directory already contains database files, MariaDB ignores these variables and starts normally using the passwords already stored inside the MySQL user grant tables.  
> **Gotcha:** If you change the Kubernetes Secret later, MariaDB will NOT update its password on an existing volume.

### Container Health Probing with `healthcheck.sh`

Inside the `mariadb:11.4.5` container exists an official utility script: `/usr/local/bin/healthcheck.sh`.

In our Helm StatefulSet, we configure Kubernetes probes to execute this script:
```yaml
readinessProbe:
  exec:
    command: ["healthcheck.sh", "--connect", "--innodb_initialized"]
  periodSeconds: 5
```
- `--connect`: Verifies that the MariaDB socket is open and accepting TCP/socket connections.
- `--innodb_initialized`: Verifies that InnoDB has finished crash recovery and is ready to process queries (not stuck in initial log replay).

### Network Isolation: Why No Database Ingress?

In cloud security, the **Principle of Least Privilege** requires that components are never exposed beyond their required consumers.

- **WordPress** needs an Ingress because human shoppers and MCP clients must access the store from outside the cluster.
- **MariaDB** needs to be contacted **ONLY by WordPress**!
- In our Helm chart:
  - `templates/mariadb-service.yaml` creates a `ClusterIP` service (port 3306).
  - A `ClusterIP` creates an internal IP reachable only from within the Kubernetes SDN (Software-Defined Network).
  - There is **no Ingress manifest** for MariaDB.
  - Port 3306 is **not exposed** on the host machine. If you attempt `nc -zv 127.0.0.1 3306` from the host, the connection is refused.

---

## 6. The Application Tier: WordPress Core & Apache

### Containerized LAMP Stack: Apache 2.4 + PHP 8.3

Our WordPress container uses the official `wordpress:7.1.3-php8.3-apache` image:
- **Base OS**: Debian GNU/Linux 12 (bookworm).
- **Web Server**: Apache HTTP Server 2.4.68 (pre-fork MPM).
- **Runtime**: PHP 8.3.35 (embedded as `mod_php`).
- **Webroot**: `/var/www/html`.

### The Full-Webroot Persistence Model (`/var/www/html`)

In WordPress, where does user data live?
1. Text data (posts, orders, product descriptions) $\rightarrow$ in the **MariaDB database**.
2. Binary data (product images, plugin code, themes) $\rightarrow$ on the **filesystem under `wp-content/`**.

In our Helm deployment, we mount `urumi-wordpress-pvc` over the entire `/var/www/html` directory.

**Why mount the whole directory instead of just `/wp-content/uploads`?**
- When WooCommerce is installed, it downloads plugins into `/var/www/html/wp-content/plugins/woocommerce/`.
- If we only mounted uploads, any pod restart would wipe out the WooCommerce plugin installation!
- By mounting all of `/var/www/html`, WordPress core files, plugins, active themes, and uploaded media are 100% durable across pod restarts.

### How WordPress Talks to MariaDB

When WordPress starts, its `docker-entrypoint.sh` checks environment variables injected by Kubernetes:
- `WORDPRESS_DB_HOST: "urumi-mariadb:3306"` $\rightarrow$ resolves via CoreDNS to the MariaDB ClusterIP service.
- `WORDPRESS_DB_NAME: "wordpress"`
- `WORDPRESS_DB_USER: "wordpress_user"`
- `WORDPRESS_DB_PASSWORD`: sourced from Kubernetes Secret `urumi-store-secrets`.

It generates `/var/www/html/wp-config.php` linking WordPress to the database.

### Apache `.htaccess` & Pretty Permalinks: Why Rewrite Rules Matter

By default, clean WordPress installations use query-string URLs:  
`http://shop.example.com/?p=123`

The WooCommerce REST API requires **Pretty Permalinks**:  
`http://shop.example.com/wp-json/wc/v3/products`

For this to work:
1. Apache must have `mod_rewrite` enabled.
2. WordPress must write an `.htaccess` file containing rewrite rules that forward `/wp-json/*` requests to `/index.php`.
3. In Phase 2, our automation executes:
   ```bash
   wp rewrite structure '/%postname%/'
   wp rewrite flush
   ```
   This ensures that all REST API routes are recognized by Apache and routed to the WordPress kernel.

---

## 7. The Commerce Tier: WooCommerce 11.2 Architecture

### What is WooCommerce?

WooCommerce is an open-source e-commerce platform built as a WordPress plugin. It transforms WordPress from a content management system into a full transactional store with catalog management, tax calculations, shipping zones, shopping carts, and order processing.

### Database Schema Extensions: CPTs vs. Custom Tables

Historically, WooCommerce stored everything inside WordPress's core `wp_posts` table using **Custom Post Types (CPTs)**:
- A product was a post with `post_type = 'product'`.
- An order was a post with `post_type = 'shop_order'`.
- Order details were stored in `wp_postmeta` (e.g., `_order_total`, `_billing_address`).

In recent versions (including WooCommerce 11.2), WooCommerce introduced **High-Performance Order Storage (HPOS)**, which uses dedicated, indexed database tables (`wp_wc_orders`, `wp_wc_order_addresses`, `wp_wc_order_operational_data`) to dramatically improve query performance while maintaining backward compatibility with the `wc/v3` REST API.

### Products, SKUs, and Catalog Lifecycle

In our store, every product has key attributes:
- **ID**: Internal numeric auto-increment primary key.
- **Name**: Display title (e.g., `Urumi Test Mug`).
- **SKU (Stock Keeping Unit)**: Unique business identifier (e.g., `URUMI-MUG-001`). Crucial for inventory synchronization.
- **Price / Regular Price**: Base price in store currency (e.g., `₹299.00`).
- **Category**: Taxonomy grouping (e.g., `Accessories`).
- **Status**: Must be set to `publish` for the item to appear in the public catalog and REST API.

### The Checkout Flow & Why Cash on Delivery (COD)?

```
[Shopper Adds Item to Cart]
            │
            ▼
[Checkout Form: Name, Address]
            │
            ▼
[Select Payment Method: COD]
            │
            ▼
[POST /checkout/ Process Order]
            │
            ├──> Create Order Record in DB (Status: 'processing')
            ├──> Deduct Inventory / Assign Order ID (e.g. Order #14)
            └──> Redirect to /checkout/order-received/
```

**Why was Cash on Delivery (COD) chosen for Phase 2?**
1. **Zero External Dependencies**: Payment gateways like Stripe, Razorpay, or PayPal require third-party API credentials, webhook endpoints, and credit card testing environments.
2. **Deterministic Automated Verification**: COD completes synchronously in a single request without external redirects or webhook delays.
3. **Realistic Order Lifecycle**: A COD order immediately enters the `processing` status, perfectly mimicking a real e-commerce transaction ready for inventory fulfillment by our upcoming MCP tools.

### Shipping Zones & Method Option Persistence

WooCommerce uses **Shipping Zones** to determine shipping costs.
- **Zone 0 ("Rest of the World")**: The fallback zone that applies to any customer address that does not match a specific geographical zone.
- In our bootstrap, we add a `flat_rate` method to Zone 0 and configure it for **Free Shipping** (`cost: 0`).
- **Technical Gotcha**: WooCommerce stores instance-level shipping method options in `wp_options` using the dynamic key: `woocommerce_flat_rate_{instance_id}_settings`. Direct option updating ensures this is 100% deterministic across fresh installations.

---

## 8. Automation & Administration: WP-CLI Demystified

### What is WP-CLI and Why Not Use a Web Browser?

In production DevOps, clicking buttons in a web browser GUI is an **anti-pattern**:
- It cannot be automated in CI/CD pipelines.
- It is prone to human error and omission.
- It is slow and non-reproducible.

**WP-CLI** is the official command-line interface for WordPress. It allows you to perform any administrative action—installing plugins, updating options, seeding products, managing users—directly from the terminal.

### How WP-CLI Executes Commands Inside Containers

When you run:
```bash
kubectl -n urumi exec deployment/urumi-wordpress -- wp core is-installed --allow-root
```
1. `kubectl` instructs the `kubelet` on node `k3d-urumi-server-0` to fork an `exec` process inside the WordPress container namespace.
2. The `wp` wrapper script invokes PHP CLI: `/usr/local/bin/php /usr/local/bin/wp ...`.
3. WP-CLI loads WordPress's `wp-load.php` directly into the PHP CLI process memory, bypassing Apache entirely!
4. It connects directly to MariaDB via TCP port 3306, queries the database, and prints the result to standard output.
5. `--allow-root`: WordPress container runs as `root` (UID 0); WP-CLI requires this flag to acknowledge running with root privileges.

### Key WP-CLI Subcommands Explained

| Command | Purpose |
|---|---|
| `wp core is-installed` | Returns exit code 0 if WordPress tables exist, non-zero if fresh. |
| `wp core install` | Runs the initial database schema generation (creates 12 core tables). |
| `wp rewrite structure` | Sets URL rewrite rules (e.g. `/%postname%/`). |
| `wp rewrite flush` | Re-generates `.htaccess` rewrite rules on disk. |
| `wp plugin install <name> --activate` | Downloads plugin from WordPress.org repository and activates it. |
| `wp option update <key> <value>` | Updates a single setting in the `wp_options` table. |
| `wp eval '<php-code>'` | Executes arbitrary PHP code within the initialized WordPress runtime environment. Used for complex WooCommerce object manipulation. |

### The Ephemeral Container vs. Persistent Storage Dilemma

During Phase 2, we encountered a classic container lifecycle issue:
- In container images, files outside mounted volumes (like `/usr/local/bin/wp`) live in the container's **ephemeral overlay filesystem**.
- When a pod is deleted and recreated, the overlay layer is destroyed!
- Our automation script ([`scripts/bootstrap-store.sh`](file:///home/rathore/Documents/Urumi%20Assignment/scripts/bootstrap-store.sh)) solves this elegantly:
  - If `/usr/local/bin/wp` is missing, it checks if a copy exists on the persistent volume at `/var/www/html/wp-cli.phar`.
  - If so, it copies it back into `/usr/local/bin/wp`.
  - If not, it downloads it and saves a copy to `/var/www/html/wp-cli.phar`.
  - **Result**: WP-CLI is self-healing and durable across container replacements.

---

## 9. WooCommerce REST API & Security Boundaries

### How the REST API Works (`/wp-json/wc/v3`)

The WooCommerce REST API is built on top of the WordPress REST API infrastructure. It allows external applications to perform CRUD operations on store entities via standard HTTP methods:
- `GET /wp-json/wc/v3/products` $\rightarrow$ List products
- `POST /wp-json/wc/v3/products` $\rightarrow$ Create product
- `GET /wp-json/wc/v3/orders` $\rightarrow$ List orders
- `PUT /wp-json/wc/v3/orders/<id>` $\rightarrow$ Update order status

### API Key Architecture: Consumer Key & Consumer Secret

WooCommerce authenticates API requests using two paired tokens:
1. **Consumer Key (`ck_...`)**: Equivalent to a username or public API key. It is hashed (SHA-256) and stored in `wp_woocommerce_api_keys`.
2. **Consumer Secret (`cs_...`)**: Equivalent to a password.

In HTTP requests, clients provide these credentials via **HTTP Basic Authentication**:
```http
GET /wp-json/wc/v3/products HTTP/1.1
Host: shop.127.0.0.1.nip.io:8080
Authorization: Basic Y2tfZXhhbXBsZTpjc19leGFtcGxl
```
*(Where `Y2tfZXhhbXBsZTpjc19leGFtcGxl` is the base64 encoding of `consumer_key:consumer_secret`)*.

### The Problem: Basic Auth Rejection Over Plain HTTP

In the WooCommerce core codebase, the authentication handler checks:
```php
if ( ! is_ssl() ) {
    return new WP_Error(
        'woocommerce_rest_cannot_view',
        __( 'Consumer key is missing.', 'woocommerce' ),
        array( 'status' => 401 )
    );
}
```
**Why does WooCommerce do this?**  
Because HTTP Basic Authentication transmits credentials in base64 (which is unencrypted). If transmitted over plain HTTP, any attacker on the local Wi-Fi network could sniff the credentials in plaintext!

### The Solution: Hardened Must-Use Plugin (`local-dev-rest-ssl.php`)

In our local development environment, our k3d ingress runs on plain HTTP (`http://shop.127.0.0.1.nip.io:8080`). To enable our automated tests and future MCP server to communicate with the store, we deployed a **Must-Use Plugin (mu-plugin)**:

```php
<?php
/**
 * Plugin Name: Local Dev REST SSL Helper
 */
if ( ! defined( 'ABSPATH' ) ) exit;

// 1. Guard against production environments
if ( defined( 'WP_ENVIRONMENT_TYPE' ) && ! in_array( WP_ENVIRONMENT_TYPE, array( 'local', 'development' ), true ) ) {
    return;
}

// 2. Guard against non-local hostnames
$allowed_local_hosts = array( 'shop.127.0.0.1.nip.io', 'localhost', '127.0.0.1' );
$host = isset( $_SERVER['HTTP_HOST'] ) ? strtolower( explode( ':', $_SERVER['HTTP_HOST'] )[0] ) : '';

if ( in_array( $host, $allowed_local_hosts, true ) ) {
    // 3. Guard against non-REST routes
    if ( isset( $_SERVER['REQUEST_URI'] ) && strpos( $_SERVER['REQUEST_URI'], '/wp-json/wc/' ) !== false ) {
        $_SERVER['HTTPS'] = 'on';
    }
}
```

### The Security Boundary: Why This Is Strictly Local-Only

```
Does local-dev-rest-ssl.php bypass authentication?
NO! It only tricks WooCommerce into believing the transport is SSL (is_ssl() === true).
WooCommerce STILL validates the consumer key and secret against the database!
If you provide an invalid key, it still returns HTTP 401 Unauthorized.

Why MUST NOT this be used in production?
In production, credentials MUST be protected in transit by real TLS encryption.
In production (values-prod.yaml), Traefik terminates real HTTPS with Let's Encrypt certificates.
The production environment sets WP_ENVIRONMENT_TYPE = 'production', which automatically
causes this mu-plugin to abort and deactivate.
```

---

## 10. Kubernetes Secrets, Contracts, and Supply-Chain Security

### The Two-Layer Secret Contract

A core security invariant of the project: **Zero plaintext credentials in Git**.

```
Host Development Environment                   Kubernetes Cluster SDN
┌─────────────────────────────────┐           ┌──────────────────────────────────┐
│  Local Mode-0600 File           │           │  Kubernetes Secret Object        │
│  .secrets/phase2-store.env      │           │  urumi-store-secrets             │
│  (Gitignored via .gitignore)    │           │  (Namespace: urumi)              │
│  • mariadb-root-password=...    │ ────────> │  • mariadb-root-password         │
│  • mariadb-password=...         │           │  • mariadb-password              │
└─────────────────────────────────┘           └─────────────────┬────────────────┘
                                                                │
                                                                │ Mounted via secretKeyRef
                                                                ▼
                                              ┌──────────────────────────────────┐
                                              │  Pod Container Environment       │
                                              │  MARIADB_ROOT_PASSWORD           │
                                              │  MARIADB_PASSWORD                │
                                              └──────────────────────────────────┘
```

1. **Layer 1 (Developer Host)**: Generated via `openssl rand -hex 16` into `.secrets/phase2-store.env`. Permissions restricted to `0600` (readable only by your user).
2. **Layer 2 (Cluster Runtime)**: Created via `kubectl create secret generic urumi-store-secrets --from-env-file=...`.
3. **Application Consumption**: Helm manifests reference secret keys using `secretKeyRef`:
   ```yaml
   env:
     - name: MARIADB_PASSWORD
       valueFrom:
         secretKeyRef:
           name: urumi-store-secrets
           key: mariadb-password
   ```

### Container Image Digest Pinning (Immutable Artifacts)

In Docker and Kubernetes, container tags like `:latest` or even `:11.4.5` are **mutable**: a container registry maintainer can push a new image with the same tag tomorrow!

To guarantee **100% reproducible supply-chain security**, our Helm chart supports **Image Digest Pinning**:
```yaml
store:
  wordpress:
    image: "wordpress:7.1.3-php8.3-apache"
    digest: "sha256:8ecd8d8e374167ea22235acf30f80d1165b82f07ffa5bcef90c1cad8f7be251f"
```
When rendered by Helm:
`image: "wordpress:7.1.3-php8.3-apache@sha256:8ecd8d8e374167ea22235acf30f80d1165b82f07ffa5bcef90c1cad8f7be251f"`

Because a cryptographic SHA-256 digest is immutable, Kubernetes is guaranteed to pull the exact bit-for-bit identical container image on every machine, forever.

---

## 11. Resource Management & The Linux OOM Killer

### CPU Throttling vs. Memory SIGKILL (Exit Code 137)

In Kubernetes, you specify two resource values for every container:
- **`requests`**: The minimum guaranteed capacity. Used by the Kubernetes Scheduler to place pods on nodes.
- **`limits`**: The maximum allowed consumption. Enforced by Linux **cgroups (Control Groups)**.

How the Linux kernel enforces limits:
- **CPU Limit Exceeded**: The Linux CFS (Completely Fair Scheduler) **throttles** the container's CPU time. The process slows down, but it does NOT die.
- **Memory Limit Exceeded**: RAM cannot be compressed or slowed down. If a container tries to allocate 1 byte more than its memory limit, the Linux kernel **OOM (Out Of Memory) Killer** steps in and instantly kills the process with `SIGKILL` (Signal 9, exit code $128 + 9 = 137$).

### The Phase 2 OOM Debug Case: Why 384Mi Broke and 512Mi Succeeded

During our test execution of `scripts/bootstrap-store.sh`, our WordPress pod suddenly crashed with **Exit Code 137**:
```text
Last State: Terminated
Reason:     OOMKilled
Exit Code:  137
Limits:     memory: 384Mi
```

#### What Happened Inside the Cgroup?
1. The Apache web server was running with multiple worker processes serving HTTP requests (~150 MiB RAM).
2. The bootstrap script executed `kubectl exec ... wp eval ...`.
3. This launched a **separate PHP CLI process** inside the exact same container cgroup!
4. WordPress 7.1 + WooCommerce 11.2 loaded into memory for the CLI command (~180 MiB RAM).
5. Total combined memory: $150\text{ MiB (Apache)} + 180\text{ MiB (CLI PHP)} + 60\text{ MiB (OS/caches)} = 390\text{ MiB}$.
6. Because the limit was `384Mi`, the Linux kernel instantly sent `SIGKILL`!

#### The Engineering Resolution:
We analyzed host RAM availability (`free -m` revealed ~2.0 GiB available memory). We tuned `values-local.yaml`:
- **WordPress**: `requests: 256Mi`, `limits: 512Mi`
- **MariaDB**: `requests: 128Mi`, `limits: 384Mi`
Total store footprint: ~896 MiB peak, safely within your local hardware capacity. After upgrading the Helm release to Revision 2, `scripts/bootstrap-store.sh` executed cleanly to completion with zero restarts!

---

## 12. Deep Breakdown of the Automation Script (`scripts/bootstrap-store.sh`)

Here is an annotated breakdown of how [`scripts/bootstrap-store.sh`](file:///home/rathore/Documents/Urumi%20Assignment/scripts/bootstrap-store.sh) guarantees deterministic store initialization:

```bash
# 1. Pre-flight Check
# Verifies deployment exists and waits for rollout readiness before executing any commands.
kubectl --context "${KUBECONTEXT}" -n "${NAMESPACE}" rollout status deployment/urumi-wordpress --timeout=120s

# 2. WP-CLI Self-Healing
# Checks for CLI binary; if absent, restores from persistent volume cache or downloads fresh.
if [ ! -f /usr/local/bin/wp ]; then
    cp /var/www/html/wp-cli.phar /usr/local/bin/wp || curl -sS -o /usr/local/bin/wp ...
fi

# 3. Idempotent Core Installation
# Checks if WordPress tables already exist. If yes, skips install to prevent resetting admin credentials.
if wp core is-installed; then ... else wp core install ... fi

# 4. Permalink Flushing
# Sets rewrite structure to /%postname%/ and writes .htaccess rules for Apache mod_rewrite.
wp rewrite structure '/%postname%/' && wp rewrite flush

# 5. WooCommerce Activation & Page Generation
# Installs/activates plugin and calls WC_Install::create_pages() to provision Shop, Cart, and Checkout pages.
wp plugin install woocommerce --version=11.2.1 --activate

# 6. Direct Settings Persistence
# Updates wp_options directly via wp eval, avoiding fragile simulated web form posts:
# - Currency -> INR
# - COD -> Enabled
# - Flat Rate Shipping -> Cost = 0 in Zone 0
wp eval 'update_option("woocommerce_currency", "INR"); ...'

# 7. Idempotent Product Catalog Sync
# Queries products by SKU (URUMI-MUG-001, etc.). If product exists, updates attributes; if not, creates simple product.
wp eval 'foreach ($seed_products as $data) { ... wc_get_product_id_by_sku(...) ... }'

# 8. Secret & REST Key Automation
# Checks if Kubernetes Secret urumi-woocommerce-api exists. If not, generates key pair, creates Secret, and syncs local .secrets/.
kubectl create secret generic urumi-woocommerce-api --from-literal=consumer-key=... --from-literal=consumer-secret=...

# 9. Automated REST Health Verification
# Issues authenticated curl to /wp-json/wc/v3/products; validates HTTP 200 and product array length.
curl -s -u "${CK}:${CS}" "${SITE_URL}/wp-json/wc/v3/products"
```

---

## 13. Interview & Conceptual Cheat Sheet

Use these concise Q&As when discussing Phase 2 in technical interviews or architectural reviews:

### Q1: Why did you use a StatefulSet for MariaDB but a Deployment for WordPress?
> **Answer**: MariaDB requires a stable network identity, predictable pod ordinal naming (`mariadb-0`), and dedicated volume binding that must not overlap during restarts. WordPress is a stateless application layer with a shared filesystem (`/var/www/html`), which works well as a Deployment as long as the `Recreate` rollout strategy is used to prevent ReadWriteOnce volume multi-attach conflicts.

### Q2: What is the difference between PersistentVolume (PV) and PersistentVolumeClaim (PVC)?
> **Answer**: A PV is the actual physical or virtual storage resource provisioned in the cluster (like an EBS volume or host directory). A PVC is a request for storage by a developer or workload specifying size and access modes. The PVC binds 1-to-1 with an appropriate PV.

### Q3: Why did WordPress throw an Exit Code 137 error during bootstrap, and how did you debug it?
> **Answer**: Exit code 137 represents a `SIGKILL` signal sent by the Linux kernel cgroup OOM Killer. The WordPress container memory limit was set to 384Mi. When our bootstrap script executed WP-CLI commands inside the container, the concurrent memory consumption of Apache worker processes plus the PHP CLI runtime exceeded 384Mi. We diagnosed it using `kubectl describe pod` (showing `Reason: OOMKilled`), inspected host RAM (`free -m`), and tuned the memory limit to 512Mi.

### Q4: How does WooCommerce authenticate REST API requests, and what issue arose in local development?
> **Answer**: WooCommerce uses HTTP Basic Authentication with a Consumer Key and Secret. By default, WooCommerce core blocks Basic Auth over plain HTTP (`is_ssl() === false`) to prevent credential sniffing. Because our local k3d ingress operates on HTTP port 8080, we deployed a hardened Must-Use Plugin (`local-dev-rest-ssl.php`) that sets `$_SERVER['HTTPS'] = 'on'` strictly for `/wp-json/wc/` routes on local hostnames, while verifying credentials against the database. Production uses TLS termination via Traefik and cert-manager without this plugin.

### Q5: How do you prove that your Kubernetes store is truly stateful and persistent?
> **Answer**: We conducted controlled workload replacement tests: we performed `kubectl rollout restart` on both the WordPress Deployment and MariaDB StatefulSet. We verified that new pods were spawned with new UIDs, but bound to identical PersistentVolumeClaim UIDs. After the restart, our test orders (Order #14) and seeded products remained completely intact and queryable via the REST API.

---

*End of Phase 2 Project Study Material. Authored for continuous learning and engineering excellence.*
