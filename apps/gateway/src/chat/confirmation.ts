import crypto from 'node:crypto';

/**
 * Payload encoded inside the cryptographic confirmation token.
 */
export interface ConfirmationPayload {
  userId: string;
  toolName: string;
  canonicalArgs: string;
  expiresAt: number;
  nonce: string;
}

export interface VerificationResult {
  valid: boolean;
  code?: string;
  error?: string;
  payload?: ConfirmationPayload;
  parsedArgs?: Record<string, unknown>;
}

/**
 * Normalizes an argument object into deterministic canonical JSON (sorted keys recursively).
 */
export function canonicalizeArgs(args: Record<string, unknown> | undefined): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return JSON.stringify(args ?? {});
  }

  function sortObject(obj: unknown): unknown {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(sortObject);
    }
    const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = sortObject((obj as Record<string, unknown>)[key]);
    }
    return result;
  }

  return JSON.stringify(sortObject(args));
}

/**
 * Protected WooCommerce Baseline Records Safeguard:
 * Product IDs 10, 11, 12 and Order #14 must remain completely immutable.
 */
export function isProtectedTarget(
  toolName: string,
  args?: Record<string, unknown>
): { protected: boolean; reason?: string } {
  if (!args) {
    return { protected: false };
  }

  // 1. Order #14 Protection
  const orderId = args.order_id ?? args.id;
  if (orderId !== undefined && (String(orderId) === '14' || Number(orderId) === 14)) {
    return {
      protected: true,
      reason: 'Protected record safeguard: Order #14 is an immutable baseline record and cannot be modified.',
    };
  }

  // 2. Product IDs 10, 11, 12 Protection
  const productId = args.product_id ?? args.id;
  if (productId !== undefined) {
    const numericId = Number(productId);
    if ([10, 11, 12].includes(numericId) || ['10', '11', '12'].includes(String(productId))) {
      return {
        protected: true,
        reason: `Protected record safeguard: Product ID ${productId} is an immutable baseline record and cannot be modified.`,
      };
    }
  }

  // 3. Product creation name/SKU collision protection against baseline items
  if (toolName === 'woocommerce__create_product') {
    const sku = typeof args.sku === 'string' ? args.sku.toLowerCase() : '';
    const protectedSkus = ['woo-vneck-tee', 'woo-hoodie-logo', 'woo-beanie'];
    if (protectedSkus.includes(sku)) {
      return {
        protected: true,
        reason: `Protected record safeguard: SKU '${args.sku}' collides with an immutable baseline product.`,
      };
    }
  }

  return { protected: false };
}

/**
 * Evaluates whether a proposed mutation qualifies for the approved disposable fixture exemption:
 * - Only applies to woocommerce__create_product
 * - Must specify a name and valid price
 * - Must specify a SKU matching /^chat-demo-[a-z0-9_-]+$/
 * - Must NOT target or collide with protected records
 */
export function isDisposableFixture(
  toolName: string,
  args?: Record<string, unknown>
): boolean {
  if (toolName !== 'woocommerce__create_product' || !args) {
    return false;
  }

  // Validate required fields and semantics
  if (typeof args.name !== 'string' || args.name.trim().length === 0) {
    return false;
  }

  if (typeof args.regular_price !== 'string' || !/^\d+(\.\d{1,2})?$/.test(args.regular_price)) {
    return false;
  }

  if (typeof args.sku !== 'string' || !/^chat-demo-[a-z0-9_-]+$/.test(args.sku)) {
    return false;
  }

  // Ensure no product ID or overwrite parameter is supplied
  if (args.id !== undefined || args.product_id !== undefined) {
    return false;
  }

  // Re-verify protected records
  const targetCheck = isProtectedTarget(toolName, args);
  if (targetCheck.protected) {
    return false;
  }

  return true;
}

/**
 * ConfirmationManager manages cryptographically signed confirmation tokens
 * for state mutations, with single-use nonce tracking and expiry enforcement.
 */
export class ConfirmationManager {
  private readonly secret: Buffer;
  private readonly consumedNonces = new Set<string>();

  constructor(secret?: string) {
    if (secret && secret.trim().length >= 16) {
      this.secret = Buffer.from(secret, 'utf-8');
    } else {
      // Process-stable 32-byte cryptographic secret
      this.secret = crypto.randomBytes(32);
    }
  }

