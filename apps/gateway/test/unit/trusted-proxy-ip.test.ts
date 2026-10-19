import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express, { Request } from 'express';
import { getClientIp, isTrustedProxy, normalizeIp } from '../../src/http/client-ip.js';
import { LoginRateLimiter } from '../../src/auth/login-rate-limiter.js';

describe('Trusted Proxy Boundary & Client IP Resolution Unit Tests (P5-G2 Condition 2)', () => {
  it('normalizes IPv4-mapped IPv6 addresses correctly', () => {
    assert.strictEqual(normalizeIp('::ffff:127.0.0.1'), '127.0.0.1');
    assert.strictEqual(normalizeIp('::ffff:192.168.1.10'), '192.168.1.10');
    assert.strictEqual(normalizeIp('10.42.0.15'), '10.42.0.15');
    assert.strictEqual(normalizeIp('::1'), '::1');
  });

  it('matches trusted proxy IPs and CIDR blocks accurately', () => {
    const trustedProxies = ['127.0.0.1', '::1', '10.42.0.0/16', '10.43.0.0/16'];

    // Exact matches
    assert.strictEqual(isTrustedProxy('127.0.0.1', trustedProxies), true);
    assert.strictEqual(isTrustedProxy('::1', trustedProxies), true);
    assert.strictEqual(isTrustedProxy('::ffff:127.0.0.1', trustedProxies), true);

    // CIDR range matches
    assert.strictEqual(isTrustedProxy('10.42.1.25', trustedProxies), true);
    assert.strictEqual(isTrustedProxy('10.43.0.1', trustedProxies), true);
    assert.strictEqual(isTrustedProxy('10.42.255.254', trustedProxies), true);

    // Untrusted IPs outside range
    assert.strictEqual(isTrustedProxy('10.44.0.1', trustedProxies), false);
    assert.strictEqual(isTrustedProxy('192.168.1.1', trustedProxies), false);
    assert.strictEqual(isTrustedProxy('203.0.113.50', trustedProxies), false);
  });

  it('strictly ignores X-Forwarded-For when connecting from an untrusted remote IP', () => {
    // Untrusted remote peer
    const mockReq = {
      socket: { remoteAddress: '198.51.100.22' },
      headers: {
        'x-forwarded-for': '203.0.113.99, 10.0.0.1',
      },
    } as unknown as Request;

    const trustedProxies = ['127.0.0.1', '10.42.0.0/16'];
    const resolvedIp = getClientIp(mockReq, trustedProxies);

    // Must return the direct socket IP, completely ignoring the spoofed X-Forwarded-For header
    assert.strictEqual(resolvedIp, '198.51.100.22');
  });

  it('extracts genuine client IP from rightmost hop when connecting through a trusted proxy', () => {
    // Trusted proxy connection (e.g. Traefik pod at 10.42.1.5)
    const mockReq = {
      socket: { remoteAddress: '10.42.1.5' },
      headers: {
        'x-forwarded-for': '203.0.113.88',
      },
    } as unknown as Request;

    const trustedProxies = ['10.42.0.0/16'];
    const resolvedIp = getClientIp(mockReq, trustedProxies);

    assert.strictEqual(resolvedIp, '203.0.113.88');
  });

  it('strips spoofed preceding hops when forwarded through a trusted proxy', () => {
    // Client sent "X-Forwarded-For: 1.1.1.1, 2.2.2.2" to Traefik,
    // and Traefik appended the real peer IP "198.51.100.77"
    const mockReq = {
      socket: { remoteAddress: '10.42.1.5' },
      headers: {
        'x-forwarded-for': '1.1.1.1, 2.2.2.2, 198.51.100.77',
      },
    } as unknown as Request;

    const trustedProxies = ['10.42.0.0/16'];
    const resolvedIp = getClientIp(mockReq, trustedProxies);

    // Rightmost hop added by Traefik is trusted; preceding spoofed IPs are discarded
    assert.strictEqual(resolvedIp, '198.51.100.77');
  });

  it('falls back safely to socket address if X-Forwarded-For contains invalid or malformed data', () => {
    const mockReq = {
      socket: { remoteAddress: '10.42.1.5' },
      headers: {
        'x-forwarded-for': 'not-an-ip-address, <script>alert(1)</script>',
      },
    } as unknown as Request;

    const trustedProxies = ['10.42.0.0/16'];
    const resolvedIp = getClientIp(mockReq, trustedProxies);

    assert.strictEqual(resolvedIp, '10.42.1.5');
  });

  it('prevents rate limit bypass by an attacker rotating spoofed X-Forwarded-For on untrusted connection', () => {
    const rateLimiter = new LoginRateLimiter({ maxAttempts: 3, windowMs: 60000 });
    const trustedProxies = ['10.42.0.0/16']; // Untrusted socket '198.51.100.1' is NOT trusted

    // Attacker connects from socket '198.51.100.1' and sends 3 attempts with rotating spoofed X-Forwarded-For
    const spoofedIps = ['1.2.3.4', '5.6.7.8', '9.10.11.12'];

    for (const spoof of spoofedIps) {
      const mockReq = {
        socket: { remoteAddress: '198.51.100.1' },
        headers: { 'x-forwarded-for': spoof },
      } as unknown as Request;

      const clientIp = getClientIp(mockReq, trustedProxies);
      assert.strictEqual(clientIp, '198.51.100.1'); // Spoof was rejected

      rateLimiter.recordFailure(clientIp, 'victim_user');
    }

    // 4th attempt from same untrusted socket with yet another spoofed IP
    const fourthReq = {
      socket: { remoteAddress: '198.51.100.1' },
      headers: { 'x-forwarded-for': '99.99.99.99' },
    } as unknown as Request;

    const resolvedFourthIp = getClientIp(fourthReq, trustedProxies);
    const status = rateLimiter.checkLimit(resolvedFourthIp, 'victim_user');

    // Must be blocked because the real socket address was rate limited!
    assert.strictEqual(status.limited, true);
  });
});
