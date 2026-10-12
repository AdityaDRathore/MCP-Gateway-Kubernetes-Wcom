import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rfc3986, signOAuth1Request } from '../../src/woocommerce/oauth.js';

describe('OAuth 1.0a HMAC-SHA256 Signer Unit Tests', () => {
  test('rfc3986 correctly encodes special and unreserved characters', () => {
    // Unreserved characters should NOT be encoded
    const unreserved = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.~';
    assert.equal(rfc3986(unreserved), unreserved);

    // Reserved and sub-delim characters should be encoded with uppercase hex
    assert.equal(rfc3986(' '), '%20');
    assert.equal(rfc3986('!'), '%21');
    assert.equal(rfc3986("'"), '%27');
    assert.equal(rfc3986('('), '%28');
    assert.equal(rfc3986(')'), '%29');
    assert.equal(rfc3986('*'), '%2A');
    assert.equal(rfc3986('&'), '%26');
    assert.equal(rfc3986('='), '%3D');
  });

  test('signOAuth1Request sorts query and OAuth parameters lexicographically', () => {
    const res = signOAuth1Request({
      method: 'GET',
      transportBaseUrl: 'http://urumi-wordpress.urumi.svc.cluster.local:80/wp-json/wc/v3/products',
      signatureBaseUrl: 'http://shop.127.0.0.1.nip.io:8080/wp-json/wc/v3/products',
      queryParams: {
        status: 'publish',
        page: 1,
        per_page: 10,
        sku: 'URUMI-MUG-001',
      },
      consumerKey: 'ck_test_key_12345',
      consumerSecret: 'cs_test_secret_67890',
      timestamp: '1791820000',
      nonce: 'fixed_test_nonce_abcdef',
    });

    // Check stringToSign structure
    assert.ok(res.stringToSign.startsWith('GET&http%3A%2F%2Fshop.127.0.0.1.nip.io%3A8080%2Fwp-json%2Fwc%2Fv3%2Fproducts&'));

    // Check that parameters in the string to sign are lexicographically sorted:
    // oauth_consumer_key < oauth_nonce < oauth_signature_method < oauth_timestamp < page < per_page < sku < status
    const expectedParamOrder = [
      'oauth_consumer_key',
      'oauth_nonce',
      'oauth_signature_method',
      'oauth_timestamp',
      'page',
      'per_page',
      'sku',
      'status',
    ];

    for (let i = 0; i < expectedParamOrder.length - 1; i++) {
      const idx1 = res.stringToSign.indexOf(expectedParamOrder[i]);
      const idx2 = res.stringToSign.indexOf(expectedParamOrder[i + 1]);
      assert.ok(idx1 < idx2, `Expected ${expectedParamOrder[i]} to precede ${expectedParamOrder[i + 1]}`);
    }

    // Verify signature is non-empty base64 string
    assert.match(res.signature, /^[A-Za-z0-9+/=]+$/);

    // Verify transport URL points to internal service, NOT public site URL
    assert.ok(res.requestUrl.startsWith('http://urumi-wordpress.urumi.svc.cluster.local:80/wp-json/wc/v3/products?'));
    assert.ok(res.requestUrl.includes('oauth_signature='));
  });

  test('deterministic signature produces reproducible outputs with identical inputs', () => {
    const opts = {
      method: 'POST',
      transportBaseUrl: 'http://urumi-wordpress.urumi.svc.cluster.local:80/wp-json/wc/v3/products',
      signatureBaseUrl: 'http://shop.127.0.0.1.nip.io:8080/wp-json/wc/v3/products',
      consumerKey: 'ck_deterministic_key',
      consumerSecret: 'cs_deterministic_secret',
      timestamp: '1791820500',
      nonce: 'fixed_nonce_12345',
    };

    const res1 = signOAuth1Request(opts);
    const res2 = signOAuth1Request(opts);

    assert.equal(res1.signature, res2.signature);
    assert.equal(res1.requestUrl, res2.requestUrl);
  });

  test('differing secrets produce distinctly different signatures', () => {
    const baseOpts = {
      method: 'GET',
      transportBaseUrl: 'http://urumi-wordpress.urumi.svc.cluster.local:80/wp-json/wc/v3/orders',
      signatureBaseUrl: 'http://shop.127.0.0.1.nip.io:8080/wp-json/wc/v3/orders',
      consumerKey: 'ck_key_1',
      timestamp: '1791820500',
      nonce: 'fixed_nonce_1',
    };

    const res1 = signOAuth1Request({ ...baseOpts, consumerSecret: 'secret_A' });
    const res2 = signOAuth1Request({ ...baseOpts, consumerSecret: 'secret_B' });

    assert.notEqual(res1.signature, res2.signature);
  });
});
