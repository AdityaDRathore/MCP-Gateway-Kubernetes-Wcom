import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeString, redactSensitiveData, Logger } from '../../src/logging/logger.js';

describe('Gateway Structured Redacted Logger Unit Tests', () => {
  test('sanitizeString scrubs Bearer and Basic auth headers', () => {
    const raw = 'Request header: Bearer urumi_secret_token_123456';
    const sanitized = sanitizeString(raw);
    assert.equal(sanitized, 'Request header: [REDACTED_AUTH_HEADER]');

    const basicRaw = 'Authorization: Basic dXNlcjpwYXNz';
    assert.equal(sanitizeString(basicRaw), 'Authorization: [REDACTED_AUTH_HEADER]');
  });

  test('sanitizeString scrubs Urumi API keys', () => {
    const rawKey = 'Created key: urumi_live_7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a';
    const sanitized = sanitizeString(rawKey);
    assert.equal(sanitized, 'Created key: [REDACTED_API_KEY]');
  });

  test('sanitizeString scrubs real emails (including long TLDs) while preserving synthetic .mock and RFC test domains', () => {
    // Real standard emails
    assert.equal(
      sanitizeString('Contact user john.doe@acme-corp.com for support'),
      'Contact user [REDACTED_EMAIL] for support'
    );

    // Real emails with long modern TLDs (adversarial cases)
    assert.equal(
      sanitizeString('Alert sent to admin@corporation.international regarding cluster'),
      'Alert sent to [REDACTED_EMAIL] regarding cluster'
    );
    assert.equal(
      sanitizeString('Photographer user jane@studio.photography uploaded photo'),
      'Photographer user [REDACTED_EMAIL] uploaded photo'
    );
    assert.equal(
      sanitizeString('Contact DevOps at devops@cloud.technology immediately'),
      'Contact DevOps at [REDACTED_EMAIL] immediately'
    );

    // Uppercase real emails
    assert.equal(
      sanitizeString('USER JOHN.DOE@ACME-CORP.COM LOGGED IN'),
      'USER [REDACTED_EMAIL] LOGGED IN'
    );

    // Synthetic .mock domains (single-level and nested subdomains)
    const mockEmail1 = 'Contact synthetic user test.user@example.mock for fixtures';
    assert.equal(sanitizeString(mockEmail1), mockEmail1);

    const mockEmail2 = 'Task assigned to agent@crm.example.mock for verification';
    assert.equal(sanitizeString(mockEmail2), mockEmail2);

    const mockEmail3 = 'System notification from bot@urumi.mock';
    assert.equal(sanitizeString(mockEmail3), mockEmail3);

    // RFC-reserved test domains (.example, .test, .invalid)
    const rfcExample = 'Notice to user@domain.example';
    assert.equal(sanitizeString(rfcExample), rfcExample);

    const rfcTest = 'Notice to tester@unit.test';
    assert.equal(sanitizeString(rfcTest), rfcTest);
  });

  test('redactSensitiveData recursively redacts nested objects and sensitive keys', () => {
    const input = {
      level1: {
        publicData: 'hello',
        password: 'super_secret_password',
        nested: {
          apiKey: 'urumi_live_1234567890abcdef1234567890abcdef',
          token: 'jwt.token.value',
          normalField: 42,
        },
      },
    };

    const result = redactSensitiveData(input) as any;
    assert.equal(result.level1.publicData, 'hello');
    assert.equal(result.level1.password, '[REDACTED]');
    assert.equal(result.level1.nested.apiKey, '[REDACTED]');
    assert.equal(result.level1.nested.token, '[REDACTED]');
    assert.equal(result.level1.nested.normalField, 42);
  });

  test('redactSensitiveData redacts items within arrays', () => {
    const input = [
      { secret: 'top_secret' },
      { public: 'visible' },
      ['Bearer some_token_in_nested_array'],
    ];

    const result = redactSensitiveData(input) as any;
    assert.equal(result[0].secret, '[REDACTED]');
    assert.equal(result[1].public, 'visible');
    assert.equal(result[2][0], '[REDACTED_AUTH_HEADER]');
  });

  test('redactSensitiveData sanitizes Error objects and redacts stacks', () => {
    const err = new Error('Database connection failed for user secret_pass_123');
    const result = redactSensitiveData(err) as any;
    assert.equal(result.name, 'Error');
    assert.equal(result.stack, '[REDACTED_STACK]');
  });

  test('Logger outputs valid JSON with required metadata', () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);

    try {
      const customLogger = new Logger('urumi-gateway-test', 'debug');
      customLogger.info('Gateway test message', { key: 'val' });

      assert.equal(logs.length, 1);
      const parsed = JSON.parse(logs[0]);
      assert.equal(parsed.service, 'urumi-gateway-test');
      assert.equal(parsed.level, 'info');
      assert.equal(parsed.message, 'Gateway test message');
      assert.equal(parsed.key, 'val');
      assert.ok(parsed.timestamp);
    } finally {
      console.log = originalLog;
    }
  });
});
