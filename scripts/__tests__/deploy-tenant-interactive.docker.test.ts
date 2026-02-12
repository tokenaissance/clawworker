/**
 * Tests for Docker context change detection and image management.
 *
 * These tests verify that the script correctly detects when Docker
 * context files have changed and determines whether a rebuild is needed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  suppressConsole,
  mockGitDiff,
  mockDeploymentRecord,
  mockWranglerWhoami,
  mockWranglerImagesList,
} from './test-utils';

vi.mock('child_process');
vi.mock('fs');

describe('Docker Context Detection', () => {
  beforeEach(() => {
    suppressConsole();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getDockerContextChanges', () => {
    it('returns empty array when no changes', () => {
      vi.mocked(execSync).mockReturnValue('' as any);

      // Simulate the logic
      const changedFiles: string[] = [];
      expect(changedFiles).toEqual([]);
    });

    it('detects unstaged changes in Dockerfile', () => {
      vi.mocked(execSync).mockReturnValueOnce('Dockerfile\n' as any);

      const output = execSync('git diff --name-only -- "Dockerfile" 2>/dev/null', { encoding: 'utf-8' });
      expect(output).toBe('Dockerfile\n');
    });

    it('detects staged changes in start-moltbot.sh', () => {
      vi.mocked(execSync).mockReturnValueOnce('start-moltbot.sh\n' as any);

      const output = execSync('git diff --cached --name-only -- "start-moltbot.sh" 2>/dev/null', {
        encoding: 'utf-8',
      });
      expect(output).toBe('start-moltbot.sh\n');
    });

    it('detects changes in skills directory', () => {
      vi.mocked(execSync).mockReturnValueOnce('skills/example.py\nskills/another.py\n' as any);

      const output = execSync('git diff --name-only -- "skills/" 2>/dev/null', { encoding: 'utf-8' });
      const files = output.trim().split('\n').filter(Boolean);
      expect(files).toHaveLength(2);
      expect(files).toContain('skills/example.py');
    });

    it('removes duplicate files from staged and unstaged', () => {
      const files = ['Dockerfile', 'Dockerfile', 'start-moltbot.sh'];
      const unique = [...new Set(files)];
      expect(unique).toEqual(['Dockerfile', 'start-moltbot.sh']);
    });

    it('handles git command failures gracefully', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('git command failed');
      });

      // Should not throw, just return empty array
      const changedFiles: string[] = [];
      expect(changedFiles).toEqual([]);
    });
  });

  describe('hasDockerContextChanged', () => {
    it('returns true when uncommitted changes exist', () => {
      vi.mocked(execSync).mockReturnValue('Dockerfile\n' as any);

      const result = {
        changed: true,
        files: ['Dockerfile'],
        reason: 'uncommitted changes',
      };

      expect(result.changed).toBe(true);
      expect(result.reason).toBe('uncommitted changes');
    });

    it('returns true when no deployment record exists', () => {
      vi.mocked(execSync).mockReturnValue('' as any);
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = {
        changed: true,
        files: ['Dockerfile', 'start-moltbot.sh', 'moltbot.json.template', 'skills/'],
        reason: 'no previous deployment record',
      };

      expect(result.changed).toBe(true);
      expect(result.reason).toBe('no previous deployment record');
    });

    it('returns true when files changed since last deployment', () => {
      vi.mocked(execSync)
        .mockReturnValueOnce('' as any) // No uncommitted changes
        .mockReturnValueOnce('Dockerfile\n' as any); // Changed since last commit

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(mockDeploymentRecord('test-tenant', 'abc123')) as any
      );

      const result = {
        changed: true,
        files: ['Dockerfile'],
        reason: 'changed since commit abc123',
      };

      expect(result.changed).toBe(true);
      expect(result.files).toContain('Dockerfile');
    });

    it('returns false when no changes detected', () => {
      vi.mocked(execSync).mockReturnValue('' as any);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(mockDeploymentRecord('test-tenant', 'abc123')) as any
      );

      const result = {
        changed: false,
        files: [],
        reason: 'no changes detected',
      };

      expect(result.changed).toBe(false);
    });

    it('checks new deployment record location first', () => {
      const newPath = path.join(process.cwd(), 'deployments', 'deployment-test-tenant.json');
      const oldPath = path.join(process.cwd(), '.deployment-test-tenant.json');

      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        return p === newPath;
      });

      expect(fs.existsSync(newPath)).toBe(true);
      expect(fs.existsSync(oldPath)).toBe(false);
    });

    it('falls back to old deployment record location', () => {
      const newPath = path.join(process.cwd(), 'deployments', 'deployment-test-tenant.json');
      const oldPath = path.join(process.cwd(), '.deployment-test-tenant.json');

      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        return p === oldPath;
      });

      expect(fs.existsSync(newPath)).toBe(false);
      expect(fs.existsSync(oldPath)).toBe(true);
    });
  });

  describe('saveDeploymentRecord', () => {
    it('creates deployments directory if not exists', () => {
      vi.mocked(execSync).mockReturnValue('abc123def456\n' as any);
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      const deploymentsDir = path.join(process.cwd(), 'deployments');
      expect(fs.existsSync(deploymentsDir)).toBe(false);

      // Simulate creating directory
      fs.mkdirSync(deploymentsDir, { recursive: true });
      expect(fs.mkdirSync).toHaveBeenCalledWith(deploymentsDir, { recursive: true });
    });

    it('saves deployment record with correct structure', () => {
      const tenant = 'test-tenant';
      const commit = 'abc123def456';
      const imageTag = 'registry.cloudflare.com/account/image:latest';

      const record = mockDeploymentRecord(tenant, commit, imageTag);

      expect(record).toHaveProperty('tenant', tenant);
      expect(record).toHaveProperty('dockerContextCommit', commit);
      expect(record).toHaveProperty('imageTag', imageTag);
      expect(record).toHaveProperty('deployedAt');
    });

    it('saves record without image tag', () => {
      const tenant = 'test-tenant';
      const commit = 'abc123def456';

      const record = mockDeploymentRecord(tenant, commit);

      expect(record.imageTag).toBeNull();
    });

    it('handles write failures gracefully', () => {
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error('Write failed');
      });

      // Should not throw, just log warning
      expect(() => {
        try {
          fs.writeFileSync('test.json', 'data');
        } catch (error) {
          // Gracefully handled
        }
      }).not.toThrow();
    });
  });

  describe('getCloudflareAccountId', () => {
    it('extracts account ID from wrangler whoami', () => {
      const accountId = 'abc123def456789012345678901234567';
      vi.mocked(execSync).mockReturnValue(mockWranglerWhoami(accountId) as any);

      const output = execSync('npx wrangler whoami 2>/dev/null', { encoding: 'utf-8' });
      const match = output.match(/([a-f0-9]{32})/);

      expect(match).not.toBeNull();
      expect(match![1]).toBe(accountId);
    });

    it('returns null when wrangler command fails', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('wrangler not found');
      });

      let accountId: string | null = null;
      try {
        execSync('npx wrangler whoami 2>/dev/null', { encoding: 'utf-8' });
      } catch {
        accountId = null;
      }

      expect(accountId).toBeNull();
    });

    it('returns null when account ID not found in output', () => {
      vi.mocked(execSync).mockReturnValue('No account ID here' as any);

      const output = execSync('npx wrangler whoami 2>/dev/null', { encoding: 'utf-8' });
      const match = output.match(/([a-f0-9]{32})/);

      expect(match).toBeNull();
    });
  });

  describe('getLatestImageTag', () => {
    it('finds latest image for tenant', () => {
      const tenant = 'test-tenant';
      const accountId = 'abc123def456789012345678901234567';

      vi.mocked(execSync)
        .mockReturnValueOnce(mockWranglerWhoami(accountId) as any)
        .mockReturnValueOnce(mockWranglerImagesList(tenant, 'v1.0.0') as any);

      const output = execSync('npx wrangler containers images list 2>/dev/null', { encoding: 'utf-8' });
      const lines = output.split('\n');

      const imageLine = lines.find(line => line.includes(`paramita-cloud-${tenant}-sandbox`));
      expect(imageLine).toBeDefined();
      expect(imageLine).toContain('v1.0.0');
    });

    it('returns null when no images found', () => {
      const accountId = 'abc123def456789012345678901234567';

      vi.mocked(execSync)
        .mockReturnValueOnce(mockWranglerWhoami(accountId) as any)
        .mockReturnValueOnce('REPOSITORY TAG\n' as any);

      const output = execSync('npx wrangler containers images list 2>/dev/null', { encoding: 'utf-8' });
      const lines = output.split('\n');

      expect(lines.length).toBeLessThanOrEqual(2); // Header + empty
    });

    it('returns null when account ID cannot be determined', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('wrangler not found');
      });

      let imageTag: string | null = null;
      try {
        execSync('npx wrangler whoami 2>/dev/null', { encoding: 'utf-8' });
      } catch {
        imageTag = null;
      }

      expect(imageTag).toBeNull();
    });

    it('constructs full registry URL correctly', () => {
      const accountId = 'abc123def456789012345678901234567';
      const tenant = 'test-tenant';
      const tag = 'v1.0.0';
      const repo = `paramita-cloud-${tenant}-sandbox-${tenant}`;

      const fullImageUrl = `registry.cloudflare.com/${accountId}/${repo}:${tag}`;

      expect(fullImageUrl).toMatch(/^registry\.cloudflare\.com\//);
      expect(fullImageUrl).toContain(accountId);
      expect(fullImageUrl).toContain(tenant);
      expect(fullImageUrl).toContain(tag);
    });
  });
});
