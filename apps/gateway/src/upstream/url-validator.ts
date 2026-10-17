import { SSRFValidationError, SecurityError } from './types.js';

export interface UrlValidatorOptions {
  /**
   * Only permitted during unit/protocol tests outside production.
   * Physically locked and throws SecurityError if NODE_ENV === 'production'.
   */
  allowLocalhostForTesting?: boolean;
}

export interface ValidatedUpstreamEndpoint {
  originalInput: string;
  normalizedFqdnUrl: string;
  serviceName: string;
  port: number;
  pathname: string;
}

const APPROVED_UPSTREAM_SERVICES = new Set<string>([
  'urumi-woocommerce-mcp',
  'urumi-mcp-crm',
  'urumi-mcp-tasks',
]);

const PROHIBITED_HOSTNAMES = new Set<string>([
  'localhost',
  '127.0.0.1',
  '::1',
  '169.254.169.254',
  'metadata.google.internal',
  'kubernetes',
  'kubernetes.default',
  'kubernetes.default.svc',
  'kubernetes.default.svc.cluster.local',
  'urumi-mariadb',
  'urumi-mariadb.urumi.svc.cluster.local',
  'urumi-wordpress',
  'urumi-wordpress.urumi.svc.cluster.local',
  'urumi-gateway',
  'urumi-gateway.urumi.svc.cluster.local',
]);

/**
 * Validates and normalizes upstream MCP endpoint URLs according to ADR-017 SSRF defense rules.
 * Fails closed on any ambiguity, malformed structure, or unauthorized destination.
 */
export function validateAndNormalizeUpstreamUrl(
  inputUrl: string,
  options?: UrlValidatorOptions
): ValidatedUpstreamEndpoint {
  // Step 0: Input validation
  if (!inputUrl || typeof inputUrl !== 'string') {
    throw new SSRFValidationError('URL must be a non-empty string');
  }

  const trimmed = inputUrl.trim();
  if (trimmed.length > 512) {
    throw new SSRFValidationError('URL length exceeds maximum permissible limit of 512 characters');
  }

  // Step 1: Physical lock on test overrides in production mode
  const isProduction = process.env.NODE_ENV === 'production';
  if (options?.allowLocalhostForTesting && isProduction) {
    throw new SecurityError(
      'SSRF Violation: allowLocalhostForTesting is strictly forbidden in production mode'
    );
  }

  const allowLocalhost = Boolean(options?.allowLocalhostForTesting && !isProduction);

  // Step 2: Pre-parse adversarial encoded character checks
  const lowerInput = trimmed.toLowerCase();
  if (
    lowerInput.includes('%00') || // null byte injection
    lowerInput.includes('%2e%2e') || // path traversal
    lowerInput.includes('/../') ||
    lowerInput.includes('/./')
  ) {
    throw new SSRFValidationError('URL contains prohibited encoded characters or path traversal sequences');
  }

  // Step 3: WHATWG URL Parsing
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (err: unknown) {
    throw new SSRFValidationError(`Malformed URL structure: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 4: Protocol check (Strictly plain HTTP internal cluster protocol)
  if (parsed.protocol !== 'http:') {
    throw new SSRFValidationError(
      `Prohibited protocol "${parsed.protocol}": Only internal plain "http:" protocol is permitted`
    );
  }

  // Step 5: Userinfo check (Credentials in URL strictly forbidden)
  if (parsed.username !== '' || parsed.password !== '') {
    throw new SSRFValidationError('Prohibited userinfo: Embedded credentials in upstream URL are strictly forbidden');
  }

  // Step 6: Query parameters and fragments check
  if (parsed.search !== '') {
    throw new SSRFValidationError('Prohibited query parameters: Upstream endpoint URLs must not contain query strings');
  }
  if (parsed.hash !== '') {
    throw new SSRFValidationError('Prohibited URL fragment: Upstream endpoint URLs must not contain hash fragments');
  }

  // Step 7: Pathname check (Strictly /mcp)
  if (parsed.pathname !== '/mcp') {
    throw new SSRFValidationError(
      `Prohibited path "${parsed.pathname}": Upstream endpoint path must be strictly "/mcp"`
    );
  }

  // Step 8: Hostname sanitization and trailing dot rejection
  const rawHostname = parsed.hostname;
  if (rawHostname.endsWith('.')) {
    throw new SSRFValidationError(`Prohibited trailing dot in hostname: "${rawHostname}"`);
  }
  const hostnameLower = rawHostname.toLowerCase();

  // Step 9: IP literal detection (decimal, octal, hex, integer, IPv6, IPv4-mapped)
  const isDecimalIpv4 = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(hostnameLower);
  const isOctalOrHexIpv4 = /^(?:0[0-7]+|0x[0-9a-fA-F]+|\d+)(?:\.(?:0[0-7]+|0x[0-9a-fA-F]+|\d+)){0,3}$/.test(hostnameLower);
  const isNumericOnly = /^\d+$/.test(hostnameLower);
  const isIpv6 = hostnameLower.startsWith('[') && hostnameLower.endsWith(']');
  const isRawIpv6 = hostnameLower.includes(':');

  if (isDecimalIpv4 || isOctalOrHexIpv4 || isNumericOnly || isIpv6 || isRawIpv6) {
    if (!allowLocalhost || (hostnameLower !== '127.0.0.1' && hostnameLower !== '[::1]')) {
      throw new SSRFValidationError(`Prohibited direct IP literal address: "${rawHostname}"`);
    }
  }

  // Step 10: Port validation
  const port = parsed.port ? parseInt(parsed.port, 10) : 80;
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new SSRFValidationError(`Invalid port number: "${parsed.port}"`);
  }

  // Step 11: Destination and host allowlist / blacklist check
  if (allowLocalhost && (hostnameLower === 'localhost' || hostnameLower === '127.0.0.1')) {
    // Permitted strictly in test mode with ephemeral ports
    return {
      originalInput: inputUrl,
      normalizedFqdnUrl: `http://${hostnameLower}:${port}/mcp`,
      serviceName: 'localhost-test',
      port,
      pathname: '/mcp',
    };
  }

  // In production / non-test mode:
  if (PROHIBITED_HOSTNAMES.has(hostnameLower)) {
    throw new SSRFValidationError(`Prohibited target host "${hostnameLower}": Target is on the SSRF blacklist`);
  }

  // Enforce port 3000 for approved cluster services
  if (port !== 3000) {
    throw new SSRFValidationError(
      `Unapproved port "${port}": Approved upstream MCP services listen exclusively on port 3000`
    );
  }

  // Reconcile short service name vs cluster FQDN
  let serviceName: string;
  const fqdnSuffix = '.urumi.svc.cluster.local';

  if (hostnameLower.endsWith(fqdnSuffix)) {
    serviceName = hostnameLower.slice(0, -fqdnSuffix.length);
  } else if (!hostnameLower.includes('.')) {
    serviceName = hostnameLower;
  } else {
    throw new SSRFValidationError(
      `Prohibited hostname "${hostnameLower}": Cross-namespace or external domains are not permitted`
    );
  }

  if (!APPROVED_UPSTREAM_SERVICES.has(serviceName)) {
    throw new SSRFValidationError(
      `Unapproved service "${serviceName}": Only approved internal cluster services (${Array.from(
        APPROVED_UPSTREAM_SERVICES
      ).join(', ')}) are allowed`
    );
  }

  const normalizedFqdnUrl = `http://${serviceName}.urumi.svc.cluster.local:3000/mcp`;

  return {
    originalInput: inputUrl,
    normalizedFqdnUrl,
    serviceName,
    port: 3000,
    pathname: '/mcp',
  };
}
