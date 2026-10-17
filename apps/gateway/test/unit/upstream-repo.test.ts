import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../src/db/migrations.js';
import { MIGRATIONS } from '../../src/db/schema.js';
import { UpstreamRepository, DEFAULT_UPSTREAMS } from '../../src/db/upstream-repo.js';

describe('Gateway SQLite Upstream Repository Unit Tests', () => {
  function setupTestDb(): { db: DatabaseSync; repo: UpstreamRepository } {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, MIGRATIONS);
    const repo = new UpstreamRepository(db);
    return { db, repo };
  }

  it('idempotently seeds default upstreams without duplicating or failing', () => {
    const { db, repo } = setupTestDb();

    // First seed
    const result1 = repo.seedDefaults();
    assert.equal(result1.inserted, 3);
    assert.equal(result1.existing, 0);

    const all = repo.getAllUpstreams();
    assert.equal(all.length, 3);
    assert.deepEqual(all.map((u) => u.slug), ['crm', 'tasks', 'woocommerce']);

    // Second seed: must be idempotent
    const result2 = repo.seedDefaults();
    assert.equal(result2.inserted, 0);
    assert.equal(result2.existing, 3);

    const allAfter = repo.getAllUpstreams();
    assert.equal(allAfter.length, 3);

    db.close();
  });

  it('preserves operator modifications across repeated seedDefaults runs', () => {
    const { db, repo } = setupTestDb();
    repo.seedDefaults();

    // Operator disables 'crm' and changes timeout
    const updated = repo.updateUpstream('crm', {
      isEnabled: 0,
      timeoutMs: 15000,
      displayName: 'Operator Custom CRM',
    });
    assert.notEqual(updated, null);
    assert.equal(updated!.is_enabled, 0);
    assert.equal(updated!.timeout_ms, 15000);
    assert.equal(updated!.display_name, 'Operator Custom CRM');

    // Repeat seedDefaults
    const repeatResult = repo.seedDefaults();
    assert.equal(repeatResult.inserted, 0);
    assert.equal(repeatResult.existing, 3);

    // Operator changes MUST be preserved
    const crmAfter = repo.getUpstreamBySlug('crm');
    assert.notEqual(crmAfter, null);
    assert.equal(crmAfter!.is_enabled, 0);
    assert.equal(crmAfter!.timeout_ms, 15000);
    assert.equal(crmAfter!.display_name, 'Operator Custom CRM');

    // getEnabledUpstreams should now return only woocommerce and tasks
    const enabled = repo.getEnabledUpstreams();
    assert.equal(enabled.length, 2);
    assert.deepEqual(enabled.map((u) => u.slug), ['tasks', 'woocommerce']);

    db.close();
  });

  it('enforces table constraints: timeout bounds, unique slug, and valid status', () => {
    const { db, repo } = setupTestDb();

    // 1. Valid insert
    repo.insertUpstream({
      slug: 'custom-mcp',
      displayName: 'Custom MCP Service',
      endpointUrl: 'http://custom/mcp',
      timeoutMs: 5000,
      isEnabled: 1,
      status: 'active',
    });

    // 2. Duplicate slug rejection
    assert.throws(() => {
      repo.insertUpstream({
        slug: 'custom-mcp',
        displayName: 'Duplicate',
        endpointUrl: 'http://custom-2/mcp',
      });
    }, /UNIQUE constraint failed/);

    // 3. Timeout bounds: min 500ms
    assert.throws(() => {
      repo.insertUpstream({
        slug: 'invalid-timeout-low',
        displayName: 'Low Timeout',
        endpointUrl: 'http://test/mcp',
        timeoutMs: 499,
      });
    }, /CHECK constraint failed/);

    // 4. Timeout bounds: max 30000ms
    assert.throws(() => {
      repo.insertUpstream({
        slug: 'invalid-timeout-high',
        displayName: 'High Timeout',
        endpointUrl: 'http://test/mcp',
        timeoutMs: 30001,
      });
    }, /CHECK constraint failed/);

    // 5. Invalid status rejection
    assert.throws(() => {
      repo.insertUpstream({
        slug: 'invalid-status',
        displayName: 'Invalid Status',
        endpointUrl: 'http://test/mcp',
        status: 'connecting' as any, // runtime state, rejected by SQLite constraint
      });
    }, /CHECK constraint failed/);

    db.close();
  });
});
