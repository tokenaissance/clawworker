#!/usr/bin/env npx tsx
/**
 * Interactive multi-tenant deployment script with OpenRouter provisioning
 *
 * Usage:
 *   npm run deploy:interactive -- --email=user@example.com --name="User Name"
 *   npm run deploy:interactive -- --email=user@example.com --name="User Name" --instance-type=standard-4
 *   npm run deploy:interactive -- --email=user@example.com --name="User Name" --dry-run
 *   npm run deploy:interactive -- --email=user@example.com --name="User Name" --force-build
 *
 * Environment variables:
 *   OPENROUTER_PROVISIONING_KEY - Required: Your OpenRouter provisioning API key
 *
 * This script:
 * 1. Derives tenant name from email
 * 2. Provisions OpenRouter API key for the user
 * 3. Deploys the tenant Worker (with smart Docker image reuse)
 * 4. Interactively prompts for and sets all secrets
 */

import { execSync, spawn, spawnSync, ExecSyncOptions, SpawnSyncOptions, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { OpenRouter } from '@openrouter/sdk';
import { configureDomain } from './configure-domain';

// Track child processes for cleanup on exit
const childProcesses: ChildProcess[] = [];

// Cleanup function to kill all child processes
function cleanup() {
  console.log('\n[Cleanup] Terminating child processes...');
  for (const child of childProcesses) {
    if (child.pid && !child.killed) {
      try {
        // Kill the process group to ensure all descendants are killed
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // Process may already be dead
        try {
          child.kill('SIGTERM');
        } catch {
          // Ignore
        }
      }
    }
  }
  childProcesses.length = 0;
}

// Handle Ctrl+C and other termination signals
process.on('SIGINT', () => {
  console.log('\n[Signal] Received SIGINT (Ctrl+C)');
  cleanup();
  process.exit(130);
});

process.on('SIGTERM', () => {
  console.log('\n[Signal] Received SIGTERM');
  cleanup();
  process.exit(143);
});

process.on('exit', () => {
  cleanup();
});

/**
 * Execute a command and print it before running
 */
function runCommand(command: string, options?: ExecSyncOptions): string {
  console.log(`[CMD] ${command}`);
  return execSync(command, options) as string;
}

/**
 * Execute a command with stdio inherit, tracking the child process for cleanup
 */
function runCommandInherit(command: string): Promise<void> {
  console.log(`[CMD] ${command}`);
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', command], {
      stdio: 'inherit',
      detached: true, // Create new process group so we can kill all descendants
    });
    childProcesses.push(child);

    child.on('close', (code) => {
      const index = childProcesses.indexOf(child);
      if (index > -1) childProcesses.splice(index, 1);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });

    child.on('error', (err) => {
      const index = childProcesses.indexOf(child);
      if (index > -1) childProcesses.splice(index, 1);
      reject(err);
    });
  });
}

/**
 * Execute a command silently (for checks that may fail)
 */
function runCommandSilent(command: string, options?: ExecSyncOptions): string {
  return execSync(command, options) as string;
}

/**
 * Spawn a command and print it before running
 */
function runSpawn(command: string, args: string[], options?: SpawnSyncOptions) {
  console.log(`[CMD] ${command} ${args.join(' ')}`);
  return spawnSync(command, args, options);
}

interface DeployConfig {
  email: string;
  name: string;
  tenant: string;
  instanceType: string;
  maxInstances: number;
  limit: number;
  dryRun: boolean;
  skipProvision: boolean;
  forceBuild: boolean;
}

// Files that are copied into the Docker image
// If any of these have uncommitted changes, we need to rebuild
const DOCKER_CONTEXT_FILES = [
  'Dockerfile',
  'start-moltbot.sh',
  'moltbot.json.template',
  'skills/',
];

/**
 * Check if Docker context files have uncommitted changes (staged or unstaged)
 * Returns list of changed files, or empty array if no changes
 */
function getDockerContextChanges(): string[] {
  const changedFiles: string[] = [];

  for (const file of DOCKER_CONTEXT_FILES) {
    try {
      // Check for both staged and unstaged changes
      const unstaged = runCommandSilent(`git diff --name-only -- "${file}" 2>/dev/null`, { encoding: 'utf-8' }).trim();
      const staged = runCommandSilent(`git diff --cached --name-only -- "${file}" 2>/dev/null`, { encoding: 'utf-8' }).trim();

      if (unstaged) {
        changedFiles.push(...unstaged.split('\n').filter(Boolean));
      }
      if (staged) {
        changedFiles.push(...staged.split('\n').filter(Boolean));
      }
    } catch {
      // git command failed, assume no changes
    }
  }

  // Remove duplicates
  return [...new Set(changedFiles)];
}

/**
 * Get Cloudflare account ID from wrangler
 */