  /**
   * Mints an HMAC-SHA256 signed confirmation token bound to the actor, tool, and canonical arguments.
   */
  public mintToken(params: {
    userId: string;
    toolName: string;
    args?: Record<string, unknown>;
    ttlMs?: number;
  }): { token: string; expiresAt: number; canonicalArgs: string } {
    const canonicalArgs = canonicalizeArgs(params.args);
    const expiresAt = Date.now() + (params.ttlMs ?? 60_000); // 60 seconds default TTL
    const nonce = crypto.randomUUID();

    const payload: ConfirmationPayload = {
      userId: params.userId,
      toolName: params.toolName,
      canonicalArgs,
      expiresAt,
      nonce,
    };

    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
    const signature = this.computeSignature(payload);

    return {
      token: `${encodedPayload}.${signature}`,
      expiresAt,
      canonicalArgs,
    };
  }

  /**
   * Verifies a confirmation token, validates user binding and expiry,
   * checks argument integrity and protected records, and records single-use consumption.
   */
  public verifyAndConsumeToken(
    token: string,
    currentUserId: string,
    expectedArgs?: Record<string, unknown>
  ): VerificationResult {
    if (!token || typeof token !== 'string') {
      return { valid: false, code: 'INVALID_CONFIRMATION_TOKEN', error: 'Missing or malformed confirmation token' };
    }

    const parts = token.split('.');
    if (parts.length !== 2) {
      return { valid: false, code: 'INVALID_CONFIRMATION_TOKEN', error: 'Malformed confirmation token format' };
    }

    const [encodedPayload, providedSignature] = parts;

    let payload: ConfirmationPayload;
    try {
      const decodedJson = Buffer.from(encodedPayload, 'base64url').toString('utf-8');
      payload = JSON.parse(decodedJson);
    } catch {
      return { valid: false, code: 'INVALID_CONFIRMATION_TOKEN', error: 'Invalid token payload encoding' };
    }

    if (
      !payload.userId ||
      !payload.toolName ||
      payload.canonicalArgs === undefined ||
      !payload.expiresAt ||
      !payload.nonce
    ) {
      return { valid: false, code: 'INVALID_CONFIRMATION_TOKEN', error: 'Incomplete confirmation payload structure' };
    }

    // 1. Timing-safe signature check
    const expectedSignature = this.computeSignature(payload);
    const sigBufferA = Buffer.from(providedSignature);
    const sigBufferB = Buffer.from(expectedSignature);

    if (sigBufferA.length !== sigBufferB.length || !crypto.timingSafeEqual(sigBufferA, sigBufferB)) {
      return { valid: false, code: 'INVALID_CONFIRMATION_TOKEN', error: 'Invalid confirmation token signature' };
    }

    // 2. Expiry check
    if (payload.expiresAt < Date.now()) {
      return { valid: false, code: 'CONFIRMATION_EXPIRED', error: 'Confirmation token has expired' };
    }

    // 3. User binding check
    if (payload.userId !== currentUserId) {
      return { valid: false, code: 'CONFIRMATION_USER_MISMATCH', error: 'Confirmation token does not belong to the active user' };
    }

    // 4. Single-use replay protection
    if (this.consumedNonces.has(payload.nonce)) {
      return { valid: false, code: 'CONFIRMATION_ALREADY_USED', error: 'Confirmation token has already been used' };
    }

    // 5. Parse canonical arguments
    let parsedArgs: Record<string, unknown>;
    try {
      parsedArgs = JSON.parse(payload.canonicalArgs);
    } catch {
      return { valid: false, code: 'INVALID_CONFIRMATION_TOKEN', error: 'Malformed arguments in token' };
    }

    // 6. Argument tampering check if caller supplied explicit expected arguments
    if (expectedArgs !== undefined) {
      const expectedCanonical = canonicalizeArgs(expectedArgs);
      if (expectedCanonical !== payload.canonicalArgs) {
        return { valid: false, code: 'ARGUMENT_MISMATCH', error: 'Arguments do not match the pending confirmation request' };
      }
    }

    // 7. Protected records safeguard re-check (Defense in depth)
    const protectedCheck = isProtectedTarget(payload.toolName, parsedArgs);
    if (protectedCheck.protected) {
      return {
        valid: false,
        code: 'MUTATION_TARGET_PROTECTED',
        error: protectedCheck.reason ?? 'Target record is protected from modification',
      };
    }

    // Mark nonce as consumed
    this.consumedNonces.add(payload.nonce);

    return {
      valid: true,
      payload,
      parsedArgs,
    };
  }

  private computeSignature(payload: ConfirmationPayload): string {
    const data = `${payload.userId}:${payload.toolName}:${payload.canonicalArgs}:${payload.expiresAt}:${payload.nonce}`;
    return crypto.createHmac('sha256', this.secret).update(data).digest('base64url');
  }
}
