import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../src/db/migrations.js';
import { MIGRATIONS } from '../../src/db/schema.js';
import { AuditRepository } from '../../src/db/audit-repo.js';
import { AuditService, AuditStartError, computeArgumentsHash } from '../../src/audit/audit-service.js';

describe('Gateway Durable Two-Phase Audit Persistence Unit Tests', () => {
  function setupAuditService() {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, MIGRATIONS);
    const repo = new AuditRepository(db);
    const service = new AuditService(repo);
    return { db, repo, service };
  }

  it('records two-phase audit lifecycle from pending to success', () => {
    const { db, service } = setupAuditService();

    db.prepare("INSERT INTO users (id, username, role, created_at) VALUES ('user_123', 'test_user', 'member', 100);").run();

    const startTime = Date.now() - 50;
    const auditId = service.startAudit({
      userId: 'user_123',
      upstreamSlug: 'crm',
      toolName: 'crm__get_contact',
      arguments: { contactId: 'CRM-CONT-001' },
    });

    // Check Phase 1 state
    const phase1Row = service.getAuditById(auditId);
    assert.notEqual(phase1Row, null);
    assert.equal(phase1Row?.status, 'pending');
    assert.equal(phase1Row?.tool_name, 'crm__get_contact');
    assert.equal(phase1Row?.arguments_hash, computeArgumentsHash({ contactId: 'CRM-CONT-001' }));
    assert.equal(phase1Row?.duration_ms, null);

    // Commit Phase 2
    const finalizeRes = service.finalizeAudit(auditId, {
      status: 'success',
      startTimeMs: startTime,
    });
    assert.equal(finalizeRes.degraded, false);

    // Check Phase 2 state
    const phase2Row = service.getAuditById(auditId);
    assert.equal(phase2Row?.status, 'success');
    assert(phase2Row!.duration_ms! >= 50);
    assert.equal(phase2Row?.error_code, null);

    db.close();
  });

  it('records failed, timeout, and client_disconnected lifecycle statuses', () => {
    const { db, service } = setupAuditService();
    const startTime = Date.now() - 20;

    // Failed
    const failId = service.startAudit({ toolName: 'tasks__create_task' });
    service.finalizeAudit(failId, {
      status: 'failed',
      startTimeMs: startTime,
      errorCode: 'VALIDATION_ERROR',
      errorMessage: 'Invalid task title',
    });
    const failRow = service.getAuditById(failId);
    assert.equal(failRow?.status, 'failed');
    assert.equal(failRow?.error_code, 'VALIDATION_ERROR');

    // Timeout
    const timeoutId = service.startAudit({ toolName: 'crm__search_contacts' });
    service.finalizeAudit(timeoutId, {
      status: 'timeout',
      startTimeMs: startTime,
      errorCode: 'UPSTREAM_TIMEOUT',
    });
    const timeoutRow = service.getAuditById(timeoutId);
    assert.equal(timeoutRow?.status, 'timeout');
    assert.equal(timeoutRow?.error_code, 'UPSTREAM_TIMEOUT');

    // Client Disconnected
    const disconnectId = service.startAudit({ toolName: 'woocommerce__list_products' });
    service.finalizeAudit(disconnectId, {
      status: 'client_disconnected',
      startTimeMs: startTime,
    });
    const disconnectRow = service.getAuditById(disconnectId);
    assert.equal(disconnectRow?.status, 'client_disconnected');

    db.close();
  });

  it('enforces schema status constraint and rejects illegal audit status strings', () => {
    const { db } = setupAuditService();

    // Directly attempt illegal status in SQLite
    assert.throws(() => {
      db.prepare(`
        INSERT INTO audit_logs (id, tool_name, arguments_hash, status, created_at)
        VALUES ('audit_bad', 'tool_a', 'hash1', 'illegal_status_string', 100);
      `).run();
    });

    db.close();
  });

  it('stores arguments hash without persisting raw customer PII or secrets', () => {
    const { db, service } = setupAuditService();

    const sensitiveArgs = {
      customerName: 'Secret Customer',
      email: 'customer@personal.com',
      creditCard: '4111222233334444',
      token: 'bearer_token_xyz',
    };

    const auditId = service.startAudit({
      toolName: 'sensitive_tool',
      arguments: sensitiveArgs,
    });

    const row = db.prepare('SELECT * FROM audit_logs WHERE id = ?;').get(auditId) as Record<string, unknown>;
    assert.notEqual(row, undefined);

    // Verify row does not contain raw customer values
    const stringifiedRow = JSON.stringify(row);
    assert.equal(stringifiedRow.includes('Secret Customer'), false);
    assert.equal(stringifiedRow.includes('customer@personal.com'), false);
    assert.equal(stringifiedRow.includes('4111222233334444'), false);
    assert.equal(stringifiedRow.includes('bearer_token_xyz'), false);

    // Verify arguments_hash matches SHA-256 of sensitiveArgs
    assert.equal(row.arguments_hash, computeArgumentsHash(sensitiveArgs));

    db.close();
  });

  it('fails closed when Phase 1 audit start write fails', () => {
    const { db, repo } = setupAuditService();

    // Simulate database write failure by closing connection
    db.close();

    const service = new AuditService(repo);
    assert.throws(
      () => service.startAudit({ toolName: 'test_tool' }),
      (err: unknown) => {
        assert(err instanceof AuditStartError);
        return true;
      }
    );
  });

  it('reconciles dangling pending records to unconfirmed_outcome', () => {
    const { db, service } = setupAuditService();

    const now = Math.floor(Date.now() / 1000);

    // Stale pending record created 60 seconds ago
    db.prepare(`
      INSERT INTO audit_logs (id, tool_name, arguments_hash, status, created_at)
      VALUES ('dangling_1', 'tool_stale', 'hash_stale', 'pending', ?);
    `).run(now - 60);

    // Recent pending record created 5 seconds ago
    db.prepare(`
      INSERT INTO audit_logs (id, tool_name, arguments_hash, status, created_at)
      VALUES ('recent_1', 'tool_recent', 'hash_recent', 'pending', ?);
    `).run(now - 5);

    // Reconcile records older than 30 seconds
    const reconciled = service.reconcileDanglingRecords(30);
    assert.equal(reconciled, 1);

    const danglingRow = service.getAuditById('dangling_1');
    assert.equal(danglingRow?.status, 'unconfirmed_outcome');
    assert.equal(danglingRow?.error_code, 'FINALIZATION_TIMEOUT');

    const recentRow = service.getAuditById('recent_1');
    assert.equal(recentRow?.status, 'pending');

    db.close();
  });

  it('prunes old audit records exceeding retention limit in bounded batches', () => {
    const { db, service } = setupAuditService();

    const now = Math.floor(Date.now() / 1000);
    const fortyDaysAgo = now - 40 * 86400;

    // Insert 5 old records
    for (let i = 0; i < 5; i++) {
      db.prepare(`
        INSERT INTO audit_logs (id, tool_name, arguments_hash, status, created_at)
        VALUES (?, 'tool', 'hash', 'success', ?);
      `).run(`old_${i}`, fortyDaysAgo);
    }

    // Insert 1 fresh record
    db.prepare(`
      INSERT INTO audit_logs (id, tool_name, arguments_hash, status, created_at)
      VALUES ('fresh_1', 'tool', 'hash', 'success', ?);
    `).run(now);

    // Prune records older than 30 days
    const pruned = service.pruneAuditLogs(30, 10);
    assert.equal(pruned, 5);

    // Fresh record remains
    assert.notEqual(service.getAuditById('fresh_1'), null);
    // Old records deleted
    assert.equal(service.getAuditById('old_0'), null);

    db.close();
  });
});
