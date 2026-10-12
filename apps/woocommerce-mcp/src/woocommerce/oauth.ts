import crypto from 'node:crypto';

/**
 * Strict RFC 3986 percent encoding for OAuth 1.0a (RFC 5849 Section 3.6).
 * Encodes all characters except unreserved characters: ALPHA / DIGIT / "-" / "." / "_" / "~".
 */
export function rfc3986(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export interface OAuthSignOptions {
  method: string;
  transportBaseUrl: string; // Internal cluster URL, e.g. "http://urumi-wordpress.urumi.svc.cluster.local:80/wp-json/wc/v3/products"
  signatureBaseUrl: string; // Configured store URL, e.g. "http://shop.127.0.0.1.nip.io:8080/wp-json/wc/v3/products"
  queryParams?: Record<string, string | number | boolean | undefined>;
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

  // Filter out undefined query parameters and stringify
  const cleanQueryParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(queryParams)) {
    if (value !== undefined && value !== null) {
      cleanQueryParams[key] = String(value);
    }
  }

  // Mandatory OAuth 1.0a parameters
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: timestamp,
  };

  // Combine query parameters and oauth parameters for signing (excluding oauth_signature)
  const allParams = { ...cleanQueryParams, ...oauthParams };

  // Sort keys lexicographically according to RFC 5849 Section 3.4.1.3.2
  const sortedKeys = Object.keys(allParams).sort((a, b) => a.localeCompare(b));

  // Format parameter string: encodedKey=encodedValue joined by '&'
  const normalizedPairs = sortedKeys.map((k) => `${rfc3986(k)}=${rfc3986(allParams[k])}`);
  const normalizedQueryString = normalizedPairs.join('&');

  // Construct signature base string: METHOD & urlencode(BaseURI) & urlencode(NormalizedQueryString)
  const stringToSign = `${method.toUpperCase()}&${rfc3986(signatureBaseUrl)}&${rfc3986(normalizedQueryString)}`;

  // Signing key is urlencode(consumer_secret) + '&' (one-legged OAuth has no token secret)
  const signingKey = `${rfc3986(consumerSecret)}&`;
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('base64');

  // Final query parameters include oauth_signature
  const finalParams: Record<string, string> = {
    ...allParams,
    oauth_signature: signature,
  };

  const finalQueryString = Object.keys(finalParams)
    .map((k) => `${rfc3986(k)}=${rfc3986(finalParams[k])}`)
    .join('&');

  const delimiter = transportBaseUrl.includes('?') ? '&' : '?';
  const requestUrl = `${transportBaseUrl}${delimiter}${finalQueryString}`;

  return {
    requestUrl,
    signature,
    signedParams: finalParams,
    stringToSign,
  };
}
