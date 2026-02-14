/**
 * Test utilities for deployment script tests
 */
import { vi } from 'vitest';
import type { Database as DatabaseType, Statement } from 'better-sqlite3';

/**
 * Create a mock better-sqlite3 database instance
 */
export function createMockDatabase(): Partial<DatabaseType> {
  const mockData = new Map<string, any[]>();

  const mockPrepare = vi.fn((sql: string) => {
    const statement: Partial<Statement> = {
      run: vi.fn((...params: any[]) => {
        // Extract table name from INSERT/UPDATE statements
        const insertMatch = sql.match(/INSERT INTO (\w+)/i);
        const updateMatch = sql.match(/UPDATE (\w+)/i);
        const tableName = insertMatch?.[1] || updateMatch?.[1] || 'unknown';

        if (!mockData.has(tableName)) {
          mockData.set(tableName, []);
        }

        // For INSERT, add a new row
        if (insertMatch) {
          const row = { id: mockData.get(tableName)!.length + 1, ...params };
          mockData.get(tableName)!.push(row);
          return { changes: 1, lastInsertRowid: row.id };
        }

        return { changes: 1, lastInsertRowid: 0 };
      }),
      get: vi.fn((...params: any[]) => {
        // Extract table name from SELECT statements
        const match = sql.match(/FROM (\w+)/i);
        const tableName = match?.[1] || 'unknown';
        const rows = mockData.get(tableName) || [];
        return rows[0] || null;
      }),
      all: vi.fn((...params: any[]) => {
        const match = sql.match(/FROM (\w+)/i);
        const tableName = match?.[1] || 'unknown';
        return mockData.get(tableName) || [];
      }),
    };
    return statement as Statement;
  });

  return {
    prepare: mockPrepare,
    exec: vi.fn(),
    close: vi.fn(),
    pragma: vi.fn(),
  };
}

/**
 * Create a mock readline interface with pre-configured answers
 */
export function createMockReadline(answers: string[] = []): any {
  let answerIndex = 0;

  return {
    question: vi.fn((query: string, callback: (answer: string) => void) => {
      const answer = answers[answerIndex] || '';
      answerIndex++;
      callback(answer);
    }),
    close: vi.fn(),
  };
}

/**
 * Create a mock OpenRouter SDK client
 */
export function createMockOpenRouter() {
  return {
    keys: {
      create: vi.fn().mockResolvedValue({
        key: 'sk-or-test-key-123456',
        name: 'test-key',
        limit: 500,
      }),
      list: vi.fn().mockResolvedValue([]),
    },
  };
}

/**
 * Generate mock wrangler whoami output
 */
export function mockWranglerWhoami(accountId: string = 'abc123def456789012345678901234567'): string {
  return `
Getting User settings...
👋 You are logged in with an OAuth Token, associated with the email 'test@example.com'!
┌──────────────────────────────────┬──────────────────────────────────┐
│ Account Name                     │ Account ID                       │
├──────────────────────────────────┼──────────────────────────────────┤
│ Test Account                     │ ${accountId} │
└──────────────────────────────────┴──────────────────────────────────┘
`;
}

/**
 * Generate mock wrangler container images list output
 */
export function mockWranglerImagesList(tenant: string, tag: string = 'latest'): string {
  return `
REPOSITORY                                    TAG
paramita-cloud-${tenant}-sandbox-${tenant}    ${tag}
paramita-cloud-${tenant}-sandbox              ${tag}
`;
}

/**
 * Generate mock wrangler secrets list output (JSON format)
 */
export function mockWranglerSecretsListJSON(secrets: string[]): string {
  return JSON.stringify(secrets.map(name => ({ name })));
}

/**
 * Generate mock wrangler secrets list output (text format)
 */
export function mockWranglerSecretsListText(secrets: string[]): string {
  return secrets.map(name => `Secret Name: ${name}`).join('\n');
}

/**
 * Generate mock wrangler deployments list output
 */
export function mockWranglerDeploymentsList(): string {
  return `
Deployment ID: abc123
Created on:    2024-01-01T00:00:00.000Z
Author:        test@example.com
Source:        Upload
`;
}

/**
 * Suppress console output during tests
 */
export function suppressConsole() {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
}

/**
 * Create a mock stdin for password prompts
 */
export function createMockStdin(inputs: string[] = []) {
  let inputIndex = 0;
  const listeners = new Map<string, Function[]>();

  return {
    isTTY: true,
    setRawMode: vi.fn(),
    resume: vi.fn(),
    on: vi.fn((event: string, callback: Function) => {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event)!.push(callback);
    }),
    removeListener: vi.fn((event: string, callback: Function) => {
      const eventListeners = listeners.get(event);
      if (eventListeners) {
        const index = eventListeners.indexOf(callback);
        if (index > -1) {
          eventListeners.splice(index, 1);
        }
      }
    }),
    emit: (event: string, data: any) => {
      const eventListeners = listeners.get(event);
      if (eventListeners) {
        eventListeners.forEach(cb => cb(data));
      }
    },
  };
}

/**
 * Mock git diff output
 */
export function mockGitDiff(files: string[]): string {
  return files.join('\n');
}

/**
 * Mock deployment record
 */
export function mockDeploymentRecord(tenant: string, commit: string, imageTag?: string) {
  return {
    tenant,
    dockerContextCommit: commit,
    imageTag: imageTag || null,
    deployedAt: new Date().toISOString(),
  };
}
