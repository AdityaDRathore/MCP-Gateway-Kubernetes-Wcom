import crypto from 'node:crypto';

function scryptAsync(
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) {
        reject(err);
      } else {
        resolve(derivedKey as Buffer);
      }
    });
  });
}

export interface ScryptOptions {
  N?: number;
  r?: number;
  p?: number;
  keyLength?: number;
  saltLength?: number;
  maxmem?: number;
  maxConcurrent?: number;
}

export class ScryptPasswordService {
  private readonly N: number;
  private readonly r: number;
  private readonly p: number;
  private readonly keyLength: number;
  private readonly saltLength: number;
  private readonly maxmem: number;
  private readonly maxConcurrent: number;

  private activeOperations = 0;
  private readonly queue: Array<() => void> = [];

  constructor(options: ScryptOptions = {}) {
    this.N = options.N ?? 16384;
    this.r = options.r ?? 8;
    this.p = options.p ?? 1;
    this.keyLength = options.keyLength ?? 32;
    this.saltLength = options.saltLength ?? 16;
    this.maxmem = options.maxmem ?? 32 * 1024 * 1024; // 32 MiB
    this.maxConcurrent = options.maxConcurrent ?? 5;
  }

  /**
   * Acquire a concurrency permit, queueing if maximum active operations are in flight.
   */
  private async acquirePermit(): Promise<void> {
    if (this.activeOperations < this.maxConcurrent) {
      this.activeOperations++;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.activeOperations++;
        resolve();
      });
    });
  }

  /**
   * Release a concurrency permit, resolving the next waiting operation if queued.
   */
  private releasePermit(): void {
    this.activeOperations--;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }

  /**
   * Returns current concurrency metrics.
   */
  public getMetrics(): { active: number; queued: number; maxConcurrent: number } {
    return {
      active: this.activeOperations,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
    };
  }

  /**
   * Hashes a plaintext password using Scrypt KDF.
   * Returns string in format: $scrypt$N=16384,r=8,p=1$<salt_hex>$<hash_hex>
   */
  public async hashPassword(password: string): Promise<string> {
    if (typeof password !== 'string' || password.length === 0) {
      throw new Error('Password must be a non-empty string');
    }

    await this.acquirePermit();
    try {
      const salt = crypto.randomBytes(this.saltLength);
      const derivedKey = (await scryptAsync(password, salt, this.keyLength, {
        N: this.N,
        r: this.r,
        p: this.p,
        maxmem: this.maxmem,
      })) as Buffer;

      return `$scrypt$N=${this.N},r=${this.r},p=${this.p}$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
    } finally {
      this.releasePermit();
    }
  }

  /**
   * Verifies a candidate password against a stored Scrypt hash string in constant time.
   */
  public async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    if (typeof password !== 'string' || typeof storedHash !== 'string') {
      return false;
    }

    // Expected format: $scrypt$N=<N>,r=<r>,p=<p>$<salt_hex>$<hash_hex>
    const parts = storedHash.split('$');
    if (parts.length !== 5 || parts[1] !== 'scrypt') {
      return false;
    }

    const paramMatches = parts[2].match(/^N=(\d+),r=(\d+),p=(\d+)$/);
    if (!paramMatches) {
      return false;
    }

    const nVal = parseInt(paramMatches[1], 10);
    const rVal = parseInt(paramMatches[2], 10);
    const pVal = parseInt(paramMatches[3], 10);
    const saltHex = parts[3];
    const hashHex = parts[4];

    if (!saltHex || !hashHex) {
      return false;
    }

    let salt: Buffer;
    let expectedHash: Buffer;
    try {
      salt = Buffer.from(saltHex, 'hex');
      expectedHash = Buffer.from(hashHex, 'hex');
    } catch {
      return false;
    }

    // Enforce exact expected lengths (16 bytes salt, 32 bytes hash) to prevent truncation attacks
    if (salt.length !== this.saltLength || expectedHash.length !== this.keyLength) {
      return false;
    }

    await this.acquirePermit();
    try {
      const derivedKey = (await scryptAsync(password, salt, this.keyLength, {
        N: nVal,
        r: rVal,
        p: pVal,
        maxmem: this.maxmem,
      })) as Buffer;

      if (derivedKey.length !== expectedHash.length) {
        return false;
      }

      return crypto.timingSafeEqual(derivedKey, expectedHash);
    } catch {
      return false;
    } finally {
      this.releasePermit();
    }
  }
}
