import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runBootstrap } from '../../src/cli/bootstrap.js';
import { DatabaseManager } from '../../src/db/connection.js';
import { ApiKeyRepository } from '../../src/db/api-key-repo.js';
import { ApiKeyService, API_KEY_PREFIX } from '../../src/auth/api-key-service.js';

describe('Gateway Administrator Bootstrap Unit Tests', () => {
  it('provisions initial administrator on first run and returns one-time raw key', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-bootstrap-'));
    const dbPath = path.join(tmpDir, 'gateway.db');

    try {
      const result = await runBootstrap({
        dbPath,
        username: 'admin',
        name: 'System Administrator',
        silent: true,
      });

      assert.equal(result.alreadyProvisioned, false);
      assert.equal(result.username, 'admin');
      assert.notEqual(result.rawKey, undefined);
      assert.equal(result.rawKey?.startsWith(API_KEY_PREFIX), true);

      // Verify user and key in DB
      const dbManager = new DatabaseManager({ dbPath, autoMigrate: false });
      dbManager.initialize();
      const repo = new ApiKeyRepository(dbManager.getDb());

      const user = repo.findUserByUsername('admin');
      assert.notEqual(user, null);
      assert.equal(user?.role, 'admin');

      const apiKeyService = new ApiKeyService(repo);
      const authUser = await apiKeyService.verifyKey(result.rawKey!);
      assert.notEqual(authUser, null);
      assert.equal(authUser?.username, 'admin');
      assert.equal(authUser?.role, 'admin');

      dbManager.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('is strictly idempotent on repeat execution, does not rotate key or create duplicate admin', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-bootstrap-repeat-'));
    const dbPath = path.join(tmpDir, 'gateway.db');

    try {
      // First bootstrap
      const result1 = await runBootstrap({
        dbPath,
        username: 'admin',
        silent: true,
      });
      assert.equal(result1.alreadyProvisioned, false);
      const originalKey = result1.rawKey;

      // Second bootstrap
      const result2 = await runBootstrap({
        dbPath,
        username: 'admin',
        silent: true,
      });
      assert.equal(result2.alreadyProvisioned, true);
      assert.equal(result2.rawKey, undefined);

      // Verify exactly one admin exists and original key still works
      const dbManager = new DatabaseManager({ dbPath, autoMigrate: false });
      dbManager.initialize();
      const db = dbManager.getDb();

      const adminCountRow = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin';").get() as { count: number };
      assert.equal(adminCountRow.count, 1);

      const repo = new ApiKeyRepository(db);
      const apiKeyService = new ApiKeyService(repo);
      const authUser = await apiKeyService.verifyKey(originalKey!);
      assert.notEqual(authUser, null);
      assert.equal(authUser?.username, 'admin');

      dbManager.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
