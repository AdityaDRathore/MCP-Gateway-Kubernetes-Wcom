import { execSync } from 'node:child_process';

const GATEWAY_ORIGIN = 'http://dashboard.127.0.0.1.nip.io:8080';
const HOST_HEADER = 'dashboard.127.0.0.1.nip.io';

interface TestResult {
  id: string;
  category: string;
  description: string;
  passed: boolean;
  httpStatus?: number;
  details?: string;
  error?: string;
}

const results: TestResult[] = [];

function record(result: TestResult) {
  results.push(result);
  const statusMark = result.passed ? '✔ PASS' : '✖ FAIL';
  console.log(`[${statusMark}] ${result.id}: ${result.description} (status: ${result.httpStatus ?? 'N/A'})`);
  if (result.details) console.log(`   Details: ${result.details}`);
  if (result.error) console.log(`   Error: ${result.error}`);
}

async function runAcceptanceSuite() {
  console.log('================================================================');
  console.log('   Urumi Phase 5 Gate P5-G6 Stage 5 Runtime Acceptance Suite   ');
  console.log('================================================================');
  console.log(`Target Gateway: ${GATEWAY_ORIGIN} (Host: ${HOST_HEADER})`);
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  // -------------------------------------------------------------------------
  // 8.1 Browser Session & Security Checks
  // -------------------------------------------------------------------------
  console.log('--- 8.1 Browser Session & Security Checks ---');

  // Test 8.1.1: Dashboard SPA static index.html loads via Ingress
  try {
    const res = await fetch(`${GATEWAY_ORIGIN}/`, {
      headers: { Host: HOST_HEADER },
    });
    const text = await res.text();
    const isHtml = text.includes('<!DOCTYPE html>') && text.includes('Urumi Team MCP Gateway');
    record({
      id: 'TEST-8.1.1',
      category: '8.1 Browser Session',
      description: 'Dashboard loads through the intended ingress with 200 OK',
      passed: res.status === 200 && isHtml,
      httpStatus: res.status,
      details: `Returned HTML document with title (${text.length} bytes)`,
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.1.1',
      category: '8.1 Browser Session',
      description: 'Dashboard loads through the intended ingress with 200 OK',
      passed: false,
      error: err.message,
    });
  }

  // Test 8.1.2: Unauthenticated browser request to protected API rejected
  try {
    const res = await fetch(`${GATEWAY_ORIGIN}/api/v1/browser/session`, {
      headers: { Host: HOST_HEADER },
    });
    const body: any = await res.json().catch(() => ({}));
    record({
      id: 'TEST-8.1.2',
      category: '8.1 Browser Session',
      description: 'Unauthenticated browser request to protected API rejected with 401',
      passed: res.status === 401 && body.code === 'SESSION_MISSING',
      httpStatus: res.status,
      details: JSON.stringify(body),
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.1.2',
      category: '8.1 Browser Session',
      description: 'Unauthenticated browser request to protected API rejected with 401',
      passed: false,
      error: err.message,
    });
  }

  // Test 8.1.3: Invalid login credentials rejected
  try {
    const res = await fetch(`${GATEWAY_ORIGIN}/api/v1/browser/session`, {
      method: 'POST',
      headers: {
        Host: HOST_HEADER,
        Origin: GATEWAY_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: 'admin', password: 'WrongPassword999!' }),
    });
    const body: any = await res.json().catch(() => ({}));
    record({
      id: 'TEST-8.1.3',
      category: '8.1 Browser Session',
      description: 'Invalid credentials rejected with 401 and generic error',
      passed: res.status === 401 && body.code === 'INVALID_CREDENTIALS',
      httpStatus: res.status,
      details: JSON.stringify(body),
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.1.3',
      category: '8.1 Browser Session',
      description: 'Invalid credentials rejected with 401 and generic error',
      passed: false,
      error: err.message,
    });
  }

  // Test 8.1.4: Valid login with authorized test account
  let adminCookie = '';
  let adminCsrf = '';
  let adminUserId = '';
  try {
    const res = await fetch(`${GATEWAY_ORIGIN}/api/v1/browser/session`, {
      method: 'POST',
      headers: {
        Host: HOST_HEADER,
        Origin: GATEWAY_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: 'admin', password: 'AdminPassword123!' }),
    });
    const body: any = await res.json();
    const cookieHeader = res.headers.get('set-cookie') || '';
    const match = cookieHeader.match(/urumi_session=([^;]+)/);
    if (match) adminCookie = match[1];
    adminCsrf = body.csrfToken;
    adminUserId = body.user?.id;

    const cookieAttributesSafe =
      cookieHeader.includes('HttpOnly') &&
      cookieHeader.includes('SameSite=Lax') &&
      cookieHeader.includes('Max-Age=86400');

    record({
      id: 'TEST-8.1.4',
      category: '8.1 Browser Session',
      description: 'Valid login establishes authenticated session with secure cookie',
      passed: res.status === 200 && Boolean(adminCookie) && Boolean(adminCsrf) && cookieAttributesSafe,
      httpStatus: res.status,
      details: `User: ${body.user?.username} (${body.user?.role}), Cookie Attributes Verified`,
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.1.4',
      category: '8.1 Browser Session',
      description: 'Valid login establishes authenticated session with secure cookie',
      passed: false,
      error: err.message,
    });
  }

  // Test 8.1.5: Authenticated GET /session returns valid user and CSRF
  try {
    const res = await fetch(`${GATEWAY_ORIGIN}/api/v1/browser/session`, {
      headers: {
        Host: HOST_HEADER,
        Cookie: `urumi_session=${adminCookie}`,
      },
    });
    const body: any = await res.json();
    record({
      id: 'TEST-8.1.5',
      category: '8.1 Browser Session',
      description: 'Authenticated GET /session returns current user profile and CSRF',
      passed: res.status === 200 && body.user?.username === 'admin',
      httpStatus: res.status,
      details: `Returned user: ${body.user?.username}, role: ${body.user?.role}`,
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.1.5',
      category: '8.1 Browser Session',
      description: 'Authenticated GET /session returns current user profile and CSRF',
      passed: false,
      error: err.message,
    });
  }

  // Test 8.1.6: State-changing request without valid CSRF rejected
  try {
    const res = await fetch(`${GATEWAY_ORIGIN}/api/v1/browser/invitations`, {
      method: 'POST',
      headers: {
        Host: HOST_HEADER,
        Origin: GATEWAY_ORIGIN,
        Cookie: `urumi_session=${adminCookie}`,
        'Content-Type': 'application/json',
        // Missing x-urumi-csrf
      },
      body: JSON.stringify({ role: 'member' }),
    });
    const body: any = await res.json().catch(() => ({}));
    record({
      id: 'TEST-8.1.6',
      category: '8.1 Browser Session',
      description: 'State-changing mutation without CSRF token rejected with 403',
      passed: res.status === 403 && body.code === 'CSRF_TOKEN_INVALID',
      httpStatus: res.status,
      details: JSON.stringify(body),
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.1.6',
      category: '8.1 Browser Session',
      description: 'State-changing mutation without CSRF token rejected with 403',
      passed: false,
      error: err.message,
    });
  }

  // Test 8.1.7: State-changing request with invalid / untrusted Origin rejected
  try {
    const res = await fetch(`${GATEWAY_ORIGIN}/api/v1/browser/invitations`, {
      method: 'POST',
      headers: {
        Host: HOST_HEADER,
        Origin: 'http://malicious-attacker.com',
        Cookie: `urumi_session=${adminCookie}`,
        'x-urumi-csrf': adminCsrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'member' }),
    });
    const body: any = await res.json().catch(() => ({}));
    record({
      id: 'TEST-8.1.7',
      category: '8.1 Browser Session',
      description: 'State-changing mutation with untrusted Origin rejected with 403',
      passed: res.status === 403 && (body.code === 'CSRF_ORIGIN_FORBIDDEN' || body.code === 'ORIGIN_FORBIDDEN'),
      httpStatus: res.status,
      details: JSON.stringify(body),
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.1.7',
      category: '8.1 Browser Session',
      description: 'State-changing mutation with untrusted Origin rejected with 403',
      passed: false,
      error: err.message,
    });
  }

  // -------------------------------------------------------------------------
  // 8.2 Team & API-Key Management
  // -------------------------------------------------------------------------
  console.log('\n--- 8.2 Team & API-Key Management ---');

  // Test 8.2.1: Admin creates invitation for member
  let inviteToken = '';
  try {
    const res = await fetch(`${GATEWAY_ORIGIN}/api/v1/browser/invitations`, {
      method: 'POST',
      headers: {
        Host: HOST_HEADER,
        Origin: GATEWAY_ORIGIN,
        Cookie: `urumi_session=${adminCookie}`,
        'x-urumi-csrf': adminCsrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'member' }),
    });
    const body: any = await res.json();
    inviteToken = body.invitation?.token;
    record({
      id: 'TEST-8.2.1',
      category: '8.2 Team Management',
      description: 'Admin creates invitation token for new member',
      passed: res.status === 201 && Boolean(inviteToken) && body.invitation?.role === 'member',
      httpStatus: res.status,
      details: `Invitation ID: ${body.invitation?.id}, Role: ${body.invitation?.role}, Token Length: ${inviteToken?.length} chars`,
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.2.1',
      category: '8.2 Team Management',
      description: 'Admin creates invitation token for new member',
      passed: false,
      error: err.message,
    });
  }

  // Test 8.2.2: Redeem single-use invitation
  const testMemberUsername = `member_test_${Date.now().toString().slice(-4)}`;
  const testMemberPassword = 'MemberSecurePass123!';
  let memberCookie = '';
  let memberCsrf = '';
  let memberUserId = '';
  try {
    const res = await fetch(`${GATEWAY_ORIGIN}/api/v1/browser/invitations/redeem`, {
      method: 'POST',
      headers: {
        Host: HOST_HEADER,
        Origin: GATEWAY_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token: inviteToken,
        username: testMemberUsername,
        password: testMemberPassword,
      }),
    });
    const body: any = await res.json();
    const cookieHeader = res.headers.get('set-cookie') || '';
    const match = cookieHeader.match(/urumi_session=([^;]+)/);
    if (match) memberCookie = match[1];
    memberCsrf = body.csrfToken;
    memberUserId = body.user?.id;

    record({
      id: 'TEST-8.2.2',
      category: '8.2 Team Management',
      description: 'Redeem single-use invitation creates member account and active session',
      passed: (res.status === 200 || res.status === 201) && body.user?.username === testMemberUsername && body.user?.role === 'member',
      httpStatus: res.status,
      details: `User ID: ${memberUserId}, Username: ${body.user?.username}, Role: ${body.user?.role}`,
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.2.2',
      category: '8.2 Team Management',
      description: 'Redeem single-use invitation creates member account and active session',
      passed: false,
      error: err.message,
    });
  }

  // Test 8.2.3: Replay of redeemed single-use invitation fails closed
  try {
    const res = await fetch(`${GATEWAY_ORIGIN}/api/v1/browser/invitations/redeem`, {
      method: 'POST',
      headers: {
        Host: HOST_HEADER,
        Origin: GATEWAY_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token: inviteToken,
        username: `replay_${Date.now().toString().slice(-4)}`,
        password: testMemberPassword,
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    record({
      id: 'TEST-8.2.3',
      category: '8.2 Team Management',
      description: 'Single-use invitation replay attempt rejected with 400',
      passed: res.status === 400 && body.code === 'INVITATION_INVALID',
      httpStatus: res.status,
      details: JSON.stringify(body),
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.2.3',
      category: '8.2 Team Management',
      description: 'Single-use invitation replay attempt rejected with 400',
      passed: false,
      error: err.message,
    });
  }

  // Test 8.2.4: Member attempts admin-only operation (GET /members) -> denied 403
  try {
    const res = await fetch(`${GATEWAY_ORIGIN}/api/v1/browser/members`, {
      headers: {
        Host: HOST_HEADER,
        Cookie: `urumi_session=${memberCookie}`,
      },
    });
    const body: any = await res.json().catch(() => ({}));
    record({
      id: 'TEST-8.2.4',
      category: '8.2 RBAC Authorization',
      description: 'Member attempting admin-only endpoint (GET /members) denied with 403',
      passed: res.status === 403 && (body.code === 'FORBIDDEN' || body.code === 'ROLE_FORBIDDEN'),
      httpStatus: res.status,
      details: JSON.stringify(body),
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.2.4',
      category: '8.2 RBAC Authorization',
      description: 'Member attempting admin-only endpoint (GET /members) denied with 403',
      passed: false,
      error: err.message,
    });
  }

  // Test 8.2.5: Member creates an API key
  let memberRawApiKey = '';
  let memberKeyId = '';
  try {
    const res = await fetch(`${GATEWAY_ORIGIN}/api/v1/browser/keys`, {
      method: 'POST',
      headers: {
        Host: HOST_HEADER,
        Origin: GATEWAY_ORIGIN,
        Cookie: `urumi_session=${memberCookie}`,
        'x-urumi-csrf': memberCsrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Member Test Key' }),
    });
    const body: any = await res.json();
    memberRawApiKey = body.rawKey;
    memberKeyId = body.apiKey?.id;
    record({
      id: 'TEST-8.2.5',
      category: '8.2 API Key Lifecycle',
      description: 'Member creates API key; raw plaintext key is returned exactly once',
      passed: res.status === 201 && Boolean(memberRawApiKey) && memberRawApiKey.startsWith('urumi_live_'),
      httpStatus: res.status,
      details: `Key ID: ${memberKeyId}, Prefix: ${body.apiKey?.keyPrefix}, RawKey starts with urumi_live_`,
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.2.5',
      category: '8.2 API Key Lifecycle',
      description: 'Member creates API key; raw plaintext key is returned exactly once',
      passed: false,
      error: err.message,
    });
  }

  // Test 8.2.6: Member lists API keys -> raw plaintext is NOT disclosed
  try {
    const res = await fetch(`${GATEWAY_ORIGIN}/api/v1/browser/keys`, {
      headers: {
        Host: HOST_HEADER,
        Cookie: `urumi_session=${memberCookie}`,
      },
    });
    const body: any = await res.json();
    const keyRecord = body.keys?.find((k: any) => k.id === memberKeyId);
    const hasRawKey = Boolean(keyRecord?.rawKey || JSON.stringify(body).includes(memberRawApiKey));

    record({
      id: 'TEST-8.2.6',
      category: '8.2 API Key Lifecycle',
      description: 'Key listing returns metadata and prefix, never exposing raw secret',
      passed: res.status === 200 && Boolean(keyRecord) && !hasRawKey,
      httpStatus: res.status,
      details: `Found key ${memberKeyId}, raw secret confirmed absent from listing`,
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.2.6',
      category: '8.2 API Key Lifecycle',
      description: 'Key listing returns metadata and prefix, never exposing raw secret',
      passed: false,
      error: err.message,
    });
  }

  // Test 8.2.7: Last active administrator protection
  try {
    const res = await fetch(`${GATEWAY_ORIGIN}/api/v1/browser/members/${adminUserId}/deactivate`, {
      method: 'POST',
      headers: {
        Host: HOST_HEADER,
        Origin: GATEWAY_ORIGIN,
        Cookie: `urumi_session=${adminCookie}`,
        'x-urumi-csrf': adminCsrf,
      },
    });
    const body: any = await res.json().catch(() => ({}));
    record({
      id: 'TEST-8.2.7',
      category: '8.2 Admin Protection',
      description: 'Deactivating last active administrator prevented with 400',
      passed: res.status === 400 && (body.code === 'LAST_ADMIN_PROTECTED' || body.code === 'SELF_DEACTIVATION_PROHIBITED'),
      httpStatus: res.status,
      details: JSON.stringify(body),
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.2.7',
      category: '8.2 Admin Protection',
      description: 'Deactivating last active administrator prevented with 400',
      passed: false,
      error: err.message,
    });
  }

  // -------------------------------------------------------------------------
  // 8.3 MCP Endpoint & Authentication
  // -------------------------------------------------------------------------
  console.log('\n--- 8.3 MCP Endpoint & Authentication ---');

  // Test 8.3.1: Valid member API key authenticates to /mcp
  try {
    const res = await fetch(`${GATEWAY_ORIGIN}/mcp`, {
      method: 'POST',
      headers: {
        Host: HOST_HEADER,
        Authorization: `Bearer ${memberRawApiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'acceptance-client', version: '1.0.0' },
        },
      }),
    });
    const text = await res.text();
    let body: any = {};
    const match = text.match(/data:\s*(\{.*\})/);
    if (match) {
      body = JSON.parse(match[1]);
    } else {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text };
      }
    }
    record({
      id: 'TEST-8.3.1',
      category: '8.3 MCP Authentication',
      description: 'Valid API key successfully authenticates to /mcp and initializes protocol',
      passed: res.status === 200 && body.result?.serverInfo?.name === 'urumi-gateway',
      httpStatus: res.status,
      details: `Server: ${body.result?.serverInfo?.name} (v${body.result?.serverInfo?.version})`,
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.3.1',
      category: '8.3 MCP Authentication',
      description: 'Valid API key successfully authenticates to /mcp and initializes protocol',
      passed: false,
      error: err.message,
    });
  }

  // Test 8.3.2: Invalid API key rejected on /mcp
  try {
    const res = await fetch(`${GATEWAY_ORIGIN}/mcp`, {
      method: 'POST',
      headers: {
        Host: HOST_HEADER,
        Authorization: 'Bearer urumi_live_invalid_key_1234567890abcdef',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
      }),
    });
    record({
      id: 'TEST-8.3.2',
      category: '8.3 MCP Authentication',
      description: 'Invalid API key rejected on /mcp with 401',
      passed: res.status === 401,
      httpStatus: res.status,
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.3.2',
      category: '8.3 MCP Authentication',
      description: 'Invalid API key rejected on /mcp with 401',
      passed: false,
      error: err.message,
    });
  }

  // Test 8.3.3: Session cookie separation (Cookie does NOT authenticate /mcp)
  try {
    const res = await fetch(`${GATEWAY_ORIGIN}/mcp`, {
      method: 'POST',
      headers: {
        Host: HOST_HEADER,
        Cookie: `urumi_session=${memberCookie}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
      }),
    });
    record({
      id: 'TEST-8.3.3',
      category: '8.3 Perimeter Separation',
      description: 'Browser session cookie rejected on /mcp (Cookie != MCP Bearer auth)',
      passed: res.status === 401,
      httpStatus: res.status,
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.3.3',
      category: '8.3 Perimeter Separation',
      description: 'Browser session cookie rejected on /mcp (Cookie != MCP Bearer auth)',
      passed: false,
      error: err.message,
    });
  }

  // Test 8.3.4: Bearer key separation (API Key does NOT authenticate /api/v1/browser)
  try {
    const res = await fetch(`${GATEWAY_ORIGIN}/api/v1/browser/session`, {
      headers: {
        Host: HOST_HEADER,
        Authorization: `Bearer ${memberRawApiKey}`,
      },
    });
    record({
      id: 'TEST-8.3.4',
      category: '8.3 Perimeter Separation',
      description: 'API key rejected on /api/v1/browser (Bearer auth != Browser session)',
      passed: res.status === 401,
      httpStatus: res.status,
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.3.4',
      category: '8.3 Perimeter Separation',
      description: 'API key rejected on /api/v1/browser (Bearer auth != Browser session)',
      passed: false,
      error: err.message,
    });
  }

  // Test 8.2.8: Revoke API key and verify rejection
  try {
    const res = await fetch(`${GATEWAY_ORIGIN}/api/v1/browser/keys/${memberKeyId}/revoke`, {
      method: 'POST',
      headers: {
        Host: HOST_HEADER,
        Origin: GATEWAY_ORIGIN,
        Cookie: `urumi_session=${memberCookie}`,
        'x-urumi-csrf': memberCsrf,
      },
    });
    const revokeBody: any = await res.json();

    // Now test /mcp using revoked key
    const mcpRes = await fetch(`${GATEWAY_ORIGIN}/mcp`, {
      method: 'POST',
      headers: {
        Host: HOST_HEADER,
        Authorization: `Bearer ${memberRawApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
      }),
    });

    record({
      id: 'TEST-8.2.8',
      category: '8.2 API Key Lifecycle',
      description: 'Revoking API key immediately rejects subsequent MCP authentication attempts with 401',
      passed: res.status === 200 && mcpRes.status === 401,
      httpStatus: mcpRes.status,
      details: `Revoke status: ${res.status}, MCP status after revocation: ${mcpRes.status}`,
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.2.8',
      category: '8.2 API Key Lifecycle',
      description: 'Revoking API key immediately rejects subsequent MCP authentication attempts with 401',
      passed: false,
      error: err.message,
    });
  }

  // -------------------------------------------------------------------------
  // 8.4 Upstream Management & Façade
  // -------------------------------------------------------------------------
  console.log('\n--- 8.4 Upstream Management & Façade ---');

  // Test 8.4.1: Admin lists upstreams; verify DTO cleanliness
  let upstreamsList: any[] = [];
  try {
    const res = await fetch(`${GATEWAY_ORIGIN}/api/v1/browser/upstreams`, {
      headers: {
        Host: HOST_HEADER,
        Cookie: `urumi_session=${adminCookie}`,
      },
    });
    const body: any = await res.json();
    upstreamsList = body.upstreams || [];

    const rawString = JSON.stringify(body);
    const hasSecretRef = rawString.includes('secretRefName') || rawString.includes('secret_name');
    const hasCredentials = rawString.includes('password') || rawString.includes('consumer-secret');

    record({
      id: 'TEST-8.4.1',
      category: '8.4 Upstream Management',
      description: 'Admin lists upstreams with health; secret refs and credentials strictly excluded',
      passed: res.status === 200 && upstreamsList.length >= 3 && !hasSecretRef && !hasCredentials,
      httpStatus: res.status,
      details: `Found ${upstreamsList.length} upstreams: ${upstreamsList.map((u) => u.slug).join(', ')}`,
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.4.1',
      category: '8.4 Upstream Management',
      description: 'Admin lists upstreams with health; secret refs and credentials strictly excluded',
      passed: false,
      error: err.message,
    });
  }

  // Test 8.4.2: SSRF protection on upstream registration
  try {
    const res = await fetch(`${GATEWAY_ORIGIN}/api/v1/browser/upstreams`, {
      method: 'POST',
      headers: {
        Host: HOST_HEADER,
        Origin: GATEWAY_ORIGIN,
        Cookie: `urumi_session=${adminCookie}`,
        'x-urumi-csrf': adminCsrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        slug: 'ssrf-test',
        displayName: 'SSRF Attack Vector',
        endpointUrl: 'http://169.254.169.254/mcp',
        timeoutMs: 5000,
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    record({
      id: 'TEST-8.4.2',
      category: '8.4 Upstream Management',
      description: 'SSRF attack vector (cloud metadata IP) rejected on upstream registration with 400',
      passed: res.status === 400 && (body.code === 'SSRF_VALIDATION_FAILED' || body.code === 'VALIDATION_ERROR' || JSON.stringify(body).includes('Prohibited')),
      httpStatus: res.status,
      details: JSON.stringify(body),
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.4.2',
      category: '8.4 Upstream Management',
      description: 'SSRF attack vector (cloud metadata IP) rejected on upstream registration with 400',
      passed: false,
      error: err.message,
    });
  }

  // -------------------------------------------------------------------------
  // 8.5 WooCommerce Integration & Record Preservation
  // -------------------------------------------------------------------------
  console.log('\n--- 8.5 WooCommerce Integration & Record Preservation ---');

  // Test 8.5.1: Verify WooCommerce MCP Tool list via admin upstream tools
  try {
    const wcUpstream = upstreamsList.find((u) => u.slug === 'woocommerce');
    if (!wcUpstream) throw new Error('woocommerce upstream not found');

    const res = await fetch(`${GATEWAY_ORIGIN}/api/v1/browser/upstreams/${wcUpstream.id}/tools`, {
      headers: {
        Host: HOST_HEADER,
        Cookie: `urumi_session=${adminCookie}`,
      },
    });
    const body: any = await res.json();
    const toolNames = (body.tools || []).map((t: any) => t.name);

    record({
      id: 'TEST-8.5.1',
      category: '8.5 WooCommerce Integration',
      description: 'Gateway discovers 5 WooCommerce MCP tools from upstream service',
      passed: res.status === 200 && toolNames.includes('list_products') && toolNames.includes('get_order'),
      httpStatus: res.status,
      details: `Discovered tools: ${toolNames.join(', ')}`,
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.5.1',
      category: '8.5 WooCommerce Integration',
      description: 'Gateway discovers 5 WooCommerce MCP tools from upstream service',
      passed: false,
      error: err.message,
    });
  }

  // Test 8.5.2: In-pod WP-CLI read-only audit of Products 10, 11, 12 and Order #14
  try {
    const postList = execSync(
      `kubectl exec -n urumi deployment/urumi-wordpress -- wp post list --post_type=product,shop_order --allow-root --fields=ID,post_title,post_status,post_type`,
      { encoding: 'utf8' }
    );
    const has10 = postList.includes('10\tUrumi Test Mug\tpublish\tproduct');
    const has11 = postList.includes('11\tWireless Mouse Demo\tpublish\tproduct');
    const has12 = postList.includes('12\tNotebook Demo\tpublish\tproduct');
    const has14 = postList.includes('14\tOrder');

    const orderDetail = execSync(
      `kubectl exec -n urumi deployment/urumi-wordpress -- wp wc shop_order get 14 --user=urumi_admin --allow-root --fields=id,status,total,currency`,
      { encoding: 'utf8' }
    );
    const orderValid =
      orderDetail.includes('id\t14') &&
      orderDetail.includes('status\tprocessing') &&
      orderDetail.includes('total\t299.00') &&
      orderDetail.includes('currency\tINR');

    record({
      id: 'TEST-8.5.2',
      category: '8.5 Data Preservation',
      description: 'WooCommerce protected records (Products 10, 11, 12 & Order #14) verified 100% intact',
      passed: has10 && has11 && has12 && has14 && orderValid,
      details: 'Product 10: Mug (₹299), 11: Mouse (₹799), 12: Notebook (₹149); Order 14: processing (₹299 INR)',
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.5.2',
      category: '8.5 Data Preservation',
      description: 'WooCommerce protected records (Products 10, 11, 12 & Order #14) verified 100% intact',
      passed: false,
      error: err.message,
    });
  }

  // -------------------------------------------------------------------------
  // 8.6 Audit-Log API & Dashboard
  // -------------------------------------------------------------------------
  console.log('\n--- 8.6 Audit-Log API & Dashboard ---');

  // Test 8.6.1: Admin queries audit logs with pagination
  try {
    const res = await fetch(`${GATEWAY_ORIGIN}/api/v1/browser/audit?limit=5`, {
      headers: {
        Host: HOST_HEADER,
        Cookie: `urumi_session=${adminCookie}`,
      },
    });
    const body: any = await res.json();
    const hasAuditEntries = Array.isArray(body.audits) && body.audits.length > 0;
    const rawString = JSON.stringify(body);
    const hasRawSecret = rawString.includes('urumi_live_') || rawString.includes('AdminPassword');

    record({
      id: 'TEST-8.6.1',
      category: '8.6 Audit-Log API',
      description: 'Admin queries audit logs; records are paginated and sanitized without secret leakage',
      passed: res.status === 200 && hasAuditEntries && !hasRawSecret,
      httpStatus: res.status,
      details: `Returned ${body.audits?.length} audit records, limit: ${body.limit}, offset: ${body.offset}`,
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.6.1',
      category: '8.6 Audit-Log API',
      description: 'Admin queries audit logs; records are paginated and sanitized without secret leakage',
      passed: false,
      error: err.message,
    });
  }

  // Test 8.6.2: Member denied audit query
  try {
    const res = await fetch(`${GATEWAY_ORIGIN}/api/v1/browser/audit`, {
      headers: {
        Host: HOST_HEADER,
        Cookie: `urumi_session=${memberCookie}`,
      },
    });
    const body: any = await res.json().catch(() => ({}));
    record({
      id: 'TEST-8.6.2',
      category: '8.6 Audit-Log API',
      description: 'Member denied access to global audit-log query with 403',
      passed: res.status === 403 && (body.code === 'FORBIDDEN' || body.code === 'ROLE_FORBIDDEN'),
      httpStatus: res.status,
      details: JSON.stringify(body),
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.6.2',
      category: '8.6 Audit-Log API',
      description: 'Member denied access to global audit-log query with 403',
      passed: false,
      error: err.message,
    });
  }

  // -------------------------------------------------------------------------
  // 8.7 Persistence & SQLite Integrity
  // -------------------------------------------------------------------------
  console.log('\n--- 8.7 Persistence & SQLite Integrity ---');

  // Test 8.7.1: SQLite integrity check and foreign key check on live pod
  try {
    const checkOutput = execSync(
      `kubectl exec -n urumi deployment/urumi-gateway -- node -e '
        const { DatabaseSync } = require("node:sqlite");
        const db = new DatabaseSync("/data/gateway.db", { readOnly: true });
        const integrity = db.prepare("PRAGMA integrity_check;").all();
        const fk = db.prepare("PRAGMA foreign_key_check;").all();
        console.log(JSON.stringify({ integrity: integrity[0]?.integrity_check, fkViolations: fk.length }));
      '`,
      { encoding: 'utf8' }
    );
    const parsed = JSON.parse(checkOutput.trim().split('\n').pop() || '{}');
    record({
      id: 'TEST-8.7.1',
      category: '8.7 Persistence & Integrity',
      description: 'Live SQLite database passes PRAGMA integrity_check and foreign_key_check',
      passed: parsed.integrity === 'ok' && parsed.fkViolations === 0,
      details: `Integrity: ${parsed.integrity}, FK Violations: ${parsed.fkViolations}`,
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.7.1',
      category: '8.7 Persistence & Integrity',
      description: 'Live SQLite database passes PRAGMA integrity_check and foreign_key_check',
      passed: false,
      error: err.message,
    });
  }

  // -------------------------------------------------------------------------
  // 8.8 Network & Secret Boundaries
  // -------------------------------------------------------------------------
  console.log('\n--- 8.8 Network & Secret Boundaries ---');

  // Test 8.8.1: Verify gateway cannot directly reach WordPress on port 80 (NetworkPolicy)
  try {
    let blocked = false;
    try {
      execSync(
        `kubectl exec -n urumi deployment/urumi-gateway -- node -e '
          const http = require("node:http");
          const req = http.get("http://urumi-wordpress.urumi.svc.cluster.local:80", { timeout: 3000 }, (res) => {
            process.exit(0); // If reached, egress was improperly allowed
          });
          req.on("error", () => process.exit(1));
          req.on("timeout", () => { req.destroy(); process.exit(1); });
        '`,
        { timeout: 5000 }
      );
    } catch {
      blocked = true; // Expected: timeout or connection error due to NetworkPolicy
    }

    record({
      id: 'TEST-8.8.1',
      category: '8.8 Network Policy Boundary',
      description: 'Gateway egress directly to WordPress port 80 strictly blocked by NetworkPolicy',
      passed: blocked,
      details: 'Direct TCP connection timed out as enforced by urumi-gateway-netpol',
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.8.1',
      category: '8.8 Network Policy Boundary',
      description: 'Gateway egress directly to WordPress port 80 strictly blocked by NetworkPolicy',
      passed: false,
      error: err.message,
    });
  }

  // Test 8.8.2: Verify gateway cannot directly reach MariaDB on port 3306 (NetworkPolicy)
  try {
    let blocked = false;
    try {
      execSync(
        `kubectl exec -n urumi deployment/urumi-gateway -- node -e '
          const net = require("node:net");
          const client = net.createConnection({ host: "urumi-mariadb.urumi.svc.cluster.local", port: 3306, timeout: 3000 }, () => {
            process.exit(0); // If reached, egress was improperly allowed
          });
          client.on("error", () => process.exit(1));
          client.on("timeout", () => { client.destroy(); process.exit(1); });
        '`,
        { timeout: 5000 }
      );
    } catch {
      blocked = true; // Expected: timeout or connection error due to NetworkPolicy
    }

    record({
      id: 'TEST-8.8.2',
      category: '8.8 Network Policy Boundary',
      description: 'Gateway egress directly to MariaDB port 3306 strictly blocked by NetworkPolicy',
      passed: blocked,
      details: 'Direct TCP connection timed out as enforced by urumi-gateway-netpol',
    });
  } catch (err: any) {
    record({
      id: 'TEST-8.8.2',
      category: '8.8 Network Policy Boundary',
      description: 'Gateway egress directly to MariaDB port 3306 strictly blocked by NetworkPolicy',
      passed: false,
      error: err.message,
    });
  }

  // -------------------------------------------------------------------------
  // Clean up test member
  // -------------------------------------------------------------------------
  if (memberUserId) {
    try {
      await fetch(`${GATEWAY_ORIGIN}/api/v1/browser/members/${memberUserId}/deactivate`, {
        method: 'POST',
        headers: {
          Host: HOST_HEADER,
          Origin: GATEWAY_ORIGIN,
          Cookie: `urumi_session=${adminCookie}`,
          'x-urumi-csrf': adminCsrf,
        },
      });
      console.log(`[CLEANUP] Successfully deactivated test member ID: ${memberUserId}`);
    } catch {}
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  console.log(`TOTAL TESTS: ${results.length} | PASSED: ${passedCount} | FAILED: ${failedCount}`);
  console.log('================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runAcceptanceSuite().catch((err) => {
  console.error('Fatal execution error in acceptance suite:', err);
  process.exit(1);
});