function getCloudflareAccountId(): string | null {
  try {
    const output = runCommandSilent('npx wrangler whoami 2>/dev/null', { encoding: 'utf-8' });
    // Extract 32-character hex account ID
    const match = output.match(/([a-f0-9]{32})/);
    if (match && match[1]) {
      return match[1];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Derive a valid DNS subdomain from user name
 * - Converts to lowercase
 * - Removes non-alphanumeric characters (no hyphens)
 * - Limits to 63 characters (DNS label maximum)
 *
 * Examples:
 *   "Alice Smith" → "alicesmith"
 *   "Bob O'Connor" → "boboconnor"
 *   "John123" → "john123"
 */
function deriveSubdomain(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')  // Remove all non-alphanumeric characters
    .slice(0, 63);               // DNS label max length
}

/**
 * Get the latest container image tag for a tenant from the registry
 * Returns full registry URL: registry.cloudflare.com/{account-id}/{image}:{tag}
 */
function getLatestImageTag(tenant: string): string | null {
  try {
    // Get account ID first
    const accountId = getCloudflareAccountId();
    if (!accountId) {
      console.warn('[Docker] Could not determine Cloudflare account ID');
      return null;
    }

    // List images and find the latest one for this tenant
    const output = runCommand('npx wrangler containers images list 2>/dev/null', { encoding: 'utf-8' });
    const lines = output.split('\n');

    // Look for image matching this tenant pattern
    const tenantPatterns = [
      `paramita-cloud-${tenant}-sandbox-${tenant}`,
      `paramita-cloud-${tenant}-sandbox`,
    ];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        const repo = parts[0];
        const tag = parts[1];
        if (tenantPatterns.some(p => repo === p) && tag && tag !== 'TAG') {
          // Construct full registry URL
          const fullImageUrl = `registry.cloudflare.com/${accountId}/${repo}:${tag}`;
          console.log(`[Docker] Found existing image: ${fullImageUrl}`);
          return fullImageUrl;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Check if Docker context files have changed since last deployment
 */
function hasDockerContextChanged(tenant: string): { changed: boolean; files: string[]; reason: string } {
  // First check for uncommitted changes
  const uncommittedChanges = getDockerContextChanges();
  if (uncommittedChanges.length > 0) {
    return {
      changed: true,
      files: uncommittedChanges,
      reason: 'uncommitted changes',
    };
  }

  // Check if we have a record of the last deployed commit for this tenant
  const deploymentRecordPath = path.join(process.cwd(), `.deployment-${tenant}.json`);
  if (!fs.existsSync(deploymentRecordPath)) {
    return {
      changed: true,
      files: DOCKER_CONTEXT_FILES,
      reason: 'no previous deployment record',
    };
  }

  try {
    const record = JSON.parse(fs.readFileSync(deploymentRecordPath, 'utf-8'));
    const lastCommit = record.dockerContextCommit;

    if (!lastCommit) {
      return {
        changed: true,
        files: DOCKER_CONTEXT_FILES,
        reason: 'no commit hash in deployment record',
      };
    }

    // Check if any Docker context files changed since last deployment
    const changedFiles: string[] = [];
    for (const file of DOCKER_CONTEXT_FILES) {
      try {
        const diff = runCommandSilent(`git diff --name-only ${lastCommit} HEAD -- "${file}" 2>/dev/null`, { encoding: 'utf-8' }).trim();
        if (diff) {
          changedFiles.push(...diff.split('\n').filter(Boolean));
        }
      } catch {
        // If git diff fails, assume changed
        changedFiles.push(file);
      }
    }

    if (changedFiles.length > 0) {
      return {
        changed: true,
        files: [...new Set(changedFiles)],
        reason: `changed since commit ${lastCommit.slice(0, 7)}`,
      };
    }

    return { changed: false, files: [], reason: 'no changes detected' };
  } catch {
    return {
      changed: true,
      files: DOCKER_CONTEXT_FILES,
      reason: 'failed to read deployment record',
    };
  }
}

/**
 * Save deployment record with current git commit and image tag
 */
function saveDeploymentRecord(tenant: string, imageTag?: string): void {
  try {
    const currentCommit = runCommandSilent('git rev-parse HEAD 2>/dev/null', { encoding: 'utf-8' }).trim();
    const deploymentRecordPath = path.join(process.cwd(), `.deployment-${tenant}.json`);

    const record = {
      tenant,
      dockerContextCommit: currentCommit,
      imageTag: imageTag || null,
      deployedAt: new Date().toISOString(),
    };

    fs.writeFileSync(deploymentRecordPath, JSON.stringify(record, null, 2));
    console.log(`[Record] Saved deployment record: ${deploymentRecordPath}`);
  } catch (error) {
    console.warn(`[Record] Failed to save deployment record: ${error}`);
  }
}

interface Secrets {
  AI_GATEWAY_API_KEY: string;
  AI_GATEWAY_BASE_URL: string;
  CLAWDBOT_GATEWAY_TOKEN: string;
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  CF_ACCOUNT_ID: string;
  SANDBOX_SLEEP_AFTER: string;
}

// Create readline interface for interactive input
function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

// Prompt for input with optional default value
async function prompt(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
  const displayQuestion = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
  return new Promise((resolve) => {
    rl.question(displayQuestion, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

// Prompt for password (hidden input)
async function promptPassword(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
  return new Promise((resolve) => {
    const displayQuestion = defaultValue ? `${question} [***hidden***]` : question;
    process.stdout.write(`${displayQuestion}: `);

    // Disable echo
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    let password = '';
    const onData = (char: Buffer) => {
      const c = char.toString();
      if (c === '\n' || c === '\r') {
        process.stdin.removeListener('data', onData);
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.stdout.write('\n');
        resolve(password || defaultValue || '');
      } else if (c === '\u0003') {
        // Ctrl+C
        process.exit(1);
      } else if (c === '\u007F' || c === '\b') {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        password += c;
        process.stdout.write('*');
      }
    };

    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

// Prompt for optional input
async function promptOptional(rl: readline.Interface, question: string, defaultValue: string = ''): Promise<string> {
  const displayQuestion = defaultValue ? `${question} [${defaultValue}]: ` : `${question} (optional, press Enter to skip): `;
  return new Promise((resolve) => {
    rl.question(displayQuestion, (answer) => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

// Prompt for yes/no confirmation
async function promptConfirm(rl: readline.Interface, question: string, defaultYes: boolean = false): Promise<boolean> {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  return new Promise((resolve) => {
    rl.question(`${question} ${hint}: `, (answer) => {
      const normalized = answer.trim().toLowerCase();
      if (normalized === '') {
        resolve(defaultYes);
      } else {
        resolve(normalized === 'y' || normalized === 'yes');
      }
    });
  });
}

/**
 * Check if a Worker already exists
 */
function workerExists(workerName: string): boolean {
  try {
    const output = runCommand(`npx wrangler deployments list --name ${workerName} 2>/dev/null`, { encoding: 'utf-8' });
    return output.includes('Deployment ID');
  } catch {
    return false;
  }
}

/**
 * Get existing secrets for a Worker
 */
function getExistingSecrets(workerName: string): string[] {
  try {
    const output = runCommandSilent(`npx wrangler secret list --name ${workerName} 2>/dev/null`, { encoding: 'utf-8' });

    // Try to parse as JSON first (new wrangler format)
    try {
      const jsonOutput = JSON.parse(output);
      if (Array.isArray(jsonOutput)) {
        return jsonOutput.map((item: { name: string }) => item.name);
      }
    } catch {
      // Not JSON, try parsing as text
    }

    // Fallback to text parsing for older wrangler versions
    const secrets: string[] = [];
    const lines = output.split('\n');
    for (const line of lines) {
      const match = line.match(/Secret Name:\s*(\S+)/i);
      if (match) {
        secrets.push(match[1]);
      }
      // Also handle table format: "| SECRET_NAME |"
      const tableMatch = line.match(/^\s*\|\s*(\w+)\s*\|/);
      if (tableMatch && tableMatch[1] !== 'Name') {
        secrets.push(tableMatch[1]);
      }
    }
    return secrets;
  } catch {
    return [];
  }
}

function parseArgs(): DeployConfig {
  const args = process.argv.slice(2);
  const config: DeployConfig = {
    email: '',
    name: '',
    tenant: '', // Will be set from user.id in database
    instanceType: 'standard-1',
    maxInstances: 1,
    limit: 500, // Default $5 credit limit
    dryRun: false,
    skipProvision: false,
    forceBuild: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--email=')) {
      config.email = arg.split('=')[1];
    } else if (arg.startsWith('--name=')) {
      config.name = arg.split('=')[1];
    } else if (arg.startsWith('--instance-type=')) {
      config.instanceType = arg.split('=')[1];
    } else if (arg.startsWith('--max-instances=')) {
      config.maxInstances = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--limit=')) {
      config.limit = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--dry-run') {
      config.dryRun = true;
    } else if (arg === '--skip-provision') {
      config.skipProvision = true;
    } else if (arg === '--force-build') {
      config.forceBuild = true;
    }
  }

  return config;
}

function validateConfig(config: DeployConfig): void {
  if (!config.email) {
    console.error('Error: --email is required');
    console.error('Usage: npm run deploy:interactive -- --email=user@example.com --name="User Name"');
    process.exit(1);
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(config.email)) {
    console.error('Error: Invalid email format');
    process.exit(1);
  }

  if (!config.name) {
    console.error('Error: --name is required');
    console.error('Usage: npm run deploy:interactive -- --email=user@example.com --name="User Name"');
    process.exit(1);
  }
}

// Database functions (from provision-user.ts)
function initDatabase(dbPath: string): DatabaseType {
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      emailVerified INTEGER DEFAULT 0,
      image TEXT,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now')),
      utmSource TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      locale TEXT DEFAULT '',
      gatewayToken TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_provider_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'openrouter',
      baseUrl TEXT NOT NULL,
      keyHash TEXT NOT NULL,
      keyPrefix TEXT,
      apiKey TEXT,
      name TEXT,
      limitAmount INTEGER,
      limitReset TEXT,
      disabled INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (userId) REFERENCES users(id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ai_provider_keys_userId ON ai_provider_keys(userId)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ai_provider_keys_provider ON ai_provider_keys(provider)
  `);

  // Create user_deployment_configs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_deployment_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL UNIQUE,
      cfAccessTeamDomain TEXT,
      cfAccessAud TEXT,
      r2AccessKeyId TEXT,
      r2SecretAccessKey TEXT,
      cfAccountId TEXT,
      sandboxSleepAfter TEXT DEFAULT 'never',
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (userId) REFERENCES users(id)
    )
  `);

  return db;
}

interface User {
  id: string;
  name: string;
  email: string;
  gatewayToken?: string;
}

function getOrCreateUser(db: DatabaseType, email: string, name: string): { user: User; isNew: boolean } {
  const existingUser = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as User | undefined;

  if (existingUser) {
    console.log(`[User] Found existing user: ${existingUser.id}`);
    return { user: existingUser, isNew: false };
  }

  const userId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO users (id, name, email, emailVerified, createdAt, updatedAt)
    VALUES (?, ?, ?, 0, ?, ?)
  `).run(userId, name, email, now, now);

  const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User;
  console.log(`[User] Created new user: ${userId}`);

  return { user: newUser, isNew: true };
}

/**
 * Get or generate gateway token for a user
 * Returns existing token if available, otherwise generates and saves a new one
 */
function getOrCreateGatewayToken(db: DatabaseType, userId: string): string {
  // Check if user already has a gateway token
  const user = db.prepare('SELECT gatewayToken FROM users WHERE id = ?').get(userId) as { gatewayToken?: string } | undefined;

  if (user?.gatewayToken) {
    console.log(`[Gateway] Using existing gateway token for user ${userId}`);
    return user.gatewayToken;
  }

  // Generate new token
  const newToken = crypto.randomBytes(32).toString('hex');

  // Save to database
  db.prepare('UPDATE users SET gatewayToken = ? WHERE id = ?').run(newToken, userId);

  console.log(`[Gateway] Generated new gateway token for user ${userId}`);
  return newToken;
}

async function getOrCreateOpenRouterKey(
  openRouter: OpenRouter,
  db: DatabaseType,
  userId: string,
  email: string,
  limit: number
): Promise<{ key: string | null; hash: string; isNew: boolean }> {
  // First check if user already has a key in local database
  const existingLocalKey = db.prepare(
    'SELECT keyHash, keyPrefix, apiKey, provider, baseUrl FROM ai_provider_keys WHERE userId = ? AND provider = ? AND disabled = 0 ORDER BY createdAt DESC LIMIT 1'
  ).get(userId, 'openrouter') as { keyHash: string; keyPrefix: string; apiKey?: string; provider: string; baseUrl: string } | undefined;

  if (existingLocalKey) {
    // Verify the key still exists on OpenRouter
    try {
      const remoteKey = await openRouter.apiKeys.get({ hash: existingLocalKey.keyHash });
      if (remoteKey && !remoteKey.data.disabled) {
        console.log(`[OpenRouter] Found existing API key: ${existingLocalKey.keyPrefix}`);
        if (existingLocalKey.apiKey) {
          console.log(`[OpenRouter] Retrieved full API key from database`);
          return { key: existingLocalKey.apiKey, hash: existingLocalKey.keyHash, isNew: false };
        } else {
          console.log(`[OpenRouter] Warning: Full API key not found in database`);
          return { key: null, hash: existingLocalKey.keyHash, isNew: false };
        }
      }
    } catch (error: unknown) {
      // Check if it's an auth error - should not fallback to create
      if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 401) {
        throw new Error('OpenRouter API authentication failed. Check OPENROUTER_PROVISIONING_KEY.');
      }
      // Key doesn't exist on OpenRouter anymore, mark as disabled locally
      console.log(`[OpenRouter] Local key ${existingLocalKey.keyPrefix} no longer exists on OpenRouter`);
      db.prepare('UPDATE ai_provider_keys SET disabled = 1 WHERE keyHash = ?').run(existingLocalKey.keyHash);
    }
  }

  // Also check OpenRouter directly by listing keys and matching by name (email)
  console.log(`[OpenRouter] Checking for existing key with name: ${email}`);
  const allKeys = await openRouter.apiKeys.list();
  const existingRemoteKey = allKeys.data.find((k: { name?: string; disabled?: boolean }) => k.name === email && !k.disabled);

  if (existingRemoteKey) {
    console.log(`[OpenRouter] Found existing API key on OpenRouter: ${email}`);
    console.log(`[OpenRouter] Warning: Cannot retrieve full key from OpenRouter API`);

    // Save to local database if not already there (without full key)
    const localExists = db.prepare('SELECT 1 FROM ai_provider_keys WHERE keyHash = ?').get(existingRemoteKey.hash);
    if (!localExists) {
      db.prepare(`
        INSERT INTO ai_provider_keys (userId, provider, baseUrl, keyHash, keyPrefix, name, limitAmount, limitReset, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        userId,
        'openrouter',
        'https://openrouter.ai/api/v1',
        existingRemoteKey.hash,
        'sk-or-v1-...',
        email,
        existingRemoteKey.limit || limit,
        existingRemoteKey.limitReset || 'monthly'
      );
    }

    return { key: null, hash: existingRemoteKey.hash, isNew: false };
  }

  // No existing key found, create a new one
  console.log(`[OpenRouter] Creating new API key for: ${email}`);

  const response = await openRouter.apiKeys.create({
    requestBody: {
      name: email,
      limit: limit,
      limitReset: 'monthly',
    },
  });

  const keyPrefix = response.key.slice(0, 12) + '...';
  db.prepare(`
    INSERT INTO ai_provider_keys (userId, provider, baseUrl, keyHash, keyPrefix, apiKey, name, limitAmount, limitReset, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    userId,
    'openrouter',
    'https://openrouter.ai/api/v1',
    response.data.hash,
    keyPrefix,
    response.key,
    email,
    limit,
    'monthly'
  );

  console.log(`[OpenRouter] API key created and saved: ${keyPrefix}`);

  return { key: response.key, hash: response.data.hash, isNew: true };
}

// Wrangler config generation (from deploy-tenant.ts)
function generateWranglerConfig(tenant: string, instanceType: string, maxInstances: number, imageSource: string): object {
  return {
    "$schema": "node_modules/wrangler/config-schema.json",
    "name": `paramita-cloud-${tenant}`,
    "main": "src/index.ts",
    "compatibility_date": "2025-05-06",
    "compatibility_flags": ["nodejs_compat"],
    "observability": { "enabled": true },
    "assets": {
      "directory": "./dist/client",
      "not_found_handling": "single-page-application",
      "html_handling": "auto-trailing-slash",
      "binding": "ASSETS",
      "run_worker_first": true,
    },
    "rules": [
      { "type": "Text", "globs": ["**/*.html"], "fallthrough": false },
      { "type": "Data", "globs": ["**/*.png"], "fallthrough": false },
    ],
    "build": { "command": "npm run build" },
    "containers": [
      {
        "class_name": "Sandbox",
        "image": imageSource,
        "instance_type": instanceType,
        "max_instances": maxInstances,
      },
    ],
    "durable_objects": {
      "bindings": [{ "class_name": "Sandbox", "name": "Sandbox" }],
    },
    "migrations": [{ "new_sqlite_classes": ["Sandbox"], "tag": "v1" }],
    "triggers": { "crons": ["*/5 * * * *"] },
    "browser": { "binding": "BROWSER" },
    "vars": {
      "ENVIRONMENT": tenant,
    },
    "r2_buckets": [
      {
        "binding": "MOLTBOT_BUCKET",
        "bucket_name": `moltbot-data-${tenant}`,
      },
    ],
  };
}

function ensureR2Bucket(tenant: string, dryRun: boolean): void {
  const bucketName = `moltbot-data-${tenant}`;

  console.log(`\n[R2] Checking bucket: ${bucketName}`);

  if (dryRun) {
    console.log(`[R2] (dry-run) Would create bucket if not exists: ${bucketName}`);
    return;
  }

  // Check if bucket exists by listing and searching for the name
  try {
    const listOutput = runCommand('npx wrangler r2 bucket list --config /dev/null 2>/dev/null', { encoding: 'utf-8' });
    // Output format is "name:           bucket-name"
    if (listOutput.includes(`name:`) && listOutput.includes(bucketName)) {
      // Double check with regex to avoid partial matches
      const regex = new RegExp(`name:\\s+${bucketName}\\s*$`, 'm');
      if (regex.test(listOutput)) {
        console.log(`[R2] Bucket already exists: ${bucketName}`);
        return;
      }
    }
  } catch {
    // If list fails, try to create anyway
  }

  // Bucket doesn't exist, create it
  console.log(`[R2] Creating bucket: ${bucketName}`);
  try {
    runCommand(`npx wrangler r2 bucket create ${bucketName}`, { stdio: 'inherit' });
    console.log(`[R2] Bucket created: ${bucketName}`);
  } catch (error: unknown) {
    // Check if error is "bucket already exists"
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('already exists') || errorMessage.includes('10004')) {
      console.log(`[R2] Bucket already exists: ${bucketName}`);
    } else {
      console.error(`[R2] Failed to create bucket: ${error}`);
      process.exit(1);
    }
  }
}

async function deployWorker(configPath: string, dryRun: boolean): Promise<void> {
  console.log(`\n[Deploy] Using config: ${configPath}`);

  if (dryRun) {
    console.log('[Deploy] (dry-run) Would run: wrangler deploy --config', configPath);
    return;
  }

  try {
    await runCommandInherit(`npx wrangler deploy --config ${configPath}`);
    console.log('\n[Deploy] Success!');
  } catch (error) {
    console.error('[Deploy] Failed:', error);
    process.exit(1);
  }
}

function setSecret(workerName: string, secretName: string, secretValue: string, dryRun: boolean): void {
  if (dryRun) {
    const displayValue = secretValue.length > 20 ? secretValue.slice(0, 10) + '...' : secretValue;
    console.log(`[Secret] (dry-run) Would set ${secretName}=${displayValue} for ${workerName}`);
    return;
  }

  if (!secretValue) {
    console.log(`[Secret] Skipping ${secretName} (empty value)`);
    return;
  }

  try {
    // Use spawn to pipe the secret value
    const result = runSpawn('npx', ['wrangler', 'secret', 'put', secretName, '--name', workerName], {
      input: secretValue,
      encoding: 'utf-8',
      stdio: ['pipe', 'inherit', 'inherit'],
    });

    if (result.status !== 0) {
      throw new Error(`wrangler secret put failed with status ${result.status}`);
    }

    console.log(`[Secret] Set ${secretName}`);
  } catch (error) {
    console.error(`[Secret] Failed to set ${secretName}:`, error);
    // Don't exit, continue with other secrets
  }
}

async function main(): Promise<void> {
  const config = parseArgs();
  validateConfig(config);

  // Step 1: Get or create user to determine tenant ID
  const dbPath = path.join(process.cwd(), 'users.db');
  console.log(`[DB] Database path: ${dbPath}`);
  const db = initDatabase(dbPath);

  const { user, isNew } = getOrCreateUser(db, config.email, config.name);
  config.tenant = user.id; // Use user.id as tenant

  const workerName = `paramita-cloud-${config.tenant}`;

  console.log('='.repeat(60));
  console.log('Interactive Multi-tenant Deployment');
  console.log('='.repeat(60));
  console.log(`Email:          ${config.email}`);
  console.log(`Name:           ${config.name}`);
  console.log(`User ID:        ${user.id}${isNew ? ' (new)' : ' (existing)'}`);
  console.log(`Worker name:    ${workerName}`);
  console.log(`R2 bucket:      moltbot-data-${config.tenant}`);
  console.log(`Instance type:  ${config.instanceType}`);
  console.log(`Credit limit:   $${(config.limit / 100).toFixed(2)}`);
  if (config.dryRun) {
    console.log('Mode:           DRY RUN (no changes will be made)');
  }
  if (config.forceBuild) {
    console.log('Force build:    YES');
  }

  const rl = createReadline();

  try {
    // Step 2: Check for OPENROUTER_PROVISIONING_KEY
    let provisioningKey = process.env.OPENROUTER_PROVISIONING_KEY || '';
    let apiKey = '';

    if (!config.skipProvision) {
      if (!provisioningKey) {
        console.log('\n[OpenRouter] OPENROUTER_PROVISIONING_KEY not found in environment');
        provisioningKey = await promptPassword(rl, 'Enter OPENROUTER_PROVISIONING_KEY');
      }

      if (!provisioningKey) {
        console.log('[OpenRouter] Skipping OpenRouter provisioning (no key provided)');
        config.skipProvision = true;
      }
    }

    // Step 3: Provision OpenRouter API key
    if (!config.skipProvision && provisioningKey) {
      console.log('\n' + '-'.repeat(40));
      console.log('Step 1: OpenRouter API Key Provisioning');
      console.log('-'.repeat(40));

      const openRouter = new OpenRouter({
        apiKey: provisioningKey,
      });

      if (!config.dryRun) {
        const keyResult = await getOrCreateOpenRouterKey(openRouter, db, user.id, config.email, config.limit);
        if (keyResult.key) {
          apiKey = keyResult.key;
          console.log('[OpenRouter] API key will be uploaded to Worker');
        } else {
          console.log('[OpenRouter] Warning: Could not retrieve full API key');
        }
      } else {
        console.log('[OpenRouter] (dry-run) Would check/create API key');
        apiKey = 'sk-or-v1-dry-run-key';
      }
    }

    // Get or generate gateway token before closing database
    let gatewayToken = '';
    if (!config.dryRun) {
      gatewayToken = getOrCreateGatewayToken(db, user.id);
    } else {
      gatewayToken = 'dry-run-gateway-token-' + crypto.randomBytes(16).toString('hex');
    }

    // Step 3: Deploy Worker first (before Access configuration)
    console.log('\n' + '-'.repeat(40));
    console.log('Step 2: Deploy Worker');
    console.log('-'.repeat(40));

    // Check if Worker already exists
    const workerAlreadyExists = workerExists(workerName);
    let shouldDeployWorker = true;

    if (workerAlreadyExists && !config.dryRun) {
      console.log(`[Worker] Worker "${workerName}" already exists`);
      shouldDeployWorker = await promptConfirm(rl, 'Do you want to redeploy the Worker?', false);
      if (!shouldDeployWorker) {
        console.log('[Worker] Skipping Worker deployment');
      }
    }

    if (shouldDeployWorker) {
      // Check if Docker context has changed
      console.log(`\n[Docker] Checking for changes in Docker context files...`);
      const dockerChanges = hasDockerContextChanged(config.tenant);

      let imageSource = './Dockerfile'; // Default: build from Dockerfile
      let skipDockerBuild = false;

      if (config.forceBuild) {
        console.log(`[Docker] Force build requested, will rebuild container image`);
      } else if (dockerChanges.changed) {
        console.log(`[Docker] Changes detected (${dockerChanges.reason}):`);
        for (const file of dockerChanges.files) {
          console.log(`  - ${file}`);
        }
        console.log(`[Docker] Will rebuild container image`);
      } else {
        // No changes, try to use existing image
        console.log(`[Docker] No changes detected in Docker context files`);
        const existingImage = getLatestImageTag(config.tenant);
        if (existingImage) {
          imageSource = existingImage;
          skipDockerBuild = true;
          console.log(`[Docker] Will reuse existing image: ${existingImage}`);
        } else {
          console.log(`[Docker] No existing image found, will build from Dockerfile`);
        }
      }

      const wranglerConfig = generateWranglerConfig(config.tenant, config.instanceType, config.maxInstances, imageSource);
      const configPath = path.join(process.cwd(), `wrangler.tenant-${config.tenant}.jsonc`);

      console.log(`\n[Config] Generating: ${configPath}`);
      console.log(`[Config] Container image: ${imageSource}`);
      if (!config.dryRun) {
        fs.writeFileSync(configPath, JSON.stringify(wranglerConfig, null, 2));
      } else {
        console.log('[Config] (dry-run) Would generate config');
      }

      ensureR2Bucket(config.tenant, config.dryRun);

      // Always run npm build for Worker code (vite build)
      console.log('\n[Build] Running npm run build (Worker code)...');
      if (!config.dryRun) {
        await runCommandInherit('npm run build');
      } else {
        console.log('[Build] (dry-run) Would run: npm run build');
      }

      if (skipDockerBuild) {
        console.log('\n[Docker] Skipping Docker build (using existing image)');
      }

      await deployWorker(configPath, config.dryRun);

      // Save deployment record
      if (!config.dryRun) {
        saveDeploymentRecord(config.tenant, skipDockerBuild ? imageSource : undefined);
      }
    }

    // Step 2.5: Configure custom domain (after Worker deployment, before secrets)
    let configuredDomain: string | undefined;
    if (!config.dryRun && shouldDeployWorker) {
      console.log('\n' + '-'.repeat(40));
      console.log('Step 2.5: Configure Custom Domain');
      console.log('-'.repeat(40));

      try {
        const subdomain = deriveSubdomain(config.name);
        if (!subdomain) {
          console.log('[Domain] Warning: Could not derive valid subdomain from name');
          console.log('[Domain] Skipping custom domain configuration');
        } else {
          console.log(`[Domain] Configuring subdomain: ${subdomain}.tokenaissance.com`);
          configuredDomain = await configureDomain(subdomain, {
            workerTenantId: config.tenant,
          });
          console.log(`[Domain] ✓ Custom domain configured: https://${configuredDomain}`);
        }
      } catch (error) {
        console.warn('[Domain] Failed to configure custom domain (non-fatal):');
        console.warn(`  ${error instanceof Error ? error.message : String(error)}`);
        console.log('\n[Domain] Manual configuration:');
        console.log('  1. Go to Cloudflare Dashboard > Workers & Pages');
        console.log(`  2. Select worker: ${workerName}`);
        console.log('  3. Settings > Domains & Routes > Add Custom Domain');
        console.log(`  4. Enter: ${subdomain || '<your-subdomain>'}.tokenaissance.com\n`);
      }
    }

    // Step 4: Interactive secret collection (after Worker deployment)
    console.log('\n' + '-'.repeat(40));
    console.log('Step 3: Configure Secrets');
    console.log('-'.repeat(40));

    // Get existing secrets to check for overwrites
    const existingSecrets = config.dryRun ? [] : getExistingSecrets(workerName);
    if (existingSecrets.length > 0) {
      console.log(`[Secrets] Found ${existingSecrets.length} existing secrets: ${existingSecrets.join(', ')}`);
    }

    const secrets: Partial<Secrets> = {};
    const skippedSecrets: string[] = [];

    // Helper to check and prompt for secret
    async function collectSecret(
      key: keyof Secrets,
      promptFn: () => Promise<string>,
      autoValue?: string
    ): Promise<void> {
      if (existingSecrets.includes(key)) {
        // Secret exists, prompt with option to keep or update
        if (autoValue !== undefined && autoValue !== '') {
          // We have a database default value, show it
          const preview = autoValue.length > 40 ? autoValue.slice(0, 40) + '...' : autoValue;
          const promptText = `${key} (press Enter to keep: ${preview}, or enter new value)`;
          const input = await promptOptional(rl, promptText, autoValue);

          if (input && input !== '') {
            secrets[key] = input;
            console.log(`[Secret] Updating ${key}`);
          } else {
            console.log(`[Secret] Keeping existing ${key}`);
            skippedSecrets.push(key);
          }
        } else {
          // No database default, just ask if they want to keep existing or enter new
          const promptText = `${key} (press Enter to keep existing, or enter new value)`;
          const input = await promptOptional(rl, promptText, '');

          if (input && input !== '') {
            secrets[key] = input;
            console.log(`[Secret] Updating ${key}`);
          } else {
            console.log(`[Secret] Keeping existing ${key}`);
            skippedSecrets.push(key);
          }
        }
      } else {
        // Secret doesn't exist, prompt user with auto-value as default if available
        // This ensures transparency - user sees what's being set
        const value = await promptFn();
        // Use prompted value, or fall back to autoValue if user just pressed Enter
        secrets[key] = value || autoValue || '';
      }
    }

    // AI Gateway secrets
    // Always prompt for these if they exist, or set them if we have a new API key
    if (apiKey) {
      // We have a new API key, offer to set it
      await collectSecret('AI_GATEWAY_API_KEY', async () => apiKey, apiKey);
      await collectSecret('AI_GATEWAY_BASE_URL', async () => 'https://openrouter.ai/api/v1', 'https://openrouter.ai/api/v1');
    } else if (existingSecrets.includes('AI_GATEWAY_API_KEY') || existingSecrets.includes('AI_GATEWAY_BASE_URL')) {
      // Secrets exist but we don't have a new key, still ask if user wants to update
      await collectSecret('AI_GATEWAY_API_KEY', async () => promptPassword(rl, 'AI_GATEWAY_API_KEY (press Enter to keep existing, or enter new key)'));
      await collectSecret('AI_GATEWAY_BASE_URL', async () => prompt(rl, 'AI_GATEWAY_BASE_URL (press Enter to keep existing, or enter new URL)', 'https://openrouter.ai/api/v1'));
    } else if (!apiKey) {
      // No API key auto-provisioned and no existing secrets - prompt for manual entry
      console.log('[AI Gateway] No API key auto-provisioned. Please enter manually:');
      await collectSecret('AI_GATEWAY_API_KEY', async () => promptPassword(rl, 'AI_GATEWAY_API_KEY (OpenRouter API key)'));
      await collectSecret('AI_GATEWAY_BASE_URL', async () => prompt(rl, 'AI_GATEWAY_BASE_URL', 'https://openrouter.ai/api/v1'));
    }

    // Use gateway token from database
    if (existingSecrets.includes('CLAWDBOT_GATEWAY_TOKEN')) {
      const newValue = await promptOptional(rl, 'CLAWDBOT_GATEWAY_TOKEN (press Enter to keep existing, or enter new token)');
      if (newValue) {
        secrets.CLAWDBOT_GATEWAY_TOKEN = newValue;
        console.log(`[Gateway] Using custom gateway token: ${newValue.slice(0, 16)}...`);
      } else {
        console.log(`[Gateway] Keeping existing CLAWDBOT_GATEWAY_TOKEN in Worker`);
        skippedSecrets.push('CLAWDBOT_GATEWAY_TOKEN');
      }
    } else {
      secrets.CLAWDBOT_GATEWAY_TOKEN = gatewayToken;
      console.log(`[Gateway] Setting gateway token from database: ${gatewayToken.slice(0, 16)}...`);
    }

    // Query deployment config from database (for lazy loading)
    const deploymentConfig = db.prepare('SELECT * FROM user_deployment_configs WHERE userId = ?').get(user.id) as {
      cfAccessTeamDomain?: string;
      cfAccessAud?: string;
      r2AccessKeyId?: string;
      r2SecretAccessKey?: string;
      cfAccountId?: string;
      sandboxSleepAfter?: string;
    } | undefined;

    // Cloudflare Access secrets (available after Worker deployment)
    console.log('\n[Access] Now configure Cloudflare Access for your Worker:');
    console.log('  1. Go to Workers & Pages dashboard');
    console.log(`  2. Select "${workerName}"`);
    console.log('  3. Settings > Domains & Routes > workers.dev row > "..." > Enable Cloudflare Access');
    console.log('  4. Copy the Application Audience (AUD) tag\n');

    // Use database values as defaults if available
    const defaultCfAccessTeamDomain = deploymentConfig?.cfAccessTeamDomain || '';
    const defaultCfAccessAud = deploymentConfig?.cfAccessAud || '';

    await collectSecret('CF_ACCESS_TEAM_DOMAIN', () => prompt(rl, 'CF_ACCESS_TEAM_DOMAIN (e.g., myteam.cloudflareaccess.com)', defaultCfAccessTeamDomain), defaultCfAccessTeamDomain);
    await collectSecret('CF_ACCESS_AUD', () => prompt(rl, 'CF_ACCESS_AUD (Application Audience tag from step above)', defaultCfAccessAud), defaultCfAccessAud);

    // Required R2 secrets (check database first)
    console.log('\n[R2] R2 storage secrets (required for persistent storage):');

    const r2Exists = existingSecrets.includes('R2_ACCESS_KEY_ID');
    let configureR2 = true;

    if (r2Exists) {
      configureR2 = await promptConfirm(rl, 'R2 secrets already exist in Worker. Reconfigure?', false);
    }

    if (configureR2) {
      // Use database values as defaults if available
      const defaultR2KeyId = deploymentConfig?.r2AccessKeyId || '';
      const defaultR2Secret = deploymentConfig?.r2SecretAccessKey || '';
      const defaultCfAccountId = deploymentConfig?.cfAccountId || '';

      secrets.R2_ACCESS_KEY_ID = await prompt(rl, 'R2_ACCESS_KEY_ID', defaultR2KeyId);
      secrets.R2_SECRET_ACCESS_KEY = await prompt(rl, 'R2_SECRET_ACCESS_KEY', defaultR2Secret);
      secrets.CF_ACCOUNT_ID = await prompt(rl, 'CF_ACCOUNT_ID', defaultCfAccountId);
    } else {
      skippedSecrets.push('R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'CF_ACCOUNT_ID');
    }

    // Container lifecycle
    const defaultSandboxSleepAfter = deploymentConfig?.sandboxSleepAfter || 'never';
    await collectSecret('SANDBOX_SLEEP_AFTER', () => promptOptional(rl, 'SANDBOX_SLEEP_AFTER (e.g., 10m, 1h, never)', defaultSandboxSleepAfter), defaultSandboxSleepAfter);

    // Update database with all collected deployment configuration
    if (!config.dryRun) {
      const now = new Date().toISOString();
      const existing = db.prepare('SELECT id FROM user_deployment_configs WHERE userId = ?').get(user.id);

      if (existing) {
        // Preserve existing database values if user chose to keep them
        db.prepare(`
          UPDATE user_deployment_configs
          SET cfAccessTeamDomain = ?, cfAccessAud = ?,
              r2AccessKeyId = ?, r2SecretAccessKey = ?, cfAccountId = ?,
              sandboxSleepAfter = ?, updatedAt = ?
          WHERE userId = ?
        `).run(
          secrets.CF_ACCESS_TEAM_DOMAIN ?? deploymentConfig?.cfAccessTeamDomain ?? null,
          secrets.CF_ACCESS_AUD ?? deploymentConfig?.cfAccessAud ?? null,
          secrets.R2_ACCESS_KEY_ID ?? deploymentConfig?.r2AccessKeyId ?? null,
          secrets.R2_SECRET_ACCESS_KEY ?? deploymentConfig?.r2SecretAccessKey ?? null,
          secrets.CF_ACCOUNT_ID ?? deploymentConfig?.cfAccountId ?? null,
          secrets.SANDBOX_SLEEP_AFTER ?? deploymentConfig?.sandboxSleepAfter ?? 'never',
          now,
          user.id
        );
      } else {
        db.prepare(`
          INSERT INTO user_deployment_configs
          (userId, cfAccessTeamDomain, cfAccessAud, r2AccessKeyId, r2SecretAccessKey, cfAccountId, sandboxSleepAfter, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          user.id,
          secrets.CF_ACCESS_TEAM_DOMAIN || null,
          secrets.CF_ACCESS_AUD || null,
          secrets.R2_ACCESS_KEY_ID || null,
          secrets.R2_SECRET_ACCESS_KEY || null,
          secrets.CF_ACCOUNT_ID || null,
          secrets.SANDBOX_SLEEP_AFTER || 'never',
          now,
          now
        );
      }
      console.log('[DB] Deployment configuration saved to database');
    }

    // Close database connection
    db.close();

    rl.close();

    // Step 5: Set secrets
    console.log('\n' + '-'.repeat(40));
    console.log('Step 4: Configure Worker Secrets');
    console.log('-'.repeat(40));

    if (skippedSecrets.length > 0) {
      console.log(`[Secrets] Skipped (keeping existing): ${skippedSecrets.join(', ')}`);
    }

    for (const [key, value] of Object.entries(secrets)) {
      if (value) {
        setSecret(workerName, key, value, config.dryRun);
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('Deployment Complete!');
    console.log('='.repeat(60));
    console.log(`\nWorker URL: https://${workerName}.<your-subdomain>.workers.dev`);
    if (configuredDomain) {
      console.log(`Custom Domain: https://${configuredDomain}`);
    }
    if (secrets.CLAWDBOT_GATEWAY_TOKEN) {
      console.log(`\nGateway Token (save this!): ${secrets.CLAWDBOT_GATEWAY_TOKEN}`);
    }
    if (apiKey && secrets.AI_GATEWAY_API_KEY) {
      console.log(`\nOpenRouter API Key: ${apiKey.slice(0, 20)}...`);
    }
    console.log('\nNext steps:');
    console.log('1. Enable Cloudflare Access on your worker');
    console.log('2. Access the admin UI at /_admin/ to approve devices');
    console.log('3. The first request may take 1-2 minutes (cold start)');

  } catch (error) {
    rl.close();
    throw error;
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
