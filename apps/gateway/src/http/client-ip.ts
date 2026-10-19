import { Request } from 'express';
import net from 'node:net';

/**
 * Normalizes an IP string (strips IPv4-mapped IPv6 prefix `::ffff:` and trims whitespace).
 */
export function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice(7);
  }
  return trimmed;
}

/**
 * Checks whether an IP belongs to a trusted proxy definition.
 * Supports exact IP matching (IPv4/IPv6) and standard CIDR notation (/16, /24, etc).
 */
export function isTrustedProxy(remoteIp: string, trustedProxies: string[]): boolean {
  const normalizedRemote = normalizeIp(remoteIp);

  for (const trusted of trustedProxies) {
    const normalizedTrusted = normalizeIp(trusted);

    // Exact match
    if (normalizedRemote === normalizedTrusted) {
      return true;
    }

    // Loopback aliases
    if (
      (normalizedTrusted === '127.0.0.1' || normalizedTrusted === 'localhost' || normalizedTrusted === '::1') &&
      (normalizedRemote === '127.0.0.1' || normalizedRemote === '::1')
    ) {
      return true;
    }

    // CIDR range matching
    if (normalizedTrusted.includes('/')) {
      if (ipInCidr(normalizedRemote, normalizedTrusted)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Basic IPv4 CIDR matching.
 */
function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  if (isNaN(bits) || bits < 0 || bits > 32) {
    return false;
  }

  if (net.isIPv4(ip) && net.isIPv4(range)) {
    const ipNum = ipv4ToNumber(ip);
    const rangeNum = ipv4ToNumber(range);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipNum & mask) === (rangeNum & mask);
  }

  return false;
}

function ipv4ToNumber(ip: string): number {
  return ip
    .split('.')
    .reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0);
}

/**
 * Determines the genuine client IP address based on verified proxy trust boundaries.
 * 
 * Rules:
 * 1. If req.socket.remoteAddress is NOT a trusted proxy, X-Forwarded-For is strictly UNTRUSTED
 *    and completely ignored. Returns socket remote address.
 * 2. If req.socket.remoteAddress IS a trusted proxy:
 *    - In our 1-hop Traefik topology, Traefik appends the direct client address to the rightmost
 *      position of X-Forwarded-For.
 *    - The genuine client IP is the rightmost IP in X-Forwarded-For. Preceding entries may be
 *      client-spoofed and are ignored.
 *    - If the header is missing or rightmost entry is invalid, falls back safely to remoteAddress.
 */
export function getClientIp(req: Request, trustedProxies: string[] = []): string {
  const socketAddress = req.socket.remoteAddress || '127.0.0.1';
  const normalizedSocket = normalizeIp(socketAddress);

  if (!isTrustedProxy(normalizedSocket, trustedProxies)) {
    // Direct or untrusted connection: do NOT trust forwarded headers
    return normalizedSocket;
  }

  // Trusted proxy connection: extract rightmost IP from X-Forwarded-For
  const xff = req.headers['x-forwarded-for'];
  if (!xff) {
    return normalizedSocket;
  }

  const xffString = Array.isArray(xff) ? xff.join(',') : xff;
  const hops = xffString.split(',').map((h) => h.trim()).filter((h) => h.length > 0);
  if (hops.length === 0) {
    return normalizedSocket;
  }

  // Rightmost hop before the trusted proxy
  const clientCandidate = normalizeIp(hops[hops.length - 1]);
  if (net.isIP(clientCandidate)) {
    return clientCandidate;
  }

  return normalizedSocket;
}
