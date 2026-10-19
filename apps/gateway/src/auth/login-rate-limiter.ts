export interface RateLimitStatus {
  limited: boolean;
  retryAfterSeconds: number;
}

interface AttemptRecord {
  timestamps: number[];
}

export class LoginRateLimiter {
  private attempts = new Map<string, AttemptRecord>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;

  constructor(options: { maxAttempts?: number; windowMs?: number } = {}) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.windowMs = options.windowMs ?? 5 * 60 * 1000; // 5 minutes default
  }

  private cleanOldTimestamps(record: AttemptRecord, now: number): void {
    const cutoff = now - this.windowMs;
    record.timestamps = record.timestamps.filter((ts) => ts > cutoff);
  }

  private checkKey(key: string, now: number): RateLimitStatus {
    const record = this.attempts.get(key);
    if (!record) {
      return { limited: false, retryAfterSeconds: 0 };
    }

    this.cleanOldTimestamps(record, now);
    if (record.timestamps.length >= this.maxAttempts) {
      const oldestValid = record.timestamps[0];
      const expiry = oldestValid + this.windowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil((expiry - now) / 1000));
      return { limited: true, retryAfterSeconds };
    }

    return { limited: false, retryAfterSeconds: 0 };
  }

  public checkLimit(clientIp: string, username: string): RateLimitStatus {
    const now = Date.now();
    const normalizedIp = clientIp.trim();
    const normalizedUser = username.trim().toLowerCase();

    // Check IP limit
    const ipStatus = this.checkKey(`ip:${normalizedIp}`, now);
    if (ipStatus.limited) {
      return ipStatus;
    }

    // Check username limit
    if (normalizedUser) {
      const userStatus = this.checkKey(`user:${normalizedUser}`, now);
      if (userStatus.limited) {
        return userStatus;
      }
    }

    return { limited: false, retryAfterSeconds: 0 };
  }

  public recordFailure(clientIp: string, username: string): void {
    const now = Date.now();
    const normalizedIp = clientIp.trim();
    const normalizedUser = username.trim().toLowerCase();

    const recordKey = (key: string) => {
      let record = this.attempts.get(key);
      if (!record) {
        record = { timestamps: [] };
        this.attempts.set(key, record);
      }
      this.cleanOldTimestamps(record, now);
      record.timestamps.push(now);
    };

    recordKey(`ip:${normalizedIp}`);
    if (normalizedUser) {
      recordKey(`user:${normalizedUser}`);
    }
  }

  public recordSuccess(clientIp: string, username: string): void {
    const normalizedIp = clientIp.trim();
    const normalizedUser = username.trim().toLowerCase();

    this.attempts.delete(`ip:${normalizedIp}`);
    if (normalizedUser) {
      this.attempts.delete(`user:${normalizedUser}`);
    }
  }

  public reset(): void {
    this.attempts.clear();
  }
}
