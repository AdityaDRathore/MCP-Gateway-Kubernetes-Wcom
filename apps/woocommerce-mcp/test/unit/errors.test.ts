import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapUpstreamError,
  AuthenticationError,
  PermissionDeniedError,
  NotFoundError,
  ConflictError,
  UpstreamTimeoutError,
  UpstreamPayloadTooLargeError,
  UpstreamServerError,
} from '../../src/woocommerce/errors.js';

describe('Error Mapping & Sanitization Unit Tests', () => {
  test('maps 401 response to AuthenticationError and scrubs raw text', () => {
    const err = mapUpstreamError(401, '{"code":"woocommerce_rest_cannot_view","message":"Sorry, you cannot view."}', {
      operation: 'list_products',
    });
    assert.ok(err instanceof AuthenticationError);
    assert.equal(err.statusCode, 401);
    assert.equal(err.errorCode, 'UNAUTHORIZED');
    assert.equal(err.message, 'Sorry, you cannot view.');
  });

  test('maps 403 response to PermissionDeniedError', () => {
    const err = mapUpstreamError(403, '{"message":"User cannot edit orders."}', {
      operation: 'update_order_status',
    });
    assert.ok(err instanceof PermissionDeniedError);
    assert.equal(err.statusCode, 403);
    assert.equal(err.errorCode, 'FORBIDDEN');
  });

  test('maps 404 response to NotFoundError with resource context', () => {
    const err = mapUpstreamError(404, '{"message":"Not found."}', {
      operation: 'get_order',
      resourceId: 9999,
    });
    assert.ok(err instanceof NotFoundError);
    assert.equal(err.statusCode, 404);
    assert.ok(err.message.includes('get_order with ID 9999 not found'));
  });

  test('maps 400 SKU collision to ConflictError', () => {
    const err = mapUpstreamError(400, '{"code":"product_invalid_sku","message":"Invalid or duplicated SKU."}', {
      operation: 'create_product',
    });
    assert.ok(err instanceof ConflictError);
    assert.equal(err.statusCode, 409);
    assert.equal(err.errorCode, 'CONFLICT');
  });

  test('strips arbitrary HTML from error messages', () => {
    const rawHtml = '<html><body><h1>502 Bad Gateway</h1><p>The proxy failed.</p></body></html>';
    const err = mapUpstreamError(502, rawHtml, { operation: 'list_orders' });
    assert.ok(err instanceof UpstreamServerError);
    assert.ok(!err.message.includes('<'));
    assert.ok(!err.message.includes('>'));
  });

  test('timeout error conveys unambiguous non-retryable message', () => {
    const err = new UpstreamTimeoutError('create_product', 10000);
    assert.equal(err.statusCode, 504);
    assert.ok(err.message.includes('do not blindly retry'));
    assert.equal(err.isRetryable, false);
  });

  test('payload too large error enforces byte bounds', () => {
    const err = new UpstreamPayloadTooLargeError(1048576);
    assert.equal(err.statusCode, 502);
    assert.equal(err.errorCode, 'RESPONSE_TOO_LARGE');
  });
});
