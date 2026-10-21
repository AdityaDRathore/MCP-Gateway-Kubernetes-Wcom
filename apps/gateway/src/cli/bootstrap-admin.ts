import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.js';
import { DatabaseManager } from '../db/connection.js';
import { UserRepository } from '../db/user-repo.js';
import { SessionRepository } from '../db/session-repo.js';
import { SessionService } from '../auth/session-service.js';
import { ScryptPasswordService } from '../auth/scrypt-password-service.js';
import { InvitationRepository } from '../db/invitation-repo.js';
import { InvitationService } from '../auth/invitation-service.js';

export interface BootstrapAdminOptions {
  dbPath?: string;
  outputFile?: string;
  showKey?: boolean;
  forceStdout?: boolean;
  isCI?: boolean;
  isTTY?: boolean;
  silent?: boolean;
}

export interface BootstrapAdminResult {
  alreadyInitialized: boolean;
  invitationId?: string;
  rawToken?: string;
  inviteUrl?: string;
  tokenDeliveredTo?: 'stdout' | 'file';
  outputFilePath?: string;
  expiresAt?: number;
}

/**
 * Idempotent first-admin bootstrap command.
 * Generates a one-time enrollment token with role 'admin' and 72h expiry
 * if and only if zero active administrators exist in the database.
 * 
 * Non-Negotiable Invariants:
 * 1. Checks if an active administrator exists (countActiveAdmins > 0).
 * 2. If an admin exists, halts immediately with alreadyInitialized: true (Exit Code 0).
 * 3. Never resets existing administrator accounts, passwords, or keys.
 * 4. Generates a 32-byte cryptographically secure invitation token and stores only the SHA-256 verifier in SQLite.
 * 5. Protection against CI log capture and output redirection:
 *    - Never prints raw token to stdout in CI (process.env.CI) or non-interactive pipes (!isTTY) by default.
 *    - Supports secure file delivery via --output-file with mode 0600 (-rw-------).
 *    - Defaults to secure file provisioning if run non-interactively without explicit --force-stdout.
 */
