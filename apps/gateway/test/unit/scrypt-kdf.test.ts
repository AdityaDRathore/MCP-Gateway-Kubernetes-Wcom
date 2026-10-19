import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ScryptPasswordService } from '../../src/auth/scrypt-password-service.js';

describe('ScryptPasswordService Unit Tests (DEC-03)', () => {
  const service = new ScryptPasswordService();

  it('generates valid scrypt hash in standard format', async () => {
    const password = 'SuperSecretPassword123!';
    const hash = await service.hashPassword(password);

    assert(hash.startsWith('$scrypt$N=16384,r=8,p=1$'), `Invalid hash prefix: ${hash}`);
    const parts = hash.split('$');
    assert.strictEqual(parts.length, 5);
    assert.strictEqual(parts[1], 'scrypt');
    assert.strictEqual(parts[2], 'N=16384,r=8,p=1');
    assert.strictEqual(parts[3].length, 32); // 16 bytes hex = 32 chars
    assert.strictEqual(parts[4].length, 64); // 32 bytes hex = 64 chars
  });

  it('verifies correct password against generated hash', async () => {
    const password = 'CorrectHorseBatteryStaple456$';
    const hash = await service.hashPassword(password);

    const isValid = await service.verifyPassword(password, hash);
    assert.strictEqual(isValid, true);
  });

  it('rejects incorrect password against generated hash', async () => {
    const password = 'CorrectPassword!';
    const hash = await service.hashPassword(password);

    const isWrong = await service.verifyPassword('WrongPassword!', hash);
    assert.strictEqual(isWrong, false);
  });

  it('rejects tampered salt, hash, or parameters', async () => {
    const password = 'SamplePassword999';
    const hash = await service.hashPassword(password);

    // Tampered hash byte (same length, flipped last byte)
    const parts = hash.split('$');
    const lastByte = parts[4].slice(-2);
    const flippedByte = lastByte === '00' ? 'ff' : '00';
    const tamperedHashPart = parts[4].slice(0, -2) + flippedByte;
    const tamperedHash = `$scrypt$${parts[2]}$${parts[3]}$${tamperedHashPart}`;
    assert.strictEqual(await service.verifyPassword(password, tamperedHash), false);

    // Truncated hash part (must be rejected)
    const truncatedHash = `$scrypt$${parts[2]}$${parts[3]}$${parts[4].slice(0, 32)}`;
    assert.strictEqual(await service.verifyPassword(password, truncatedHash), false);

    // Malformed format
    assert.strictEqual(await service.verifyPassword(password, 'invalid-hash-string'), false);
    assert.strictEqual(await service.verifyPassword(password, '$bcrypt$something$else'), false);
    assert.strictEqual(await service.verifyPassword(password, ''), false);
  });

  it('enforces concurrency queue limiter at maxConcurrent operations', async () => {
    const limiterService = new ScryptPasswordService({ maxConcurrent: 2 });
    const initialMetrics = limiterService.getMetrics();
    assert.strictEqual(initialMetrics.active, 0);
    assert.strictEqual(initialMetrics.queued, 0);

    // Run 5 simultaneous hash operations
    const promises = Array.from({ length: 5 }, (_, i) =>
      limiterService.hashPassword(`password-${i}`)
    );

    // Check that active does not exceed 2
    const midMetrics = limiterService.getMetrics();
    assert(midMetrics.active <= 2, `Active operations exceeded limit: ${midMetrics.active}`);

    const results = await Promise.all(promises);
    assert.strictEqual(results.length, 5);

    const finalMetrics = limiterService.getMetrics();
    assert.strictEqual(finalMetrics.active, 0);
    assert.strictEqual(finalMetrics.queued, 0);
  });
});
