import crypto from 'node:crypto';

/**
 * Strict RFC 3986 percent encoding for OAuth 1.0a (RFC 5849 Section 3.6).
 * Encodes all characters except unreserved characters: ALPHA / DIGIT / "-" / "." / "_" / "~".
 */
export function rfc3986(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Strict byte-value (ASCII code point / octet) comparator per RFC 5849 Section 3.4.1.3.2.
 * Never uses localeCompare, preventing locale-dependent ordering discrepancies across host environments.
 */
export function rfc5849ByteComparator(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export type QueryParamValue = string | number | boolean | (string | number | boolean)[];
export type QueryParamsInput = Record<string, QueryParamValue | undefined> | [string, string | number | boolean][];

export interface OAuthSignOptions {
  method: string;
  transportBaseUrl: string; // Internal cluster URL, e.g. "http://urumi-wordpress.urumi.svc.cluster.local:80/wp-json/wc/v3/products"
  signatureBaseUrl: string; // Configured store URL, e.g. "http://shop.127.0.0.1.nip.io:8080/wp-json/wc/v3/products"
  queryParams?: QueryParamsInput;
  consumerKey: string;
  consumerSecret: string;
  timestamp?: string;
  nonce?: string;
}

export interface OAuthSignResult {
  requestUrl: string;
  signature: string;
  signedParams: Record<string, string>;
  stringToSign: string;
}

/**
 * Normalizes and signs an OAuth 1.0a HMAC-SHA256 request conforming to RFC 5849 and WooCommerce core.
 *
 * CRITICAL ARCHITECTURAL DISTINCTION:
 * -----------------------------------
 * WooCommerce core's check_oauth_signature() computes base URI from get_home_url().
 * Therefore, `signatureBaseUrl` must use the configured store URL (e.g. http://shop.127.0.0.1.nip.io:8080),
 * while the actual HTTP transport request is transmitted over `transportBaseUrl` (the internal ClusterIP).
 */
export function signOAuth1Request(options: OAuthSignOptions): OAuthSignResult {
  const {
    method,
    transportBaseUrl,
    signatureBaseUrl,
    queryParams = {},
    consumerKey,
    consumerSecret,
    timestamp = Math.floor(Date.now() / 1000).toString(),
    nonce = crypto.randomBytes(16).toString('hex'),
  } = options;

  const paramPairs: { encodedKey: string; encodedValue: string }[] = [];

  // 1. Collect and percent-encode query parameters (RFC 5849 Section 3.4.1.3.2 step 1)
  if (Array.isArray(queryParams)) {
    for (const [key, value] of queryParams) {
      if (value !== undefined && value !== null) {
        paramPairs.push({
          encodedKey: rfc3986(key),
          encodedValue: rfc3986(String(value)),
        });
      }
    }
  } else if (queryParams && typeof queryParams === 'object') {
    for (const [key, value] of Object.entries(queryParams)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item !== undefined && item !== null) {
            paramPairs.push({
              encodedKey: rfc3986(key),
              encodedValue: rfc3986(String(item)),
            });
          }
        }
      } else {
        paramPairs.push({
          encodedKey: rfc3986(key),
          encodedValue: rfc3986(String(value)),
        });
      }
    }
  }

  // 2. Add and percent-encode mandatory OAuth 1.0a parameters
  paramPairs.push(
    { encodedKey: rfc3986('oauth_consumer_key'), encodedValue: rfc3986(consumerKey) },
    { encodedKey: rfc3986('oauth_nonce'), encodedValue: rfc3986(nonce) },
    { encodedKey: rfc3986('oauth_signature_method'), encodedValue: rfc3986('HMAC-SHA256') },
    { encodedKey: rfc3986('oauth_timestamp'), encodedValue: rfc3986(timestamp) }
  );

  // 3. Sort pairs strictly by encodedKey, then encodedValue per RFC 5849 Section 3.4.1.3.2 step 2
  paramPairs.sort((a, b) => {
    const keyComp = rfc5849ByteComparator(a.encodedKey, b.encodedKey);
    if (keyComp !== 0) return keyComp;
    return rfc5849ByteComparator(a.encodedValue, b.encodedValue);
  });

  // 4. Concatenate sorted parameters into normalized query string
  const normalizedPairs = paramPairs.map((p) => `${p.encodedKey}=${p.encodedValue}`);
  const normalizedQueryString = normalizedPairs.join('&');

  // 5. Construct signature base string: METHOD & urlencode(BaseURI) & urlencode(NormalizedQueryString)
  const stringToSign = `${method.toUpperCase()}&${rfc3986(signatureBaseUrl)}&${rfc3986(normalizedQueryString)}`;

  // 6. Signing key is urlencode(consumer_secret) + '&' (one-legged OAuth has no token secret)
  const signingKey = `${rfc3986(consumerSecret)}&`;
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('base64');

  // 7. Assemble final query string with oauth_signature
  const finalPairs = [...paramPairs, { encodedKey: rfc3986('oauth_signature'), encodedValue: rfc3986(signature) }];
  const finalQueryString = finalPairs.map((p) => `${p.encodedKey}=${p.encodedValue}`).join('&');

  const delimiter = transportBaseUrl.includes('?') ? '&' : '?';
  const requestUrl = `${transportBaseUrl}${delimiter}${finalQueryString}`;

  // Assemble map of signed parameters for inspection
  const signedParams: Record<string, string> = {};
  for (const p of finalPairs) {
    signedParams[p.encodedKey] = p.encodedValue;
  }

  return {
    requestUrl,
    signature,
    signedParams,
    stringToSign,
  };
}
