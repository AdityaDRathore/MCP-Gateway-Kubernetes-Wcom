import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateAndNormalizeUpstreamUrl } from '../../src/upstream/url-validator.js';
import { SSRFValidationError, SecurityError } from '../../src/upstream/types.js';

describe('Gateway Canonical URL & SSRF Validator Unit Tests (ADR-017)', () => {
  it('accepts valid approved cluster internal services and normalizes to canonical FQDN', () => {
    const res1 = validateAndNormalizeUpstreamUrl('http://urumi-woocommerce-mcp:3000/mcp');
    assert.equal(res1.normalizedFqdnUrl, 'http://urumi-woocommerce-mcp.urumi.svc.cluster.local:3000/mcp');
    assert.equal(res1.serviceName, 'urumi-woocommerce-mcp');
    assert.equal(res1.port, 3000);

    const res2 = validateAndNormalizeUpstreamUrl('http://urumi-mcp-crm.urumi.svc.cluster.local:3000/mcp');
    assert.equal(res2.normalizedFqdnUrl, 'http://urumi-mcp-crm.urumi.svc.cluster.local:3000/mcp');
    assert.equal(res2.serviceName, 'urumi-mcp-crm');

    const res3 = validateAndNormalizeUpstreamUrl('http://urumi-mcp-tasks:3000/mcp');
    assert.equal(res3.normalizedFqdnUrl, 'http://urumi-mcp-tasks.urumi.svc.cluster.local:3000/mcp');
    assert.equal(res3.serviceName, 'urumi-mcp-tasks');
  });

  it('rejects prohibited protocols (only plain http is permitted)', () => {
    assert.throws(
      () => validateAndNormalizeUpstreamUrl('https://urumi-woocommerce-mcp:3000/mcp'),
      (err: unknown) => err instanceof SSRFValidationError && err.message.includes('Only internal plain "http:"')
    );

    assert.throws(
      () => validateAndNormalizeUpstreamUrl('ftp://urumi-woocommerce-mcp:3000/mcp'),
      SSRFValidationError
    );

    assert.throws(
      () => validateAndNormalizeUpstreamUrl('file:///etc/passwd'),
      SSRFValidationError
    );
  });

  it('rejects embedded userinfo (credentials in URL)', () => {
    assert.throws(
      () => validateAndNormalizeUpstreamUrl('http://admin:secret@urumi-mcp-crm:3000/mcp'),
      (err: unknown) => err instanceof SSRFValidationError && err.message.includes('Embedded credentials')
    );

    assert.throws(
      () => validateAndNormalizeUpstreamUrl('http://user@urumi-mcp-tasks:3000/mcp'),
      (err: unknown) => err instanceof SSRFValidationError && err.message.includes('Embedded credentials')
    );
  });

  it('rejects query parameters and hash fragments', () => {
    assert.throws(
      () => validateAndNormalizeUpstreamUrl('http://urumi-mcp-crm:3000/mcp?filter=true'),
      (err: unknown) => err instanceof SSRFValidationError && err.message.includes('query strings')
    );

    assert.throws(
      () => validateAndNormalizeUpstreamUrl('http://urumi-mcp-crm:3000/mcp#anchor'),
      (err: unknown) => err instanceof SSRFValidationError && err.message.includes('hash fragments')
    );
  });

  it('rejects invalid or non-mcp pathnames', () => {
    assert.throws(
      () => validateAndNormalizeUpstreamUrl('http://urumi-mcp-crm:3000/'),
      (err: unknown) => err instanceof SSRFValidationError && err.message.includes('strictly "/mcp"')
    );

    assert.throws(
      () => validateAndNormalizeUpstreamUrl('http://urumi-mcp-crm:3000/api/v1'),
      SSRFValidationError
    );

    assert.throws(
      () => validateAndNormalizeUpstreamUrl('http://urumi-mcp-crm:3000/mcp/extra'),
      SSRFValidationError
    );
  });

  it('rejects encoded path traversal and null byte injections', () => {
    assert.throws(
      () => validateAndNormalizeUpstreamUrl('http://urumi-mcp-crm:3000/mcp%2e%2e/mcp'),
      SSRFValidationError
    );

    assert.throws(
      () => validateAndNormalizeUpstreamUrl('http://urumi-mcp-crm:3000/mcp%00'),
      SSRFValidationError
    );

    assert.throws(
      () => validateAndNormalizeUpstreamUrl('http://urumi-mcp-crm:3000/mcp/../mcp'),
      SSRFValidationError
    );
  });

  it('rejects all direct IP literals (decimal, octal, hex, integer, IPv6, mapped IPv6)', () => {
    // Decimal IPv4
    assert.throws(() => validateAndNormalizeUpstreamUrl('http://127.0.0.1:3000/mcp'), SSRFValidationError);
    assert.throws(() => validateAndNormalizeUpstreamUrl('http://10.42.0.1:3000/mcp'), SSRFValidationError);
    assert.throws(() => validateAndNormalizeUpstreamUrl('http://169.254.169.254:3000/mcp'), SSRFValidationError);

    // Octal IPv4
    assert.throws(() => validateAndNormalizeUpstreamUrl('http://0177.0.0.1:3000/mcp'), SSRFValidationError);

    // Hex IPv4
    assert.throws(() => validateAndNormalizeUpstreamUrl('http://0x7f000001:3000/mcp'), SSRFValidationError);

    // Integer IPv4
    assert.throws(() => validateAndNormalizeUpstreamUrl('http://2130706433:3000/mcp'), SSRFValidationError);

    // IPv6
    assert.throws(() => validateAndNormalizeUpstreamUrl('http://[::1]:3000/mcp'), SSRFValidationError);
    assert.throws(() => validateAndNormalizeUpstreamUrl('http://[fe80::1]:3000/mcp'), SSRFValidationError);

    // IPv4-mapped IPv6
    assert.throws(() => validateAndNormalizeUpstreamUrl('http://[::ffff:127.0.0.1]:3000/mcp'), SSRFValidationError);
  });

  it('rejects blacklisted internal hosts and infrastructure services', () => {
    assert.throws(() => validateAndNormalizeUpstreamUrl('http://urumi-mariadb:3000/mcp'), SSRFValidationError);
    assert.throws(() => validateAndNormalizeUpstreamUrl('http://urumi-wordpress:3000/mcp'), SSRFValidationError);
    assert.throws(() => validateAndNormalizeUpstreamUrl('http://urumi-gateway:3000/mcp'), SSRFValidationError);
    assert.throws(() => validateAndNormalizeUpstreamUrl('http://kubernetes.default:3000/mcp'), SSRFValidationError);
    assert.throws(() => validateAndNormalizeUpstreamUrl('http://metadata.google.internal:3000/mcp'), SSRFValidationError);
  });

  it('rejects unapproved external or cross-namespace domains', () => {
    assert.throws(() => validateAndNormalizeUpstreamUrl('http://attacker.com:3000/mcp'), SSRFValidationError);
    assert.throws(() => validateAndNormalizeUpstreamUrl('http://urumi-woocommerce-mcp.kube-system.svc.cluster.local:3000/mcp'), SSRFValidationError);
    assert.throws(() => validateAndNormalizeUpstreamUrl('http://random-service:3000/mcp'), SSRFValidationError);
  });

  it('rejects ports other than 3000 in production configuration', () => {
    assert.throws(
      () => validateAndNormalizeUpstreamUrl('http://urumi-woocommerce-mcp:80/mcp'),
      (err: unknown) => err instanceof SSRFValidationError && err.message.includes('exclusively on port 3000')
    );

    assert.throws(
      () => validateAndNormalizeUpstreamUrl('http://urumi-woocommerce-mcp:8080/mcp'),
      SSRFValidationError
    );

    assert.throws(
      () => validateAndNormalizeUpstreamUrl('http://urumi-woocommerce-mcp:3306/mcp'),
      SSRFValidationError
    );
  });

  it('rejects hostnames with trailing dots', () => {
    assert.throws(
      () => validateAndNormalizeUpstreamUrl('http://urumi-woocommerce-mcp.:3000/mcp'),
      (err: unknown) => err instanceof SSRFValidationError && err.message.includes('trailing dot')
    );
  });

  it('enforces physical production lock preventing allowLocalhostForTesting in production mode', () => {
    const origEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      assert.throws(
        () => validateAndNormalizeUpstreamUrl('http://127.0.0.1:4000/mcp', { allowLocalhostForTesting: true }),
        (err: unknown) => err instanceof SecurityError && err.message.includes('strictly forbidden in production mode')
      );
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  it('permits localhost test override when outside production and explicitly opted in', () => {
    const origEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'test';
      const result = validateAndNormalizeUpstreamUrl('http://127.0.0.1:4567/mcp', { allowLocalhostForTesting: true });
      assert.equal(result.normalizedFqdnUrl, 'http://127.0.0.1:4567/mcp');
      assert.equal(result.port, 4567);
      assert.equal(result.serviceName, 'localhost-test');
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });
});
