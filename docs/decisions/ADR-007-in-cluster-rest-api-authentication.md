# ADR-007: In-Cluster WooCommerce REST API Authentication via OAuth 1.0a HMAC-SHA256

**Status**: Accepted  
**Date**: 2026-10-12  
**Decision Makers**: Aditya Rathore (FDE Candidate), Antigravity AI  

---

## 1. Context & Problem Statement

In Phase 3, the custom WooCommerce MCP server (`apps/woocommerce-mcp`) runs as a private, unexposed container within the `urumi` Kubernetes namespace and communicates with the WordPress/WooCommerce service (`urumi-wordpress.urumi.svc.cluster.local:80`) over the internal ClusterIP network.

In Phase 2, [`ADR-005`](./ADR-005-local-rest-api-security-boundary.md) established a local development must-use plugin ([`local-dev-rest-ssl.php`](../../infra/helm/urumi-platform/files/local-dev-rest-ssl.php)) to satisfy WooCommerce core's `is_ssl()` check for HTTP Basic Authentication. However, this helper enforces strict defense-in-depth hostname restrictions:
```php
$allowed_local_hosts = array(
    'shop.127.0.0.1.nip.io',
    'localhost',
    '127.0.0.1',
);
```

When an in-cluster pod calls the internal Kubernetes service hostname `urumi-wordpress.urumi.svc.cluster.local:80`, `$_SERVER['HTTP_HOST']` does not match `$allowed_local_hosts`. Consequently, `$_SERVER['HTTPS'] = 'on'` is not set, causing WooCommerce core to reject HTTP Basic Authentication with `HTTP 401 Unauthorized` (`woocommerce_rest_cannot_view`).

Furthermore, HTTP Basic Authentication encodes credentials in Base64 (`consumer_key:consumer_secret`). Base64 is encoding, not encryption. Transmitting consumer secrets over unencrypted HTTP fails security invariants. We required a verified, secure authentication mechanism that does not leak consumer secrets across the network or weaken existing safeguards.

---

## 2. Controlled Investigation & Empirical Evidence

During Gate G1, we conducted controlled tests from within the Kubernetes cluster (`urumi` namespace):

1. **Option A — Internal TLS (mod_ssl / pod-to-pod TLS)**:
   - Evaluated enabling TLS on Apache inside `wordpress:7.1.3-php8.3-apache`.
   - **Finding**: Apache's `mod_ssl` is disabled by default in standard WordPress images. Establishing pod-to-pod TLS requires provisioning a local CA and custom certificate distribution, introducing excessive developer friction previously rejected in [`ADR-005`](./ADR-005-local-rest-api-security-boundary.md).

2. **Option B — Native WooCommerce OAuth 1.0a (One-Legged RFC 5849)**:
   - WooCommerce core ([`class-wc-rest-authentication.php:perform_oauth_authentication()`](https://github.com/woocommerce/woocommerce)) natively implements RFC 5849 one-legged OAuth 1.0a authentication specifically for non-SSL HTTP connections.
   - **How it works**:
     - The consumer key is passed as `oauth_consumer_key`.
     - The consumer secret is **never transmitted across the network**. It is used exclusively to generate an HMAC-SHA256 signature (`oauth_signature`) over a canonical base string consisting of the HTTP method, normalized request URL, and sorted request parameters.
     - Replay attacks are mitigated by unique nonces (`oauth_nonce`) and timestamps (`oauth_timestamp`).
   - **Canonical URL Nuance Discovered**:
     - WooCommerce core's `check_oauth_signature` constructs the base request URI using `get_home_url(null, $request_path, 'http')`.
     - In this WordPress installation, `home_url()` evaluates to `http://shop.127.0.0.1.nip.io:8080`.
     - When the client connects over internal ClusterIP (`http://urumi-wordpress.urumi.svc.cluster.local:80/wp-json/wc/v3/...`), the HMAC-SHA256 signature must be computed using `http://shop.127.0.0.1.nip.io:8080/wp-json/wc/v3/...` as the base URI.
   - **Live In-Cluster Verification**:
     - Authenticated Catalog Read (`GET /wp-json/wc/v3/products`): **HTTP 200 OK** (returned all 3 seeded products).
     - Authenticated Product Write (`POST /wp-json/wc/v3/products`): **HTTP 201 Created** (created and subsequently deleted test post 19).
     - Negative Auth (Invalid Consumer Secret): **HTTP 401 Unauthorized** (`"Invalid signature - provided signature does not match."`).
     - Negative Auth (Invalid Consumer Key): **HTTP 401 Unauthorized** (`"Consumer key is invalid."`).
     - Negative Auth (Missing Credentials): **HTTP 401 Unauthorized** (`"woocommerce_rest_cannot_view"`).

3. **Option C — Modifying local-dev-rest-ssl.php / Spoofing Host Header**:
   - Adding `urumi-wordpress.urumi.svc.cluster.local` to `$allowed_local_hosts` would allow Basic Auth over HTTP.
   - **Rejected**: Transmits consumer secrets in plaintext Base64 over unencrypted network links, violating security guidelines.

---

## 3. Decision

We adopt **Option B: OAuth 1.0a with HMAC-SHA256** for all communication between the custom WooCommerce MCP server and the WordPress store service over the internal Kubernetes network:

1. **Client Implementation**:
   - The TypeScript WooCommerce client in `apps/woocommerce-mcp` implements deterministic HMAC-SHA256 signing matching WooCommerce core.
   - Request network path targets `http://urumi-wordpress.urumi.svc.cluster.local:80/wp-json/wc/v3/...`.
   - Signature base URI targets `http://shop.127.0.0.1.nip.io:8080/wp-json/wc/v3/...` (configurable via `WOOCOMMERCE_SITE_URL`).

2. **Zero Modification to Core Safeguards**:
   - [`local-dev-rest-ssl.php`](../../infra/helm/urumi-platform/files/local-dev-rest-ssl.php) remains completely unchanged.
   - Hostname restrictions remain intact, and production safeguards are preserved.

3. **Secrecy Guarantees**:
   - The `consumer_secret` remains strictly sealed within the MCP server process memory and is never written to HTTP headers, query strings, logs, or network packets.

---

## 4. Consequences & Limitations

- **Positive**:
  - Eliminates transmission of consumer secrets in Base64 over unencrypted networks.
  - Native WooCommerce support requires zero custom WordPress plugins or database modifications.
  - Enforces cryptographic request integrity and timestamp replay protection.
- **Limitations**:
  - OAuth 1.0a provides authenticity, integrity, and non-repudiation of signed parameters, but does **not** encrypt the request payload body (e.g. product descriptions).
  - Risk is accepted strictly because traffic is confined to the private internal Kubernetes cluster network (`urumi` namespace ClusterIP overlay) and is never routed over public networks.
  - Clock skew between the MCP pod and WordPress pod must remain within WooCommerce's acceptable window (typically $\pm 10$ minutes).
