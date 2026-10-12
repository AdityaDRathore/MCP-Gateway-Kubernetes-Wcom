<?php
/**
 * Plugin Name: Local Dev REST SSL Helper
 * Description: Enables WooCommerce REST API Basic Authentication strictly in local development environments.
 * 
 * SECURITY BOUNDARY:
 * ------------------
 * In local development (k3d / nip.io), traffic runs over HTTP (port 8080).
 * By default, WooCommerce core blocks Basic Authentication over non-SSL connections (is_ssl() === false).
 * This mu-plugin sets $_SERVER['HTTPS'] = 'on' ONLY for requests targeting /wp-json/wc/
 * when accessed via explicit local development hostnames.
 * 
 * CRITICAL PRODUCTION WARNING:
 * ----------------------------
 * MUST NOT BE DEPLOYED TO PRODUCTION.
 * In production environments, TLS MUST be terminated at the Ingress controller (Traefik / Cert-Manager),
 * providing legitimate end-to-end encryption for API credentials in transit.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

// 1. Guard against non-local environment types if configured in wp-config.php
if ( defined( 'WP_ENVIRONMENT_TYPE' ) && ! in_array( WP_ENVIRONMENT_TYPE, array( 'local', 'development' ), true ) ) {
    return;
}

// 2. Host-based guard: only allow execution for explicit local development domains
$allowed_local_hosts = array(
    'shop.127.0.0.1.nip.io',
    'localhost',
    '127.0.0.1',
);

$host = isset( $_SERVER['HTTP_HOST'] ) ? strtolower( explode( ':', $_SERVER['HTTP_HOST'] )[0] ) : '';

if ( in_array( $host, $allowed_local_hosts, true ) ) {
    // 3. URI-based guard: only target WooCommerce REST API routes
    if ( isset( $_SERVER['REQUEST_URI'] ) && strpos( $_SERVER['REQUEST_URI'], '/wp-json/wc/' ) !== false ) {
        // Satisfies WooCommerce core is_ssl() check for Basic Auth over local HTTP.
        // NOTE: This does NOT bypass authentication; WooCommerce still verifies consumer key and secret.
        $_SERVER['HTTPS'] = 'on';
    }
}
