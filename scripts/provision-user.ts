#!/usr/bin/env npx tsx
/**
 * User provisioning script for OpenRouter multi-tenant setup
 *
 * Usage:
 *   npx tsx scripts/provision-user.ts --email=user@example.com --name="User Name"
 *   npx tsx scripts/provision-user.ts --email=user@example.com --name="User Name" --limit=500
 *
 * Environment variables:
 *   OPENROUTER_PROVISIONING_KEY - Required: Your OpenRouter provisioning API key
 *
 * This script:
 * 1. Creates a user record in local SQLite database with UUID
 * 2. Creates an OpenRouter API key for the user
 * 3. Outputs the environment variables to configure the worker
 */

import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { OpenRouter } from '@openrouter/sdk';
import * as crypto from 'crypto';
import * as path from 'path';

interface UserConfig {
  email: string;
  name: string;
  limit: number;
  utmSource: string;
  locale: string;
}

interface User {
  id: string;
  name: string;
  email: string;
  emailVerified: number;
  image: string | null;
  createdAt: string;
  updatedAt: string;
  utmSource: string;
  ip: string;
  locale: string;
}

interface OpenRouterKey {
  id: number;
  userId: string;
  keyHash: string;
  keyPrefix: string;
  name: string;
  limitAmount: number;
  limitReset: string;
  disabled: number;
  createdAt: string;
}

function parseArgs(): UserConfig {
  const args = process.argv.slice(2);
  const config: UserConfig = {
    email: '',
    name: '',
    limit: 1000, // Default $10 credit limit
    utmSource: '',
    locale: 'en',
  };

  for (const arg of args) {
    if (arg.startsWith('--email=')) {
      config.email = arg.split('=')[1];
    } else if (arg.startsWith('--name=')) {
      config.name = arg.split('=')[1];
    } else if (arg.startsWith('--limit=')) {
      config.limit = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--utm-source=')) {
      config.utmSource = arg.split('=')[1];
    } else if (arg.startsWith('--locale=')) {
      config.locale = arg.split('=')[1];
    }
  }

  return config;
}

function validateConfig(config: UserConfig): void {
  if (!config.email) {
    console.error('Error: --email is required');
    console.error('Usage: npx tsx scripts/provision-user.ts --email=user@example.com --name="User Name"');
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
    console.error('Usage: npx tsx scripts/provision-user.ts --email=user@example.com --name="User Name"');
    process.exit(1);
  }

  if (!process.env.OPENROUTER_PROVISIONING_KEY) {
    console.error('Error: OPENROUTER_PROVISIONING_KEY environment variable is required');
    console.error('Get your provisioning key from https://openrouter.ai/settings/keys');
    process.exit(1);
  }
}

function initDatabase(dbPath: string): DatabaseType {
  const db = new Database(dbPath);

  // Create users table
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
      locale TEXT DEFAULT ''
    )
  `);

  // Create openrouter_keys table
  db.exec(`
    CREATE TABLE IF NOT EXISTS openrouter_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      keyHash TEXT NOT NULL,
      keyPrefix TEXT,
      name TEXT,
      limitAmount INTEGER,
      limitReset TEXT,
      disabled INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (userId) REFERENCES users(id)
    )
  `);

  // Create index on userId
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_openrouter_keys_userId ON openrouter_keys(userId)
  `);

  return db;
}

function generateUUID(): string {
  return crypto.randomUUID();
}

