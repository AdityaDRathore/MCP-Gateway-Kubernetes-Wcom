# Phase 2 Container Image & Version Lock

**Document Type:** Formal Version Lock & Compatibility Record  
**Phase:** Phase 2 (Stateful WooCommerce Store Deployment)  
**Host Architecture:** `x86_64` (`linux/amd64`)  
**Date Locked:** 11 October 2026  

---

## 1. Locked Container Images

| Component | Repository & Tag | Platform | Digest (SHA256) | Notes / Selection Rationale |
|---|---|---|---|---|
| **Kubernetes (K3s)** | `rancher/k3s:v1.37.1-k3s1` | `linux/amd64` | `sha256:8d298cb81ca94e875d31e804e5aa10b56355d1d7d95d7e1ef8a8d9239f15ada0` | Matches host `kubectl v1.37.1` with 0 minor version skew. Resolves the 6-minor skew in k3d's default. |
| **WordPress Core** | `wordpress:7.1.3-php8.3-apache` | `linux/amd64` | `sha256:8ecd8d8e374167ea22235acf30f80d1165b82f07ffa5bcef90c1cad8f7be251f` | Actively maintained 7.1 series release (October 2026) required by WooCommerce 11.2+. |
| **MariaDB Server** | `mariadb:11.4.5` | `linux/amd64` | `sha256:49117dcc565cf51aa57ac5fca59ab31213402ff0eae6ffc13c46a37b938f7e4b` | Fixed patch release in the 11.4 LTS series, replacing floating `mariadb:11.4`. |

---

## 2. Application & Plugin Versions

| Component | Version | Release Date | Compatibility Boundary |
|---|---|---|---|
| **WordPress Core** | `7.1.3` | October 2026 | PHP 8.3 / Apache 2.4 |
| **PHP Runtime** | `8.3.35` | — | Embedded in `wordpress:7.1.3-php8.3-apache` |
| **Apache Web Server** | `2.4.68` | — | Embedded in `wordpress:7.1.3-php8.3-apache` |
| **MariaDB Server** | `11.4.5-MariaDB-ubu2404`| — | InnoDB storage engine with `healthcheck.sh` |
| **WooCommerce Plugin** | `11.2.1` | October 2026 | Requires WordPress 7.0+, tested through WordPress 7.1.3 |
| **WP-CLI Tool** | `2.12.0` | — | Deployed inside web container for administrative bootstrap |

---

## 3. Compatibility & Storage Architecture Notes

1. **WordPress 6.7 $\rightarrow$ 7.1 Upgrade Decision**:  
   The initial Phase 1 scaffold specified `wordpress:6.7-php8.2-apache`. However, WooCommerce 11.2+ officially declares a minimum requirement of WordPress 7.0+. Pinned `wordpress:7.1.3-php8.3-apache` ensures active maintenance and complete compatibility with WooCommerce 11.2.1.
2. **Webroot Storage Boundary (`/var/www/html`)**:  
   Mounting `urumi-wordpress-pvc` on `/var/www/html` preserves all plugins, themes, media uploads, and WordPress core files across pod crashes and replacements. Note that changing the container image tag will not automatically overwrite the files already residing on the persistent volume; core upgrades on existing volumes must be managed via WP Admin/WP-CLI.
3. **Database Health Probes**:  
   The official `/usr/local/bin/healthcheck.sh` was verified present inside `mariadb:11.4.5` and tested inside the container for both `--connect` and `--innodb_initialized` flags.
