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
  it('provisions initial administrator with explicit --output-file and enforces mode 0600', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-bootstrap-file-'));
    const dbPath = path.join(tmpDir, 'gateway.db');
    const keyFile = path.join(tmpDir, 'admin-secret.key');

    try {
      const result = await runBootstrap({
        dbPath,
        username: 'admin',
        name: 'System Administrator',
        outputFile: keyFile,
        silent: true,
      });

      assert.equal(result.alreadyProvisioned, false);
      assert.equal(result.username, 'admin');
      assert.equal(result.keyDeliveredTo, 'file');
      assert.equal(result.outputFilePath, keyFile);

      // Verify file exists, contains the raw key, and has mode 0600
      assert.equal(fs.existsSync(keyFile), true);
      const fileStat = fs.statSync(keyFile);
      const modeOctal = (fileStat.mode & 0o777).toString(8);
      assert.equal(modeOctal, '600');

      const fileContent = fs.readFileSync(keyFile, 'utf8').trim();
      assert.equal(fileContent.startsWith(API_KEY_PREFIX), true);
      assert.equal(fileContent, result.rawKey);

      // Verify user and key in DB
      const dbManager = new DatabaseManager({ dbPath, autoMigrate: false });
      dbManager.initialize();
      const repo = new ApiKeyRepository(dbManager.getDb());

      const user = repo.findUserByUsername('admin');
      assert.notEqual(user, null);
      assert.equal(user?.role, 'admin');

      const apiKeyService = new ApiKeyService(repo);
      const authUser = await apiKeyService.verifyKey(fileContent);
      assert.notEqual(authUser, null);
      assert.equal(authUser?.username, 'admin');

      dbManager.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('safely provisions to fallback .admin-key in CI/non-interactive mode without dumping key to stdout', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-bootstrap-ci-'));
    const dbPath = path.join(tmpDir, 'gateway.db');

    try {
      // Simulate CI / non-interactive environment (isCI: true, isTTY: false)
      const result = await runBootstrap({
        dbPath,
        username: 'admin',
        isCI: true,
        isTTY: false,
        showKey: false,
        silent: true,
      });

      assert.equal(result.alreadyProvisioned, false);
      assert.equal(result.keyDeliveredTo, 'file');

      const expectedFallbackFile = path.join(tmpDir, '.admin-key');
      assert.equal(result.outputFilePath, expectedFallbackFile);
      assert.equal(fs.existsSync(expectedFallbackFile), true);

      // Verify mode 0600
      const stat = fs.statSync(expectedFallbackFile);
      assert.equal((stat.mode & 0o777).toString(8), '600');

      const savedKey = fs.readFileSync(expectedFallbackFile, 'utf8').trim();
      assert.equal(savedKey, result.rawKey);

      dbManagerClose(dbPath);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('delivers to stdout when showKey or forceStdout is explicitly enabled', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-bootstrap-stdout-'));
    const dbPath = path.join(tmpDir, 'gateway.db');

    try {
      const result = await runBootstrap({
        dbPath,
        username: 'admin',
        forceStdout: true,
        silent: true,
      });

      assert.equal(result.alreadyProvisioned, false);
      assert.equal(result.keyDeliveredTo, 'stdout');
      assert.notEqual(result.rawKey, undefined);

      dbManagerClose(dbPath);
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
        forceStdout: true,
        silent: true,
      });
      assert.equal(result1.alreadyProvisioned, false);
      const originalKey = result1.rawKey;

      // Second bootstrap
      const result2 = await runBootstrap({
        dbPath,
        username: 'admin',
        forceStdout: true,
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

  function dbManagerClose(dbPath: string) {
    const mgr = new DatabaseManager({ dbPath, autoMigrate: false });
    mgr.initialize();
    mgr.close();
  }
});
