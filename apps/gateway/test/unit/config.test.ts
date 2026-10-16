import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, loadConfig, resetConfigCache } from '../../src/config.js';

describe('Gateway Configuration Unit Tests', () => {
  test('parses valid configuration with default values', () => {
    resetConfigCache();
    const config = parseConfig({});

    // Active in G3
    assert.equal(config.PORT, 3000);
    assert.equal(config.HOST, '0.0.0.0');
    assert.equal(config.NODE_ENV, 'production');
    assert.equal(config.LOG_LEVEL, 'info');
    assert.equal(config.DEFAULT_UPSTREAM_TIMEOUT_MS, 10000);
    assert.equal(config.MAX_PAYLOAD_SIZE_BYTES, 65536);
    assert.equal(config.DRAIN_TIMEOUT_MS, 5000);

    // Reserved for G4-G6
    assert.equal(config.DB_PATH, '/data/gateway.db');
    assert.equal(config.MAX_RESULT_SIZE_BYTES, 1048576);
    assert.equal(config.GLOBAL_CONCURRENCY_LIMIT, 20);
    assert.equal(config.PER_UPSTREAM_CONCURRENCY_LIMIT, 4);

    // Immutability
    assert.ok(Object.isFrozen(config));
  });

  test('parses custom environment variable overrides', () => {
    resetConfigCache();
    const customEnv: NodeJS.ProcessEnv = {
      PORT: '8080',
      HOST: '127.0.0.1',
      NODE_ENV: 'development',
      LOG_LEVEL: 'debug',
      DEFAULT_UPSTREAM_TIMEOUT_MS: '15000',
      MAX_PAYLOAD_SIZE_BYTES: '32768',
      DRAIN_TIMEOUT_MS: '8000',
      DB_PATH: '/custom/path/gateway.db',
      MAX_RESULT_SIZE_BYTES: '524288',
      GLOBAL_CONCURRENCY_LIMIT: '50',
      PER_UPSTREAM_CONCURRENCY_LIMIT: '10',
    };

    const config = parseConfig(customEnv);
    assert.equal(config.PORT, 8080);
    assert.equal(config.HOST, '127.0.0.1');
    assert.equal(config.NODE_ENV, 'development');
    assert.equal(config.LOG_LEVEL, 'debug');
    assert.equal(config.DEFAULT_UPSTREAM_TIMEOUT_MS, 15000);
    assert.equal(config.MAX_PAYLOAD_SIZE_BYTES, 32768);
    assert.equal(config.DRAIN_TIMEOUT_MS, 8000);
    assert.equal(config.DB_PATH, '/custom/path/gateway.db');
    assert.equal(config.MAX_RESULT_SIZE_BYTES, 524288);
    assert.equal(config.GLOBAL_CONCURRENCY_LIMIT, 50);
    assert.equal(config.PER_UPSTREAM_CONCURRENCY_LIMIT, 10);
  });

  test('enforces strict timeout bounds per ADR-011 Section 2.7', () => {
    // Timeout below 500ms must be rejected
    assert.throws(
      () => parseConfig({ DEFAULT_UPSTREAM_TIMEOUT_MS: '499' }),
      /DEFAULT_UPSTREAM_TIMEOUT_MS must be at least 500ms/
    );

    // Timeout above 30000ms must be rejected
    assert.throws(
      () => parseConfig({ DEFAULT_UPSTREAM_TIMEOUT_MS: '30001' }),
      /DEFAULT_UPSTREAM_TIMEOUT_MS must not exceed 30000ms/
    );

    // Boundaries 500 and 30000 must be accepted
    const minConfig = parseConfig({ DEFAULT_UPSTREAM_TIMEOUT_MS: '500' });
    assert.equal(minConfig.DEFAULT_UPSTREAM_TIMEOUT_MS, 500);

    const maxConfig = parseConfig({ DEFAULT_UPSTREAM_TIMEOUT_MS: '30000' });
    assert.equal(maxConfig.DEFAULT_UPSTREAM_TIMEOUT_MS, 30000);
  });

  test('enforces port bounds between 1024 and 65535', () => {
    assert.throws(() => parseConfig({ PORT: '1023' }), /PORT must be at least 1024/);
    assert.throws(() => parseConfig({ PORT: '65536' }), /PORT must not exceed 65535/);
    assert.throws(() => parseConfig({ PORT: 'invalid' }), /Expected number/);
  });

  test('enforces valid NODE_ENV enum', () => {
    assert.throws(
      () => parseConfig({ NODE_ENV: 'staging' as any }),
      /Invalid enum value/
    );
  });

  test('loadConfig caches configuration and resets cleanly', () => {
    resetConfigCache();
    const config1 = loadConfig({ PORT: '4000' });
    assert.equal(config1.PORT, 4000);

    // Second call without reset returns cached config
    const config2 = loadConfig({ PORT: '5000' });
    assert.equal(config2.PORT, 4000);

    // Reset allows new load
    resetConfigCache();
    const config3 = loadConfig({ PORT: '5000' });
    assert.equal(config3.PORT, 5000);
    resetConfigCache();
  });
});
