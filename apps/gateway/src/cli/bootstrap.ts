import { parseArgs } from 'node:util';
import { loadConfig } from '../config.js';
import { DatabaseManager } from '../db/connection.js';
import { ApiKeyRepository } from '../db/api-key-repo.js';
import { ApiKeyService } from '../auth/api-key-service.js';

export interface BootstrapOptions {
  dbPath?: string;
  username?: string;
  name?: string;
  silent?: boolean;
}

export interface BootstrapResult {
  alreadyProvisioned: boolean;
  username: string;
  rawKey?: string;
  userId?: string;
  keyId?: string;
}

/**
 * Idempotent bootstrap function to provision the initial gateway administrator.
 * 
 * Invariants:
 * 1. Checks if an administrator account already exists.
 * 2. If admin exists, halts immediately with alreadyProvisioned: true (Exit Code 0).
 * 3. Never rotates credentials or creates duplicate administrators on repeated runs.
 * 4. Generates a 32-byte cryptographically secure key and returns it exactly once.
 * 5. Executes user creation and key verifier insertion in a single atomic transaction.
 */
export async function runBootstrap(options: BootstrapOptions = {}): Promise<BootstrapResult> {
  const config = loadConfig(process.env, false);
  const dbPath = options.dbPath ?? config.DB_PATH;
  const username = options.username ?? 'admin';
  const name = options.name ?? 'System Administrator';

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

    if (!options.silent) {
      console.log('================================================================================');
      console.log('Urumi Gateway Administrator Bootstrap');
      console.log('================================================================================');
      console.log(`Admin username: ${username}`);
      console.log(`API Key:        ${result.rawKey}`);
      console.log('');
      console.log('CRITICAL: Store this key securely now. It cannot be recovered.');
      console.log('================================================================================');
    }

    return {
      alreadyProvisioned: false,
      username,
      rawKey: result.rawKey,
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
    },
    strict: false,
  });

  runBootstrap({
    username: values.username as string | undefined,
    name: values.name as string | undefined,
    dbPath: values.db as string | undefined,
  })
    .then((res) => {
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error(`[FATAL] Bootstrap failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