function getOrCreateUser(db: DatabaseType, config: UserConfig): { user: User; isNew: boolean } {
  // Check if user exists
  const existingUser = db.prepare('SELECT * FROM users WHERE email = ?').get(config.email) as User | undefined;

  if (existingUser) {
    console.log(`[User] Found existing user: ${existingUser.id}`);
    return { user: existingUser, isNew: false };
  }

  // Create new user
  const userId = generateUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO users (id, name, email, emailVerified, createdAt, updatedAt, utmSource, locale)
    VALUES (?, ?, ?, 0, ?, ?, ?, ?)
  `).run(userId, config.name, config.email, now, now, config.utmSource, config.locale);

  const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User;
  console.log(`[User] Created new user: ${userId}`);

  return { user: newUser, isNew: true };
}

function getExistingKey(db: DatabaseType, userId: string): OpenRouterKey | undefined {
  return db.prepare(
    'SELECT * FROM openrouter_keys WHERE userId = ? AND disabled = 0 ORDER BY createdAt DESC LIMIT 1'
  ).get(userId) as OpenRouterKey | undefined;
}

async function getOrCreateOpenRouterKey(
  openRouter: OpenRouter,
  db: DatabaseType,
  userId: string,
  email: string,
  limit: number
): Promise<{ key: string | null; hash: string; isNew: boolean }> {
  // First check if user already has a key in local database
  const existingLocalKey = getExistingKey(db, userId);

  if (existingLocalKey) {
    // Verify the key still exists on OpenRouter
    try {
      const remoteKey = await openRouter.apiKeys.get({ hash: existingLocalKey.keyHash });
      if (remoteKey && !remoteKey.data.disabled) {
        console.log(`[OpenRouter] Found existing API key: ${existingLocalKey.keyPrefix}`);
        return { key: null, hash: existingLocalKey.keyHash, isNew: false };
      }
    } catch (error: unknown) {
      // Check if it's an auth error - should not fallback to create
      if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 401) {
        throw new Error('OpenRouter API authentication failed. Check OPENROUTER_PROVISIONING_KEY.');
      }
      // Key doesn't exist on OpenRouter anymore, mark as disabled locally
      console.log(`[OpenRouter] Local key ${existingLocalKey.keyPrefix} no longer exists on OpenRouter`);
      db.prepare('UPDATE openrouter_keys SET disabled = 1 WHERE keyHash = ?').run(existingLocalKey.keyHash);
    }
  }

  // Also check OpenRouter directly by listing keys and matching by name (email)
  console.log(`[OpenRouter] Checking for existing key with name: ${email}`);
  const allKeys = await openRouter.apiKeys.list();
  const existingRemoteKey = allKeys.data.find((k: { name?: string; disabled?: boolean }) => k.name === email && !k.disabled);

  if (existingRemoteKey) {
    console.log(`[OpenRouter] Found existing API key on OpenRouter: ${email}`);

    // Save to local database if not already there
    const localExists = db.prepare('SELECT 1 FROM openrouter_keys WHERE keyHash = ?').get(existingRemoteKey.hash);
    if (!localExists) {
      db.prepare(`
        INSERT INTO openrouter_keys (userId, keyHash, keyPrefix, name, limitAmount, limitReset, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(userId, existingRemoteKey.hash, 'sk-or-v1-...', email, existingRemoteKey.limit || limit, existingRemoteKey.limitReset || 'monthly');
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
    INSERT INTO openrouter_keys (userId, keyHash, keyPrefix, name, limitAmount, limitReset, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(userId, response.data.hash, keyPrefix, email, limit, 'monthly');

  console.log(`[OpenRouter] API key created: ${keyPrefix}`);

  return { key: response.key, hash: response.data.hash, isNew: true };
}

async function main(): Promise<void> {
  const config = parseArgs();
  validateConfig(config);

  console.log('='.repeat(60));
  console.log('User Provisioning for OpenRouter Multi-tenant Setup');
  console.log('='.repeat(60));
  console.log(`Email:  ${config.email}`);
  console.log(`Name:   ${config.name}`);
  console.log(`Limit:  $${(config.limit / 100).toFixed(2)} (${config.limit} cents)`);

  // Initialize database
  const dbPath = path.join(process.cwd(), 'users.db');
  console.log(`\n[DB] Database path: ${dbPath}`);
  const db = initDatabase(dbPath);

  // Get or create user
  const { user, isNew } = getOrCreateUser(db, config);

  // Initialize OpenRouter client
  const openRouter = new OpenRouter({
    apiKey: process.env.OPENROUTER_PROVISIONING_KEY!,
  });

  // Get or create API key
  const keyResult = await getOrCreateOpenRouterKey(openRouter, db, user.id, config.email, config.limit);

  // Output results
  console.log('\n' + '='.repeat(60));
  console.log('Provisioning Complete!');
  console.log('='.repeat(60));
  console.log(`\nUser ID: ${user.id}`);
  console.log(`Email:   ${user.email}`);
  console.log(`Name:    ${user.name}`);

  if (keyResult.isNew && keyResult.key) {
    console.log('\n--- Environment Variables ---');
    console.log(`AI_GATEWAY_API_KEY=${keyResult.key}`);
    console.log(`AI_GATEWAY_BASE_URL=https://openrouter.ai/api/v1`);

    console.log('\n--- Wrangler Secret Commands ---');
    console.log(`wrangler secret put AI_GATEWAY_API_KEY --name paramita-cloud-${user.id}`);
    console.log(`# Then paste: ${keyResult.key}`);
    console.log(`wrangler secret put AI_GATEWAY_BASE_URL --name paramita-cloud-${user.id}`);
    console.log(`# Then paste: https://openrouter.ai/api/v1`);
  } else {
    console.log('\n[OpenRouter] Using existing API key.');
    console.log('[OpenRouter] Note: Cannot retrieve full key from hash for security reasons.');
    console.log('[OpenRouter] If you need the full key, delete the existing key on OpenRouter and run again.');
  }

  db.close();
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