export async function runBootstrapAdmin(
  options: BootstrapAdminOptions = {}
): Promise<BootstrapAdminResult> {
  const config = loadConfig(process.env, false);
  const dbPath = options.dbPath ?? config.DB_PATH;

  const isCI = options.isCI ?? Boolean(process.env.CI);
  const isTTY = options.isTTY ?? Boolean(process.stdout?.isTTY);
  const forceStdout = options.forceStdout ?? false;
  const showKey = options.showKey ?? false;

  const dbManager = new DatabaseManager({ dbPath, autoMigrate: true });
  dbManager.initialize();

  try {
    const userRepo = new UserRepository(dbManager.getDb());
    const sessionRepo = new SessionRepository(dbManager.getDb());
    const passwordService = new ScryptPasswordService();
    const sessionService = new SessionService(sessionRepo, userRepo);
    const invitationRepo = new InvitationRepository(dbManager.getDb());
    const invitationService = new InvitationService(
      invitationRepo,
      userRepo,
      sessionService,
      passwordService,
      dbManager
    );

    // 1. Idempotency Check: Does an active administrator already exist?
    const activeAdmins = userRepo.countActiveAdmins();
    if (activeAdmins > 0) {
      if (!options.silent) {
        console.log('Administrator account already provisioned. Bootstrap safely aborted.');
      }
      return {
        alreadyInitialized: true,
      };
    }

    // 2. Generate initial admin invitation
    const invitation = invitationService.createInvitation({
      role: 'admin',
      invitedBy: null,
    });

    // 3. Determine secure delivery mechanism
    let tokenDeliveredTo: 'stdout' | 'file' = 'file';
    let outputFilePath: string | undefined;

    if (options.outputFile) {
      // Explicit file output specified by operator
      outputFilePath = options.outputFile;
      const dir = path.dirname(outputFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      fs.writeFileSync(
        outputFilePath,
        `TOKEN=${invitation.rawToken}\nINVITE_URL=${invitation.inviteUrl}\nEXPIRES_AT=${invitation.expiresAt}\n`,
        { mode: 0o600, encoding: 'utf8' }
      );
      fs.chmodSync(outputFilePath, 0o600);
      tokenDeliveredTo = 'file';

      if (!options.silent) {
        console.log('================================================================================');
        console.log('Urumi Gateway Administrator Enrollment (Secure File Delivery)');
        console.log('================================================================================');
        console.log(`Role:           admin`);
        console.log(`Token delivery: Written securely to ${outputFilePath} (mode 0600).`);
        console.log('Notice:         Raw enrollment token was not printed to console to prevent log exposure.');
        console.log('================================================================================');
      }
    } else if (forceStdout || (showKey && isTTY && !isCI)) {
      // Explicit opt-in for stdout delivery in interactive session or forced
      tokenDeliveredTo = 'stdout';

      if (!options.silent) {
        console.log('================================================================================');
        console.log('Urumi Gateway Administrator Enrollment (Terminal Output)');
        console.log('================================================================================');
        console.log(`Role:           admin`);
        console.log(`Invite URL:     ${invitation.inviteUrl}`);
        console.log(`Token:          ${invitation.rawToken}`);
        console.log(`Expires in:     72 hours`);
        console.log('');
        console.log('Visit the Invite URL in your browser to complete administrator enrollment.');
        console.log('CRITICAL: This token is single-use and cannot be retrieved again once redeemed.');
        console.log('================================================================================');
      }
    } else {
      // Non-interactive, redirected pipe, or CI environment without explicit file path:
      // Default to secure file delivery at <dbDir>/.admin-enrollment with mode 0600
      const dbDir = dbPath !== ':memory:' ? path.dirname(dbPath) : os.tmpdir();
      outputFilePath = path.join(dbDir, '.admin-enrollment');
      fs.writeFileSync(
        outputFilePath,
        `TOKEN=${invitation.rawToken}\nINVITE_URL=${invitation.inviteUrl}\nEXPIRES_AT=${invitation.expiresAt}\n`,
        { mode: 0o600, encoding: 'utf8' }
      );
      fs.chmodSync(outputFilePath, 0o600);
      tokenDeliveredTo = 'file';

      if (!options.silent) {
        console.log('================================================================================');
        console.log('Urumi Gateway Administrator Enrollment (CI / Non-Interactive Safe Mode)');
        console.log('================================================================================');
        console.log(`Role:           admin`);
        console.log(`Token delivery: Written securely to ${outputFilePath} (mode 0600).`);
        console.log('Notice:         Raw enrollment token was withheld from stdout to protect against CI log');
        console.log('                capture and pipe redirection. Use --output-file <path> to specify');
        console.log('                a custom destination, or --show-key in an interactive TTY.');
        console.log('================================================================================');
      }
    }

    return {
      alreadyInitialized: false,
      invitationId: invitation.id,
      rawToken: invitation.rawToken,
      inviteUrl: invitation.inviteUrl,
      tokenDeliveredTo,
      outputFilePath,
      expiresAt: invitation.expiresAt,
    };
  } finally {
    dbManager.close();
  }
}

// Execute directly if run via CLI
if (
  process.argv[1] &&
  (process.argv[1].endsWith('bootstrap-admin.ts') || process.argv[1].endsWith('bootstrap-admin.js'))
) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      db: { type: 'string' },
      'output-file': { type: 'string' },
      'show-key': { type: 'boolean', default: false },
      'force-stdout': { type: 'boolean', default: false },
    },
    strict: false,
  });

  runBootstrapAdmin({
    dbPath: values.db as string | undefined,
    outputFile: values['output-file'] as string | undefined,
    showKey: values['show-key'] as boolean | undefined,
    forceStdout: values['force-stdout'] as boolean | undefined,
  })
    .then(() => {
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error(`[FATAL] Bootstrap admin failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
