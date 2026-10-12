# ADR-005: Local Development REST API Authentication and Security Boundary

**Status**: Accepted  
**Date**: 2026-10-12  
**Decision Makers**: Aditya Rathore (FDE Candidate), Antigravity AI  

---

## 1. Context & Problem Statement

Phase 2 requires verifying authenticated REST API read and write operations against WooCommerce core (`/wp-json/wc/v3/`), and Phase 3 requires the custom WooCommerce MCP server to communicate with the store via REST API endpoints.

In our local development environment (`k3d-urumi`), Traefik routes traffic over **plain HTTP** on host port `8080` (`http://shop.127.0.0.1.nip.io:8080`).

By default, WooCommerce core enforces a transport security check:
```php
if ( ! is_ssl() ) {
    return new WP_Error(
        'woocommerce_rest_cannot_view',
        __( 'Consumer key is missing.', 'woocommerce' ),
        array( 'status' => 401 )
    );
}
```
Because HTTP Basic Authentication transmits credentials encoded in base64 (unencrypted), WooCommerce deliberately blocks Basic Auth over plain HTTP to prevent credential sniffing on public networks.

However, running a local PKI / cert-manager with self-signed SSL on local port 8443 creates significant local developer friction (browser SSL warnings, missing Node.js CA trust roots, and curl certificate verification errors). We must establish a mechanism that enables local REST API development without weakening security or leaking exceptions into production.

---

## 2. Decision

1. **Hardened Must-Use Plugin (`local-dev-rest-ssl.php`)**:
   - Implemented and tracked a version-controlled must-use plugin at [`infra/helm/urumi-platform/files/local-dev-rest-ssl.php`](../infra/helm/urumi-platform/files/local-dev-rest-ssl.php), automatically deployed to `/var/www/html/wp-content/mu-plugins/` during store bootstrap.
   - Sets `$_SERVER['HTTPS'] = 'on'` strictly to satisfy WooCommerce's `is_ssl()` check for Basic Auth over plain HTTP.

2. **Strict Defense-in-Depth Guardrails**:
   - **Environment Guard**: Checks `WP_ENVIRONMENT_TYPE`. If configured as `staging` or `production`, execution aborts immediately:
     ```php
     if ( defined( 'WP_ENVIRONMENT_TYPE' ) && ! in_array( WP_ENVIRONMENT_TYPE, array( 'local', 'development' ), true ) ) {
         return;
     }
     ```
   - **Host Whitelist Guard**: Strictly restricts activation to explicit local development hostnames (`shop.127.0.0.1.nip.io`, `localhost`, `127.0.0.1`). Any request targeting external domains or IP addresses is ignored.
   - **URI Path Isolation**: Targets exclusively requests containing `/wp-json/wc/`. Standard web browsing, admin sessions, and non-WooCommerce routes are untouched.

3. **No Authentication Bypass**:
   - The plugin does **not** bypass or weaken user authentication. WooCommerce core still parses the HTTP Basic `Authorization` header, extracts the Consumer Key and Consumer Secret, hashes the key (SHA-256), and matches it against the database table `wp_woocommerce_api_keys`.
   - Verified: requests with missing credentials or invalid keys return `HTTP 401 Unauthorized`.

4. **Explicit Production Boundary**:
   - In production (`values-prod.yaml`), the store is deployed behind Traefik on port 443 with TLS certificates managed automatically by `cert-manager` and Let's Encrypt (`ingress.tls.enabled = true`).
   - Traefik terminates TLS and forwards legitimate `X-Forwarded-Proto: https` headers.
   - The `local-dev-rest-ssl.php` mu-plugin is **strictly excluded** from production Helm releases and filesystem images.

---

## 3. Alternatives Considered & Rejected

| Alternative | Reason for Rejection |
| :--- | :--- |
| **Local Self-Signed SSL Certificates (mkcert / local cert-manager)** | High developer friction. Requires installing custom local Root CAs into Node.js runtimes, curl trust stores, and browsers. Does not improve security on `127.0.0.1` loopback interfaces. |
| **Bypassing WooCommerce Authentication Entirely** | Severe security defect. Violates the requirement to verify negative authentication barriers (HTTP 401 enforcement). |
| **Query Parameter Authentication (`?consumer_key=...&consumer_secret=...`)** | Still rejected by WooCommerce when `is_ssl() === false`, and exposes sensitive API secrets in server access logs and browser histories. |
| **Unconditional `$_SERVER['HTTPS'] = 'on'` Hook** | Insecure. If accidentally bundled into a production container, it could allow unencrypted credential transmission over public HTTP. |

---

## 4. Consequences & Verification

- **Positive**: 
  - Automated test suite (`scripts/test_rest_api.js`) and `scripts/bootstrap-store.sh` communicate reliably with WooCommerce over local HTTP.
  - Negative authentication tests pass: 401 returned for missing and invalid keys.
  - Positive tests pass: 200 returned for authenticated catalog reads, order reads, and temporary writes.
- **Negative / Constraints**:
  - The local development environment must be documented with an explicit operational boundary noting that credentials travel over plain HTTP on port 8080 (acceptable strictly because traffic is confined to the local machine loopback).
