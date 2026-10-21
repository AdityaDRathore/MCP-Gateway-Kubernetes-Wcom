import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../src/db/migrations.js';
import { MIGRATIONS } from '../../src/db/schema.js';
import { createBrowserApp } from '../../src/server.js';
import { UserRepository } from '../../src/db/user-repo.js';
import { SessionRepository } from '../../src/db/session-repo.js';
import { ScryptPasswordService } from '../../src/auth/scrypt-password-service.js';
import { SessionService, SESSION_COOKIE_NAME } from '../../src/auth/session-service.js';
import { AuditRepository, AuditStatus } from '../../src/db/audit-repo.js';
import { parseConfig } from '../../src/config.js';

describe('Audit Log Query & Bounded Pagination Unit Tests (P5-G5)', () => {
  let db: DatabaseSync;
  let userRepo: UserRepository;
  let sessionRepo: SessionRepository;
  let passwordService: ScryptPasswordService;
  let sessionService: SessionService;
  let auditRepo: AuditRepository;

  let server: http.Server;
  let baseUrl: string;
  const allowedOrigin = 'http://localhost:3001';

  let adminSession: { rawToken: string; csrfToken: string; userId: string };

  const userAdminId = '11111111-1111-4111-8111-111111111111';
  const userMemberId = '22222222-2222-4222-8222-222222222222';

  before(async () => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, MIGRATIONS);

    userRepo = new UserRepository(db);
    sessionRepo = new SessionRepository(db);
    passwordService = new ScryptPasswordService();
    sessionService = new SessionService(sessionRepo, userRepo);
    auditRepo = new AuditRepository(db);

    // Seed test users
    userRepo.insertUser({ id: userAdminId, username: 'audit_admin', role: 'admin', is_active: 1 });
    userRepo.insertUser({ id: userMemberId, username: 'audit_member', role: 'member', is_active: 1 });

    const adminPw = await passwordService.hashPassword('AdminPass123!');
    userRepo.setUserCredentials(userAdminId, adminPw);

    const s = await sessionService.createSession(userAdminId, {
      userAgent: 'Unit-Test-Agent',
      ipAddress: '127.0.0.1',
    });
    adminSession = { rawToken: s.rawToken, csrfToken: s.csrfToken, userId: userAdminId };

    const config = parseConfig({
      PORT: 3000,
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      DB_PATH: ':memory:',
      ALLOWED_ORIGINS: allowedOrigin,
      TRUSTED_PROXIES: '127.0.0.1,::1',
      COOKIE_SECURE: false,
    });

    const app = createBrowserApp({
      config,
      sessionService,
      userRepo,
      passwordService,
      auditRepo,
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(() => {
    server?.close();
    db?.close();
  });

  async function requestAudit(
    queryStr: string,
    token = adminSession.rawToken
  ): Promise<{ status: number; body: any }> {
    const url = `${baseUrl}/api/v1/browser/audit${queryStr ? `?${queryStr}` : ''}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        ...(token ? { Cookie: `${SESSION_COOKIE_NAME}=${token}` } : {}),
      },
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  }

  it('AUD-UNIT-01: applies default limit=25 and offset=0 when query is empty', async () => {
    const { status, body } = await requestAudit('');
    assert.equal(status, 200);
    assert.equal(body.limit, 25);
    assert.equal(body.offset, 0);
    assert.ok(Array.isArray(body.audits));
    assert.equal(body.audits.length, 0);
  });

  it('AUD-UNIT-02: rejects limit > 100 or limit < 1 with HTTP 400', async () => {
    const resHigh = await requestAudit('limit=101');
    assert.equal(resHigh.status, 400);
    assert.equal(resHigh.body.code, 'INVALID_QUERY_PARAMS');
    assert.match(resHigh.body.error, /Limit cannot exceed 100/);

    const resLow = await requestAudit('limit=0');
    assert.equal(resLow.status, 400);
    assert.equal(resLow.body.code, 'INVALID_QUERY_PARAMS');
    assert.match(resLow.body.error, /Limit must be >= 1/);
  });

  it('AUD-UNIT-03: rejects negative offset with HTTP 400', async () => {
    const { status, body } = await requestAudit('offset=-5');
    assert.equal(status, 400);
    assert.equal(body.code, 'INVALID_QUERY_PARAMS');
    assert.match(body.error, /Offset must be >= 0/);
  });

  it('AUD-UNIT-04: enforces deterministic pagination slicing across 60 seeded records', async () => {
    // Seed 60 records with controlled timestamps and IDs
    const baseTime = 1729500000;
    for (let i = 1; i <= 60; i++) {
      const id = `aud-slice-${String(i).padStart(3, '0')}`;
      // Group some records with identical timestamp to test tie-breaker
      const createdAt = baseTime + Math.floor(i / 2);
      auditRepo.insertAuditStart({
        id,
        user_id: userAdminId,
        upstream_slug: 'woocommerce',
        tool_name: 'woocommerce_list_products',
        arguments_hash: `hash-${i}`,
        created_at: createdAt,
      });
      auditRepo.updateAuditFinalize(id, {
        status: 'success',
        duration_ms: 10 + i,
      });
    }

    // Page 1: limit 25, offset 0
    const page1 = await requestAudit('limit=25&offset=0');
    assert.equal(page1.status, 200);
    assert.equal(page1.body.audits.length, 25);

    // Page 2: limit 25, offset 25
    const page2 = await requestAudit('limit=25&offset=25');
    assert.equal(page2.status, 200);
    assert.equal(page2.body.audits.length, 25);

    // Page 3: limit 25, offset 50
    const page3 = await requestAudit('limit=25&offset=50');
    assert.equal(page3.status, 200);
    assert.equal(page3.body.audits.length, 10);

    // Verify zero overlap across pages
    const idsPage1 = new Set(page1.body.audits.map((a: any) => a.id));
    const idsPage2 = new Set(page2.body.audits.map((a: any) => a.id));
    const idsPage3 = new Set(page3.body.audits.map((a: any) => a.id));

    assert.equal(idsPage1.size, 25);
    assert.equal(idsPage2.size, 25);
    assert.equal(idsPage3.size, 10);

    for (const id of idsPage2) {
      assert.ok(!idsPage1.has(id), `Page 2 has duplicate ID from Page 1: ${id}`);
    }
    for (const id of idsPage3) {
      assert.ok(!idsPage1.has(id), `Page 3 has duplicate ID from Page 1: ${id}`);
      assert.ok(!idsPage2.has(id), `Page 3 has duplicate ID from Page 2: ${id}`);
    }
  });

  it('AUD-UNIT-05: filters accurately by status', async () => {
    // Insert distinct statuses
    const statuses: AuditStatus[] = [
      'pending',
      'success',
      'failed',
      'timeout',
      'client_disconnected',
      'unconfirmed_outcome',
    ];

    for (const st of statuses) {
      const id = `aud-status-${st}`;
      auditRepo.insertAuditStart({
        id,
        user_id: userAdminId,
        upstream_slug: 'tasks',
        tool_name: 'tasks_list_tasks',
        arguments_hash: `hash-st-${st}`,
        created_at: 1729510000,
      });
      if (st !== 'pending') {
        auditRepo.updateAuditFinalize(id, {
          status: st,
          duration_ms: 45,
          error_code: st === 'failed' ? 'UPSTREAM_ERROR' : undefined,
        });
      }
    }

    const resFailed = await requestAudit('status=failed');
    assert.equal(resFailed.status, 200);
    assert.ok(resFailed.body.audits.every((a: any) => a.status === 'failed'));
    assert.ok(resFailed.body.audits.some((a: any) => a.id === 'aud-status-failed'));

    const resUnconfirmed = await requestAudit('status=unconfirmed_outcome');
    assert.equal(resUnconfirmed.status, 200);
    assert.ok(resUnconfirmed.body.audits.every((a: any) => a.status === 'unconfirmed_outcome'));
    assert.ok(resUnconfirmed.body.audits.some((a: any) => a.id === 'aud-status-unconfirmed_outcome'));

    const resInvalid = await requestAudit('status=not_a_real_status');
    assert.equal(resInvalid.status, 400);
    assert.equal(resInvalid.body.code, 'INVALID_QUERY_PARAMS');
  });

  it('AUD-UNIT-06: filters accurately by userId', async () => {
    const idMemberRec = 'aud-member-record-1';
    auditRepo.insertAuditStart({
      id: idMemberRec,
      user_id: userMemberId,
      upstream_slug: 'crm',
      tool_name: 'crm_list_customers',
      arguments_hash: 'hash-member-1',
      created_at: 1729520000,
    });
    auditRepo.updateAuditFinalize(idMemberRec, {
      status: 'success',
      duration_ms: 30,
    });

    const resUser = await requestAudit(`userId=${userMemberId}`);
    assert.equal(resUser.status, 200);
    assert.ok(resUser.body.audits.length >= 1);
    assert.ok(resUser.body.audits.every((a: any) => a.userId === userMemberId));

    const resBadUser = await requestAudit('userId=not-a-uuid');
    assert.equal(resBadUser.status, 400);
    assert.equal(resBadUser.body.code, 'INVALID_QUERY_PARAMS');
  });

  it('AUD-UNIT-07: resolves usernames in batch and handles system/null callers gracefully', async () => {
    // Seed record without user_id (system/internal invocation)
    const idSys = 'aud-system-call-1';
    auditRepo.insertAuditStart({
      id: idSys,
      user_id: null,
      upstream_slug: 'crm',
      tool_name: 'crm_get_customer',
      arguments_hash: 'hash-sys',
      created_at: 1729530000,
    });
    auditRepo.updateAuditFinalize(idSys, {
      status: 'success',
      duration_ms: 22,
    });

    // Seed record with member user_id
    const idMember = 'aud-member-call-1';
    auditRepo.insertAuditStart({
      id: idMember,
      user_id: userMemberId,
      upstream_slug: 'tasks',
      tool_name: 'tasks_list_tasks',
      arguments_hash: 'hash-member-call',
      created_at: 1729530001,
    });
    auditRepo.updateAuditFinalize(idMember, {
      status: 'success',
      duration_ms: 25,
    });

    const { status, body } = await requestAudit('limit=10&offset=0');
    assert.equal(status, 200);

    const sysRec = body.audits.find((a: any) => a.id === idSys);
    assert.ok(sysRec);
    assert.equal(sysRec.userId, null);
    assert.equal(sysRec.username, null);

    const memberRec = body.audits.find((a: any) => a.id === idMember);
    assert.ok(memberRec);
    assert.equal(memberRec.userId, userMemberId);
    assert.equal(memberRec.username, 'audit_member');

    const adminRec = body.audits.find((a: any) => a.userId === userAdminId);
    if (adminRec) {
      assert.equal(adminRec.username, 'audit_admin');
    }
  });

  it('AUD-UNIT-08: omits arguments_hash and sanitizes sensitive error fragments', async () => {
    const idSec = 'aud-security-redact-1';
    auditRepo.insertAuditStart({
      id: idSec,
      user_id: userAdminId,
      upstream_slug: 'woocommerce',
      tool_name: 'woocommerce_get_order',
      arguments_hash: 'SECRET_ARGUMENTS_HASH_VALUE_DO_NOT_EXPOSE',
      created_at: 1729540000,
    });
    auditRepo.updateAuditFinalize(idSec, {
      status: 'failed',
      duration_ms: 50,
      error_code: 'UPSTREAM_AUTH_FAILURE',
      error_message: 'Failed to authenticate with Bearer urumi_live_supersecrettoken12345 at https://user:pass123@api.internal',
    });

    const { status, body } = await requestAudit('limit=5');
    assert.equal(status, 200);

    const secRec = body.audits.find((a: any) => a.id === idSec);
    assert.ok(secRec);

    // Invariant: arguments_hash is NEVER projected in BrowserAuditDTO
    assert.equal(secRec.arguments_hash, undefined);
    assert.equal('arguments_hash' in secRec, false);

    // Invariant: error message is sanitized
    assert.ok(!secRec.errorMessage.includes('urumi_live_supersecrettoken12345'));
    assert.ok(!secRec.errorMessage.includes('pass123'));
    assert.match(secRec.errorMessage, /\[REDACTED/);
  });

  it('AUD-UNIT-09: verifies EXPLAIN QUERY PLAN uses composite indexes without unindexed table scans', () => {
    // 1. Unfiltered paginated query plan (ordered by created_at DESC, id DESC)
    const unfilteredPlan = db.prepare(
      'EXPLAIN QUERY PLAN SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?;'
    ).all() as any[];
    assert.ok(unfilteredPlan.length > 0);
    const unfilteredDetails = unfilteredPlan.map((p) => p.detail).join('; ');
    assert.match(unfilteredDetails, /USING INDEX idx_audit_created_id/);
    assert.doesNotMatch(unfilteredDetails, /SCAN audit_logs\b(?!\s+USING INDEX)/);

    // 2. Status filtered paginated query plan
    const statusPlan = db.prepare(
      'EXPLAIN QUERY PLAN SELECT * FROM audit_logs WHERE status = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?;'
    ).all() as any[];
    assert.ok(statusPlan.length > 0);
    const statusDetails = statusPlan.map((p) => p.detail).join('; ');
    assert.match(statusDetails, /USING INDEX idx_audit_status_created_id/);
    assert.doesNotMatch(statusDetails, /SCAN audit_logs\b(?!\s+USING INDEX)/);

    // 3. User filtered paginated query plan
    const userPlan = db.prepare(
      'EXPLAIN QUERY PLAN SELECT * FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?;'
    ).all() as any[];
    assert.ok(userPlan.length > 0);
    const userDetails = userPlan.map((p) => p.detail).join('; ');
    assert.match(userDetails, /USING INDEX idx_audit_user_created/);
    assert.doesNotMatch(userDetails, /SCAN audit_logs\b(?!\s+USING INDEX)/);

    // 4. Status and user filtered paginated query plan
    const combinedPlan = db.prepare(
      'EXPLAIN QUERY PLAN SELECT * FROM audit_logs WHERE status = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?;'
    ).all() as any[];
    assert.ok(combinedPlan.length > 0);
    const combinedDetails = combinedPlan.map((p) => p.detail).join('; ');
    assert.match(combinedDetails, /USING INDEX (idx_audit_status_created_id|idx_audit_user_created)/);
    assert.doesNotMatch(combinedDetails, /SCAN audit_logs\b(?!\s+USING INDEX)/);
  });
});

