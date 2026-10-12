/**
 * Typed domain errors and safe error mapper for WooCommerce REST API operations.
 */

export class WooCommerceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly errorCode: string,
    public readonly isRetryable: boolean = false
  ) {
    super(message);
    this.name = 'WooCommerceError';
  }
}

export class AuthenticationError extends WooCommerceError {
  constructor(message = 'Upstream WooCommerce authentication failed. Check credentials.') {
    super(message, 401, 'UNAUTHORIZED', false);
    this.name = 'AuthenticationError';
  }
}

export class PermissionDeniedError extends WooCommerceError {
  constructor(message = 'Upstream WooCommerce permission denied for integration user.') {
    super(message, 403, 'FORBIDDEN', false);
    this.name = 'PermissionDeniedError';
  }
}

export class NotFoundError extends WooCommerceError {
  constructor(resource: string, id: string | number) {
    super(`${resource} with ID ${id} not found in store catalog.`, 404, 'NOT_FOUND', false);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends WooCommerceError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT', false);
    this.name = 'ConflictError';
  }
}

export class UpstreamTimeoutError extends WooCommerceError {
  constructor(operation: string, timeoutMs: number) {
    super(
      `Upstream WooCommerce request timed out after ${timeoutMs}ms during ${operation}. Outcome may be unknown; do not blindly retry write operations.`,
      504,
      'GATEWAY_TIMEOUT',
      false
    );
    this.name = 'UpstreamTimeoutError';
  }
}

export class UpstreamPayloadTooLargeError extends WooCommerceError {
  constructor(maxBytes: number) {
    super(`Upstream response exceeded safety limit of ${maxBytes} bytes.`, 502, 'RESPONSE_TOO_LARGE', false);
    this.name = 'UpstreamPayloadTooLargeError';
  }
}

export class UpstreamProtocolError extends WooCommerceError {
  constructor(details: string) {
    super(`Invalid or unexpected response structure received from WooCommerce: ${details}`, 502, 'BAD_GATEWAY', false);
    this.name = 'UpstreamProtocolError';
  }
}

export class UpstreamServerError extends WooCommerceError {
  constructor(status: number) {
    super(`Upstream WooCommerce store returned HTTP ${status}.`, status, 'UPSTREAM_SERVER_ERROR', false);
    this.name = 'UpstreamServerError';
  }
}

/**
 * Maps raw HTTP responses or exceptions into sanitized, typed WooCommerceError instances.
 */
export function mapUpstreamError(
  status: number,
  rawBody: string,
  context: { operation: string; resourceId?: string | number }
): WooCommerceError {
  let parsedMessage = '';
  let parsedCode = '';

  try {
    const json = JSON.parse(rawBody);
    if (json && typeof json === 'object') {
      parsedMessage = typeof json.message === 'string' ? json.message : '';
      parsedCode = typeof json.code === 'string' ? json.code : '';
    }
  } catch {
    // If upstream returns HTML error page (e.g. 502/503), sanitize and discard raw HTML
    parsedMessage = '';
  }

  // Strip HTML tags from any upstream error message
  parsedMessage = parsedMessage.replace(/<[^>]*>?/gm, '').trim();

  switch (status) {
    case 400:
      if (parsedCode === 'product_invalid_sku' || parsedMessage.toLowerCase().includes('sku')) {
        return new ConflictError(parsedMessage || 'Product SKU conflict in store catalog.');
      }
      return new WooCommerceError(parsedMessage || 'Invalid request parameters rejected by WooCommerce.', 400, 'BAD_REQUEST');

    case 401:
      return new AuthenticationError(parsedMessage || 'WooCommerce API authentication failed.');

    case 403:
      return new PermissionDeniedError(parsedMessage || 'Integration key has insufficient permissions.');

    case 404:
      return new NotFoundError(context.operation, context.resourceId ?? 'unknown');

    case 409:
      return new ConflictError(parsedMessage || 'Resource conflict in store database.');

    case 429:
      return new WooCommerceError('WooCommerce REST API rate limit exceeded.', 429, 'RATE_LIMITED', false);

    default:
      if (status >= 500) {
        return new UpstreamServerError(status);
      }
      return new WooCommerceError(parsedMessage || `WooCommerce request failed with HTTP ${status}.`, status, 'UNKNOWN_ERROR');
  }
}
