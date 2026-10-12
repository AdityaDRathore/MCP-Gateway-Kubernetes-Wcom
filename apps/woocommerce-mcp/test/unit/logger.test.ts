import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeString, redactSensitiveData } from '../../src/logging/logger.js';

describe('Logger Redaction & Secret Leakage Prevention Unit Tests', () => {
  test('sanitizeString strips OAuth signatures and credentials from full URLs', () => {
    const signedUrl =
      'http://127.0.0.1:8089/wp-json/wc/v3/products?page=1&per_page=2&oauth_consumer_key=ck_2692a0709306bf566e139d10e21a2fadcec948ff&oauth_nonce=dd0795919f16e8405839f3849622038b&oauth_signature_method=HMAC-SHA256&oauth_timestamp=1791820825&oauth_signature=b7OBKmJKP0buNkByt1vrBgiNZnXa3YU8nZQ7XJMJwKc%3D';

    const sanitized = sanitizeString(signedUrl);

    // Verify secrets and signatures are replaced with [REDACTED]
    assert.ok(!sanitized.includes('ck_2692a0709306bf566e139d10e21a2fadcec948ff'));
    assert.ok(!sanitized.includes('b7OBKmJKP0buNkByt1vrBgiNZnXa3YU8nZQ7XJMJwKc%3D'));
    assert.ok(!sanitized.includes('dd0795919f16e8405839f3849622038b'));
    assert.ok(sanitized.includes('oauth_consumer_key=[REDACTED]'));
    assert.ok(sanitized.includes('oauth_signature=[REDACTED]'));
    assert.ok(sanitized.includes('oauth_nonce=[REDACTED]'));
  });

  test('sanitizeString strips authorization headers and customer emails', () => {
    assert.equal(sanitizeString('Bearer secret_jwt_token_12345'), '[REDACTED_AUTH_HEADER]');
    assert.equal(sanitizeString('Basic dXNlcjpwYXNz'), '[REDACTED_AUTH_HEADER]');

    const emailStr = 'Error processing order for customer john.doe@example.com in system';
    const sanitizedEmail = sanitizeString(emailStr);
    assert.ok(!sanitizedEmail.includes('john.doe@example.com'));
    assert.ok(sanitizedEmail.includes('[REDACTED_EMAIL]'));
  });

  test('redactSensitiveData redacts sensitive keys and nested objects recursively', () => {
    const rawMeta = {
      service: 'test-service',
      oauth_consumer_key: 'ck_live_secret_key',
      consumer_secret: 'cs_live_secret_val',
      nested: {
        authorization: 'Bearer secret_token',
        password: 'db_password_123',
        customer_email: 'buyer@shop.local',
        normal_field: 42,
        signed_request:
          'http://shop.local/wp-json/wc/v3/orders?oauth_signature=ABC12345%3D&oauth_consumer_key=ck_test',
      },
      list: [
        { token: 'secret_item_token' },
        'http://shop.local/api?oauth_signature=XYZ987',
      ],
    };

    const sanitized = redactSensitiveData(rawMeta) as Record<string, any>;

    assert.equal(sanitized.oauth_consumer_key, '[REDACTED]');
    assert.equal(sanitized.consumer_secret, '[REDACTED]');
    assert.equal(sanitized.nested.authorization, '[REDACTED]');
    assert.equal(sanitized.nested.password, '[REDACTED]');
    assert.equal(sanitized.nested.customer_email, '[REDACTED]');
    assert.equal(sanitized.nested.normal_field, 42);
    assert.ok(!sanitized.nested.signed_request.includes('ABC12345%3D'));
    assert.ok(sanitized.nested.signed_request.includes('oauth_signature=[REDACTED]'));
    assert.equal(sanitized.list[0].token, '[REDACTED]');
    assert.ok(!sanitized.list[1].includes('XYZ987'));
    assert.ok(sanitized.list[1].includes('oauth_signature=[REDACTED]'));
  });
});
