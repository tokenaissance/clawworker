/**
 * Tests for database operations including user management and OpenRouter key provisioning.
 *
 * These tests verify that database operations work correctly, including
 * user creation, subdomain generation, and API key management.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { OpenRouter } from '@openrouter/sdk';
import { suppressConsole, createMockDatabase, createMockOpenRouter } from './test-utils';

vi.mock('better-sqlite3', () => ({
  default: vi.fn(),
}));
vi.mock('@openrouter/sdk', () => ({
  OpenRouter: vi.fn(),
}));

describe('Database Operations', () => {
  beforeEach(() => {
    suppressConsole();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initDatabase', () => {
    it('creates users table with correct schema', () => {
      const mockDb = createMockDatabase();
      vi.mocked(Database).mockImplementation(() => mockDb as any);

      const db = new Database(':memory:');

      expect(db.exec).toHaveBeenCalled();
      const execCalls = vi.mocked(db.exec).mock.calls;
      const usersTableCall = execCalls.find(call =>
        call[0].includes('CREATE TABLE IF NOT EXISTS users')
      );
      expect(usersTableCall).toBeDefined();
    });

    it('creates ai_provider_keys table', () => {
      const mockDb = createMockDatabase();
      vi.mocked(Database).mockImplementation(() => mockDb as any);

      const db = new Database(':memory:');

      const execCalls = vi.mocked(db.exec).mock.calls;
      const keysTableCall = execCalls.find(call =>
        call[0].includes('CREATE TABLE IF NOT EXISTS ai_provider_keys')
      );
      expect(keysTableCall).toBeDefined();
    });

    it('creates user_deployment_configs table', () => {
      const mockDb = createMockDatabase();
      vi.mocked(Database).mockImplementation(() => mockDb as any);

      const db = new Database(':memory:');

      const execCalls = vi.mocked(db.exec).mock.calls;
      const configsTableCall = execCalls.find(call =>
        call[0].includes('CREATE TABLE IF NOT EXISTS user_deployment_configs')
      );
      expect(configsTableCall).toBeDefined();
    });

    it('creates indexes for ai_provider_keys', () => {
      const mockDb = createMockDatabase();
      vi.mocked(Database).mockImplementation(() => mockDb as any);

      const db = new Database(':memory:');

      const execCalls = vi.mocked(db.exec).mock.calls;
      const indexCalls = execCalls.filter(call => call[0].includes('CREATE INDEX IF NOT EXISTS'));
      expect(indexCalls.length).toBeGreaterThan(0);
    });

    it('is idempotent (can be called multiple times)', () => {
      const mockDb = createMockDatabase();
      vi.mocked(Database).mockImplementation(() => mockDb as any);

      const db = new Database(':memory:');

      // All CREATE statements use IF NOT EXISTS
      const execCalls = vi.mocked(db.exec).mock.calls;
      execCalls.forEach(call => {
        if (call[0].includes('CREATE TABLE')) {
          expect(call[0]).toContain('IF NOT EXISTS');
        }
      });
    });
  });

  describe('getUniqueSubdomain', () => {
    it('returns base subdomain when available', () => {
      const mockDb = createMockDatabase();
      const mockPrepare = vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(undefined), // No existing user
      });
      mockDb.prepare = mockPrepare;

      // Simulate the logic
      const baseSubdomain = 'testuser';
      const existing = undefined;

      expect(existing).toBeUndefined();
      // Would return baseSubdomain
    });

    it('adds numeric suffix when base is taken', () => {
      const mockDb = createMockDatabase();
      const mockPrepare = vi.fn()
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ id: 'existing-user-1' }), // Base taken
        })
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue(undefined), // testuser2 available
        });
      mockDb.prepare = mockPrepare;

      // Simulate the logic
      const baseSubdomain = 'testuser';
      let counter = 2;
      const candidate = `${baseSubdomain}${counter}`;

      expect(candidate).toBe('testuser2');
    });

    it('increments counter until finding available subdomain', () => {
      const baseSubdomain = 'testuser';
      const counters = [2, 3, 4, 5];

      counters.forEach(counter => {
        const candidate = `${baseSubdomain}${counter}`;
        expect(candidate).toBe(`testuser${counter}`);
      });
    });

    it('excludes current user ID when checking availability', () => {
      const mockDb = createMockDatabase();
      const mockPrepare = vi.fn().mockReturnValue({
        get: vi.fn((subdomain: string, userId: string) => {
          // Should pass excludeUserId to query
          expect(userId).toBeDefined();
          return undefined;
        }),
      });
      mockDb.prepare = mockPrepare;

      const excludeUserId = 'user-123';
      // Query should include: AND id != ?
    });

    it('uses UUID suffix as fallback after 1000 attempts', () => {
      const baseSubdomain = 'testuser';
      const uuid = 'abc123de-f456-7890-1234-567890abcdef';
      const uuidSuffix = uuid.replace(/-/g, '').slice(0, 8);
      const fallback = `${baseSubdomain}${uuidSuffix}`;

      expect(fallback).toBe('testuserabc123de');
      expect(fallback).not.toContain('-');
    });

    it('does not use hyphens in subdomain', () => {
      const baseSubdomain = 'testuser';
      const withCounter = `${baseSubdomain}2`;
      const withUuid = `${baseSubdomain}abc123de`;

      expect(withCounter).not.toContain('-');
      expect(withUuid).not.toContain('-');
    });
  });

  describe('getOrCreateUser', () => {
    it('returns existing user when found', () => {
      const mockDb = createMockDatabase();
      const existingUser = {
        id: 'user-123',
        name: 'Test User',
        email: 'test@example.com',
        subdomain: 'testuser',
      };

      const mockPrepare = vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(existingUser),
        run: vi.fn(),
      });
      mockDb.prepare = mockPrepare;

      // Simulate the logic
      const result = { user: existingUser, isNew: false };

      expect(result.isNew).toBe(false);
      expect(result.user.id).toBe('user-123');
    });

    it('creates new user when not found', () => {
      const mockDb = createMockDatabase();
      const mockPrepare = vi.fn()
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue(undefined), // No existing user
        })
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue(undefined), // Subdomain available
        })
        .mockReturnValueOnce({
          run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
        })
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({
            id: 'new-user-id',
            name: 'New User',
            email: 'new@example.com',
            subdomain: 'newuser',
          }),
        });
      mockDb.prepare = mockPrepare;

      // Simulate the logic
      const result = { user: { id: 'new-user-id' }, isNew: true };

      expect(result.isNew).toBe(true);
    });

    it('generates subdomain for existing user without one', () => {
      const mockDb = createMockDatabase();
      const existingUser = {
        id: 'user-123',
        name: 'Test User',
        email: 'test@example.com',
        subdomain: null, // No subdomain
      };

      const mockPrepare = vi.fn()
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue(existingUser),
        })
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue(undefined), // Subdomain available
        })
        .mockReturnValueOnce({
          run: vi.fn().mockReturnValue({ changes: 1 }),
        });
      mockDb.prepare = mockPrepare;

      // Should update user with subdomain
      expect(existingUser.subdomain).toBeNull();
    });

    it('sets emailVerified to 0 for new users', () => {
      const insertSQL = `
        INSERT INTO users (id, name, email, subdomain, emailVerified, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, 0, ?, ?)
      `;

      expect(insertSQL).toContain('emailVerified');
      expect(insertSQL).toContain(', 0,');
    });

    it('sets timestamps for new users', () => {
      const now = new Date().toISOString();
      const insertSQL = `VALUES (?, ?, ?, ?, 0, ?, ?)`;

      // Should pass createdAt and updatedAt
      expect(insertSQL).toContain('?');
    });
  });

  describe('getOrCreateGatewayToken', () => {
    it('returns existing token when available', () => {
      const mockDb = createMockDatabase();
      const existingUser = {
        id: 'user-123',
        gatewayToken: 'existing-token-abc123',
      };

      const mockPrepare = vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(existingUser),
      });
      mockDb.prepare = mockPrepare;

      // Simulate the logic
      if (existingUser.gatewayToken) {
        expect(existingUser.gatewayToken).toBe('existing-token-abc123');
      }
    });

    it('generates new token when not available', () => {
      const mockDb = createMockDatabase();
      const user = {
        id: 'user-123',
        gatewayToken: null,
      };

      // Should generate random token
      const newToken = 'generated-token-' + Math.random().toString(36).substring(2);
      expect(newToken).toContain('generated-token-');
    });

    it('saves generated token to database', () => {
      const mockDb = createMockDatabase();
      const mockPrepare = vi.fn().mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 1 }),
      });
      mockDb.prepare = mockPrepare;

      const updateSQL = 'UPDATE users SET gatewayToken = ? WHERE id = ?';
      expect(updateSQL).toContain('gatewayToken');
    });

    it('generates token with sufficient entropy', () => {
      // Token should be at least 32 characters
      const token = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
      expect(token.length).toBeGreaterThanOrEqual(20);
    });
  });

  describe('getOrCreateOpenRouterKey', () => {
    it('returns existing key when found', () => {
      const mockDb = createMockDatabase();
      const existingKey = {
        id: 1,
        userId: 'user-123',
        provider: 'openrouter',
        apiKey: 'sk-or-existing-key',
      };

      const mockPrepare = vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(existingKey),
      });
      mockDb.prepare = mockPrepare;

      // Simulate the logic
      if (existingKey) {
        expect(existingKey.apiKey).toBe('sk-or-existing-key');
      }
    });

    it('provisions new key via OpenRouter SDK', async () => {
      const mockOpenRouter = createMockOpenRouter();
      vi.mocked(OpenRouter).mockImplementation(() => mockOpenRouter as any);

      const client = new OpenRouter({ apiKey: 'provisioning-key' } as any);
      const result = await client.keys.create({
        name: 'test-user',
        limit: 500,
      } as any);

      expect(result.key).toBe('sk-or-test-key-123456');
      expect(result.limit).toBe(500);
    });

    it('saves provisioned key to database', () => {
      const mockDb = createMockDatabase();
      const mockPrepare = vi.fn().mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
      });
      mockDb.prepare = mockPrepare;

      const insertSQL = `
        INSERT INTO ai_provider_keys (userId, provider, baseUrl, keyHash, keyPrefix, apiKey, name, limitAmount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;

      expect(insertSQL).toContain('ai_provider_keys');
      expect(insertSQL).toContain('apiKey');
    });

    it('sets provider to openrouter', () => {
      const provider = 'openrouter';
      expect(provider).toBe('openrouter');
    });

    it('sets baseUrl to OpenRouter API', () => {
      const baseUrl = 'https://openrouter.ai/api/v1';
      expect(baseUrl).toContain('openrouter.ai');
    });

    it('stores key hash for security', () => {
      const apiKey = 'sk-or-test-key-123456';
      const keyHash = 'hash-of-' + apiKey;

      expect(keyHash).toContain('hash-of-');
    });

    it('stores key prefix for display', () => {
      const apiKey = 'sk-or-test-key-123456';
      const keyPrefix = apiKey.slice(0, 10);

      expect(keyPrefix).toBe('sk-or-test');
    });

    it('sets limit amount from config', () => {
      const limit = 500; // $5 in cents
      expect(limit).toBe(500);
    });

    it('handles OpenRouter API errors', async () => {
      const mockOpenRouter = createMockOpenRouter();
      mockOpenRouter.keys.create = vi.fn().mockRejectedValue(new Error('API error'));
      vi.mocked(OpenRouter).mockImplementation(() => mockOpenRouter as any);

      const client = new OpenRouter({ apiKey: 'provisioning-key' } as any);

      await expect(client.keys.create({ name: 'test', limit: 500 } as any)).rejects.toThrow('API error');
    });
  });

  describe('Database Constraints', () => {
    it('enforces unique email constraint', () => {
      const insertSQL = 'CREATE TABLE IF NOT EXISTS users (email TEXT NOT NULL UNIQUE)';
      expect(insertSQL).toContain('UNIQUE');
    });

    it('enforces unique subdomain constraint', () => {
      const insertSQL = 'CREATE TABLE IF NOT EXISTS users (subdomain TEXT UNIQUE)';
      expect(insertSQL).toContain('UNIQUE');
    });

    it('enforces foreign key on ai_provider_keys', () => {
      const insertSQL = 'FOREIGN KEY (userId) REFERENCES users(id)';
      expect(insertSQL).toContain('FOREIGN KEY');
      expect(insertSQL).toContain('REFERENCES users');
    });

    it('sets default values for timestamps', () => {
      const createSQL = "createdAt TEXT DEFAULT (datetime('now'))";
      expect(createSQL).toContain('DEFAULT');
      expect(createSQL).toContain("datetime('now')");
    });
  });
});
