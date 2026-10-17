import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.js';
import { DatabaseManager } from '../db/connection.js';
import { ApiKeyRepository } from '../db/api-key-repo.js';
import { ApiKeyService } from '../auth/api-key-service.js';

export interface BootstrapOptions {
  dbPath?: string;
  username?: string;
  name?: string;
  outputFile?: string;
  showKey?: boolean;
  forceStdout?: boolean;
  isCI?: boolean;
  isTTY?: boolean;
  silent?: boolean;
}

export interface BootstrapResult {
  alreadyProvisioned: boolean;
  username: string;
  rawKey?: string;
  keyDeliveredTo?: 'stdout' | 'file';
  outputFilePath?: string;
  userId?: string;
  keyId?: string;
}

/**
 * Idempotent bootstrap function to provision the initial gateway administrator.
 * 
 * Non-Negotiable Invariants:
 * 1. Checks if an administrator account already exists.
 * 2. If admin exists, halts immediately with alreadyProvisioned: true (Exit Code 0).
 * 3. Never rotates credentials or creates duplicate administrators on repeated runs.
 * 4. Generates a 32-byte cryptographically secure key and returns it exactly once.
 * 5. Executes user creation and key verifier insertion in a single atomic transaction.
 * 6. Protection against CI log capture and output redirection:
 *    - Never dumps raw secret to stdout in CI (process.env.CI) or non-interactive pipes (!isTTY) by default.
 *    - Supports secure file delivery via --output-file with mode 0600 (-rw-------).
 *    - Defaults to secure file provisioning if run non-interactively without explicit --force-stdout.
 */
export async function runBootstrap(options: BootstrapOptions = {}): Promise<BootstrapResult> {
  const config = loadConfig(process.env, false);
  const dbPath = options.dbPath ?? config.DB_PATH;
  const username = options.username ?? 'admin';
  const name = options.name ?? 'System Administrator';

  const isCI = options.isCI ?? Boolean(process.env.CI);
  const isTTY = options.isTTY ?? Boolean(process.stdout?.isTTY);
  const forceStdout = options.forceStdout ?? false;
  const showKey = options.showKey ?? false;

  const dbManager = new DatabaseManager({ dbPath, autoMigrate: true });
  dbManager.initialize();

  try {
    const repo = new ApiKeyRepository(dbManager.getDb());
    const apiKeyService = new ApiKeyService(repo);

    // Idempotency check: Does an administrator already exist?
    if (repo.hasAdminUser()) {
      if (!options.silent) {
        console.log('Administrator account already provisioned. Bootstrap safely aborted.');
      }
      return {
        alreadyProvisioned: true,
        username,
      };
    }

    // Atomically provision admin user and initial API key
    const result = dbManager.transaction(() => {
      const user = apiKeyService.createUser(username, 'admin');
      const { rawKey, apiKey } = apiKeyService.generateApiKey({
        userId: user.id,
        name,
      });

      return {
        userId: user.id,
        keyId: apiKey.id,
        rawKey,
      };
    });

    // Determine secure key delivery mechanism
    let keyDeliveredTo: 'stdout' | 'file' = 'file';
    let outputFilePath: string | undefined;

    if (options.outputFile) {
      // Explicit file output specified by operator
      outputFilePath = options.outputFile;
      const dir = path.dirname(outputFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      fs.writeFileSync(outputFilePath, `${result.rawKey}\n`, { mode: 0o600, encoding: 'utf8' });
      fs.chmodSync(outputFilePath, 0o600);
      keyDeliveredTo = 'file';

      if (!options.silent) {
        console.log('================================================================================');
        console.log('Urumi Gateway Administrator Bootstrap (Secure File Delivery)');
        console.log('================================================================================');
        console.log(`Admin username: ${username}`);
        console.log(`Key delivery:   Written securely to ${outputFilePath} (mode 0600).`);
        console.log('Notice:         Raw credential was not printed to console to prevent log exposure.');
        console.log('================================================================================');
      }
    } else if (forceStdout || (showKey && isTTY && !isCI)) {
      // Explicit opt-in for stdout delivery in interactive session or forced
      keyDeliveredTo = 'stdout';

      if (!options.silent) {
        console.log('================================================================================');
        console.log('Urumi Gateway Administrator Bootstrap (Terminal Output)');
        console.log('================================================================================');
        console.log(`Admin username: ${username}`);
        console.log(`API Key:        ${result.rawKey}`);
        console.log('');
        console.log('CRITICAL: Store this key securely now. It cannot be recovered.');
        console.log('================================================================================');
      }
    } else {
      // Non-interactive, redirected pipe, or CI environment without explicit file path:
      // Default to secure file delivery at <dbDir>/.admin-key with mode 0600
      const dbDir = dbPath !== ':memory:' ? path.dirname(dbPath) : os.tmpdir();
      outputFilePath = path.join(dbDir, '.admin-key');
      fs.writeFileSync(outputFilePath, `${result.rawKey}\n`, { mode: 0o600, encoding: 'utf8' });
      fs.chmodSync(outputFilePath, 0o600);
      keyDeliveredTo = 'file';

      if (!options.silent) {
        console.log('================================================================================');
        console.log('Urumi Gateway Administrator Bootstrap (CI / Non-Interactive Safe Mode)');
        console.log('================================================================================');
        console.log(`Admin username: ${username}`);
        console.log(`Key delivery:   Written securely to ${outputFilePath} (mode 0600).`);
        console.log('Notice:         Raw credential was withheld from stdout to protect against CI log');
        console.log('                capture and pipe redirection. Use --output-file <path> to specify');
        console.log('                a custom destination, or --show-key in an interactive TTY.');
        console.log('================================================================================');
      }
    }

    return {
      alreadyProvisioned: false,
      username,
      rawKey: result.rawKey,
      keyDeliveredTo,
      outputFilePath,
      userId: result.userId,
      keyId: result.keyId,
    };
  } finally {
    dbManager.close();
  }
}

// Execute directly if run via CLI
if (process.argv[1] && (process.argv[1].endsWith('bootstrap.ts') || process.argv[1].endsWith('bootstrap.js'))) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      username: { type: 'string', default: 'admin' },
      name: { type: 'string', default: 'System Administrator' },
      db: { type: 'string' },
      'output-file': { type: 'string' },
      'show-key': { type: 'boolean', default: false },
      'force-stdout': { type: 'boolean', default: false },
    },
    strict: false,
  });

  runBootstrap({
    username: values.username as string | undefined,
    name: values.name as string | undefined,
    dbPath: values.db as string | undefined,
    outputFile: values['output-file'] as string | undefined,
    showKey: values['show-key'] as boolean | undefined,
    forceStdout: values['force-stdout'] as boolean | undefined,
  })
    .then(() => {
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error(`[FATAL] Bootstrap failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
