import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rfc3986, rfc5849ByteComparator, signOAuth1Request } from '../../src/woocommerce/oauth.js';

describe('OAuth 1.0a HMAC-SHA256 Signer Unit Tests', () => {
  test('rfc3986 correctly encodes special, reserved, and unreserved characters', () => {
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
    assert.equal(rfc3986('+'), '%2B');
    assert.equal(rfc3986(','), '%2C');
    assert.equal(rfc3986('/'), '%2F');
    assert.equal(rfc3986('?'), '%3F');
    assert.equal(rfc3986('#'), '%23');
  });

  test('rfc3986 correctly percent-encodes non-ASCII multi-byte UTF-8 sequences', () => {
    // Non-ASCII accented characters
    assert.equal(rfc3986('Café'), 'Caf%C3%A9');
    // Currency symbol: Indian Rupee ₹ (U+20B9, UTF-8 E2 82 B9)
    assert.equal(rfc3986('₹299.00'), '%E2%82%B9299.00');
    // Multilingual text: Hindi
    assert.equal(rfc3986('उरुमी'), '%E0%A4%89%E0%A4%B0%E0%A5%81%E0%A4%AE%E0%A5%80');
    // Emoji
    assert.equal(rfc3986('☕'), '%E2%98%95');
  });

  test('rfc5849ByteComparator performs strict byte-value comparison independent of locale', () => {
    // In ASCII/byte order: uppercase precedes lowercase
    assert.equal(rfc5849ByteComparator('A', 'B'), -1);
    assert.equal(rfc5849ByteComparator('B', 'A'), 1);
    assert.equal(rfc5849ByteComparator('A', 'A'), 0);
    assert.equal(rfc5849ByteComparator('Z', 'a'), -1); // 90 < 97
    assert.equal(rfc5849ByteComparator('a', 'Z'), 1);

    // Percent encoded comparison (% = 0x25 = 37, precedes numbers and letters)
    assert.equal(rfc5849ByteComparator('%20', '0'), -1); // 0x25 < 0x30
    assert.equal(rfc5849ByteComparator('%20', 'a'), -1); // 0x25 < 0x61
  });

  test('signOAuth1Request sorts query and OAuth parameters lexicographically by byte value', () => {
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

    // Check that parameters in the string to sign are lexicographically sorted by byte value:
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

    assert.match(res.signature, /^[A-Za-z0-9+/=]+$/);
    assert.ok(res.requestUrl.startsWith('http://urumi-wordpress.urumi.svc.cluster.local:80/wp-json/wc/v3/products?'));
    assert.ok(res.requestUrl.includes('oauth_signature='));
  });

  test('signOAuth1Request correctly handles and sorts duplicate parameters by value per RFC 5849', () => {
    // Array of duplicate parameters sharing the exact same key name
    const res = signOAuth1Request({
      method: 'GET',
      transportBaseUrl: 'http://urumi-wordpress.urumi.svc.cluster.local:80/wp-json/wc/v3/products',
      signatureBaseUrl: 'http://shop.127.0.0.1.nip.io:8080/wp-json/wc/v3/products',
      queryParams: [
        ['category', 'electronics'],
        ['category', 'apparel'],
        ['category', 'books'],
      ],
      consumerKey: 'ck_key_dup',
      consumerSecret: 'cs_secret_dup',
      timestamp: '1791820000',
      nonce: 'fixed_nonce_dup',
    });

    // RFC 5849 Section 3.4.1.3.2: "If two or more parameters share a name, they are sorted by value, using ascending byte value ordering."
    // 'category=apparel' < 'category=books' < 'category=electronics'
    const apparelIdx = res.stringToSign.indexOf('category%3Dapparel');
    const booksIdx = res.stringToSign.indexOf('category%3Dbooks');
    const electronicsIdx = res.stringToSign.indexOf('category%3Delectronics');

    assert.ok(apparelIdx !== -1 && booksIdx !== -1 && electronicsIdx !== -1);
    assert.ok(apparelIdx < booksIdx, 'apparel must precede books');
    assert.ok(booksIdx < electronicsIdx, 'books must precede electronics');
  });

  test('signOAuth1Request correctly encodes and signs parameters with spaces, reserved characters, and non-ASCII', () => {
    const res = signOAuth1Request({
      method: 'GET',
      transportBaseUrl: 'http://urumi-wordpress.urumi.svc.cluster.local:80/wp-json/wc/v3/products',
      signatureBaseUrl: 'http://shop.127.0.0.1.nip.io:8080/wp-json/wc/v3/products',
      queryParams: {
        search: 'premium ceramic coffee mug!',
        price_filter: '₹299.00',
        tag: 'special*deal & promo',
      },
      consumerKey: 'ck_test_key',
      consumerSecret: 'cs_test_secret',
      timestamp: '1791820000',
      nonce: 'fixed_nonce_123',
    });

    // Spaces should be %20, ! should be %21, ₹ should be %E2%82%B9, * should be %2A, & should be %26
    // In signature base string, these percent-encoded sequences are percent-encoded again per RFC 5849!
    assert.ok(res.stringToSign.includes('%2520')); // Double-encoded space (%20 -> %2520)
    assert.ok(res.stringToSign.includes('%2521')); // Double-encoded ! (%21 -> %2521)
    assert.ok(res.stringToSign.includes('%252A')); // Double-encoded * (%2A -> %252A)
    assert.ok(res.stringToSign.includes('%2526')); // Double-encoded & (%26 -> %2526)
    assert.ok(res.stringToSign.includes('%25E2%2582%25B9')); // Double-encoded rupee symbol

    // Verification of signature validity
    assert.match(res.signature, /^[A-Za-z0-9+/=]+$/);
  });

  test('deterministic signature produces reproducible outputs with identical inputs', () => {
    const opts = {
      method: 'POST',
      transportBaseUrl: 'http://urumi-wordpress.urumi.svc.cluster.local:80/wp-json/wc/v3/products',
      signatureBaseUrl: 'http://shop.127.0.0.1.nip.io:8080/wp-json/wc/v3/products',
      queryParams: [
        ['name', 'Café Special Mug'],
        ['tag', 'hot & cold'],
        ['price', '₹199.50'],
      ] as [string, string][],
      consumerKey: 'ck_deterministic_key',
      consumerSecret: 'cs_deterministic_secret',
      timestamp: '1791820500',
      nonce: 'fixed_nonce_12345',
    };

    const res1 = signOAuth1Request(opts);
    const res2 = signOAuth1Request(opts);

    assert.equal(res1.signature, res2.signature);
    assert.equal(res1.stringToSign, res2.stringToSign);
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
