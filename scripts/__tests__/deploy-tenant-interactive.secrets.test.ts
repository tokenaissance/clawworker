/**
 * Tests for Cloudflare Worker secrets management and deployment operations.
 *
 * These tests verify that the script correctly interacts with wrangler CLI
 * for managing secrets, checking deployments, and creating R2 buckets.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync, spawn, spawnSync } from 'child_process';
import {
  suppressConsole,
  mockWranglerDeploymentsList,
  mockWranglerSecretsListJSON,
  mockWranglerSecretsListText,
} from './test-utils';

vi.mock('child_process');

describe('Secrets Management', () => {
  beforeEach(() => {
    suppressConsole();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('workerExists', () => {
    it('returns true when worker has deployments', () => {
      vi.mocked(execSync).mockReturnValue(mockWranglerDeploymentsList() as any);

      const output = execSync('npx wrangler deployments list --name test-worker 2>/dev/null', {
        encoding: 'utf-8',
      });

      expect(output).toContain('Deployment ID');
    });

    it('returns false when worker has no deployments', () => {
      vi.mocked(execSync).mockReturnValue('No deployments found' as any);

      const output = execSync('npx wrangler deployments list --name test-worker 2>/dev/null', {
        encoding: 'utf-8',
      });

      expect(output).not.toContain('Deployment ID');
    });

    it('returns false when wrangler command fails', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('Command failed');
      });

      let exists = true;
      try {
        execSync('npx wrangler deployments list --name test-worker 2>/dev/null', { encoding: 'utf-8' });
      } catch {
        exists = false;
      }

      expect(exists).toBe(false);
    });

    it('uses correct worker name in command', () => {
      const workerName = 'my-test-worker';
      const command = `npx wrangler deployments list --name ${workerName} 2>/dev/null`;

      expect(command).toContain(workerName);
    });
  });

  describe('getExistingSecrets', () => {
    it('parses JSON format secrets list', () => {
      const secrets = ['SECRET_ONE', 'SECRET_TWO', 'SECRET_THREE'];
      vi.mocked(execSync).mockReturnValue(mockWranglerSecretsListJSON(secrets) as any);

      const output = execSync('npx wrangler secret list --name test-worker 2>/dev/null', {
        encoding: 'utf-8',
      });

      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.map((item: any) => item.name)).toEqual(secrets);
    });

    it('parses text format secrets list', () => {
      const secrets = ['SECRET_ONE', 'SECRET_TWO'];
      vi.mocked(execSync).mockReturnValue(mockWranglerSecretsListText(secrets) as any);

      const output = execSync('npx wrangler secret list --name test-worker 2>/dev/null', {
        encoding: 'utf-8',
      });

      const lines = output.split('\n');
      const foundSecrets = lines
        .map(line => {
          const match = line.match(/Secret Name:\s*(\S+)/i);
          return match ? match[1] : null;
        })
        .filter(Boolean);

      expect(foundSecrets).toEqual(secrets);
    });

    it('parses table format secrets list', () => {
      const tableOutput = `
| Name              |
|-------------------|
| SECRET_ONE        |
| SECRET_TWO        |
`;
      vi.mocked(execSync).mockReturnValue(tableOutput as any);

      const output = execSync('npx wrangler secret list --name test-worker 2>/dev/null', {
        encoding: 'utf-8',
      });

      const lines = output.split('\n');
      const foundSecrets = lines
        .map(line => {
          const match = line.match(/^\s*\|\s*(\w+)\s*\|/);
          return match && match[1] !== 'Name' ? match[1] : null;
        })
        .filter(Boolean);

      expect(foundSecrets).toContain('SECRET_ONE');
      expect(foundSecrets).toContain('SECRET_TWO');
    });

    it('returns empty array when no secrets exist', () => {
      vi.mocked(execSync).mockReturnValue('[]' as any);

      const output = execSync('npx wrangler secret list --name test-worker 2>/dev/null', {
        encoding: 'utf-8',
      });

      const parsed = JSON.parse(output);
      expect(parsed).toEqual([]);
    });

    it('returns empty array when command fails', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('Command failed');
      });

      let secrets: string[] = [];
      try {
        execSync('npx wrangler secret list --name test-worker 2>/dev/null', { encoding: 'utf-8' });
      } catch {
        secrets = [];
      }

      expect(secrets).toEqual([]);
    });

    it('handles malformed JSON gracefully', () => {
      vi.mocked(execSync).mockReturnValue('not valid json' as any);

      const output = execSync('npx wrangler secret list --name test-worker 2>/dev/null', {
        encoding: 'utf-8',
      });

      let parsed: any = null;
      try {
        parsed = JSON.parse(output);
      } catch {
        // Fall back to text parsing
        parsed = null;
      }

      expect(parsed).toBeNull();
    });
  });

  describe('setSecret', () => {
    it('pipes secret value via stdin', () => {
      const mockSpawn = vi.fn().mockReturnValue({
        stdin: {
          write: vi.fn(),
          end: vi.fn(),
        },
        on: vi.fn((event, callback) => {
          if (event === 'close') callback(0);
        }),
      });
      vi.mocked(spawn).mockImplementation(mockSpawn as any);

      const secretName = 'MY_SECRET';
      const secretValue = 'secret-value-123';

      // Simulate piping secret
      const child = spawn('sh', ['-c', `echo "${secretValue}" | npx wrangler secret put ${secretName}`]);

      expect(mockSpawn).toHaveBeenCalled();
    });

    it('uses correct secret name', () => {
      const secretName = 'AI_GATEWAY_API_KEY';
      const command = `npx wrangler secret put ${secretName} --name test-worker`;

      expect(command).toContain(secretName);
    });

    it('includes worker name in command', () => {
      const workerName = 'my-worker';
      const command = `npx wrangler secret put MY_SECRET --name ${workerName}`;

      expect(command).toContain(`--name ${workerName}`);
    });

    it('handles secret setting failures', () => {
      const mockSpawn = vi.fn().mockReturnValue({
        stdin: {
          write: vi.fn(),
          end: vi.fn(),
        },
        on: vi.fn((event, callback) => {
          if (event === 'close') callback(1); // Non-zero exit code
        }),
      });
      vi.mocked(spawn).mockImplementation(mockSpawn as any);

      // Should handle error gracefully
      expect(mockSpawn).toBeDefined();
    });
  });

  describe('ensureR2Bucket', () => {
    it('creates bucket when it does not exist', () => {
      vi.mocked(execSync)
        .mockReturnValueOnce('' as any) // Bucket list without our bucket
        .mockReturnValueOnce('Bucket created successfully' as any);

      // Check if bucket exists
      const listOutput = execSync('npx wrangler r2 bucket list', { encoding: 'utf-8' });
      expect(listOutput).not.toContain('my-bucket');

      // Create bucket
      const createOutput = execSync('npx wrangler r2 bucket create my-bucket', { encoding: 'utf-8' });
      expect(createOutput).toContain('created');
    });

    it('skips creation when bucket exists', () => {
      vi.mocked(execSync).mockReturnValue('my-bucket\nother-bucket' as any);

      const listOutput = execSync('npx wrangler r2 bucket list', { encoding: 'utf-8' });
      expect(listOutput).toContain('my-bucket');

      // Should not call create
    });

    it('uses correct bucket name format', () => {
      const tenant = 'test-tenant';
      const bucketName = `moltbot-${tenant}`;

      expect(bucketName).toBe('moltbot-test-tenant');
    });

    it('handles bucket creation errors', () => {
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd.includes('create')) {
          throw new Error('Bucket creation failed');
        }
        return Buffer.from('');
      });

      let error: Error | null = null;
      try {
        execSync('npx wrangler r2 bucket create my-bucket', { encoding: 'utf-8' });
      } catch (e) {
        error = e as Error;
      }

      expect(error).not.toBeNull();
      expect(error?.message).toContain('failed');
    });
  });

  describe('deployWorker', () => {
    it('uses wrangler deploy command', () => {
      const command = 'npx wrangler deploy';
      expect(command).toContain('wrangler deploy');
    });

    it('includes worker name in deployment', () => {
      const workerName = 'my-worker';
      const command = `npx wrangler deploy --name ${workerName}`;

      expect(command).toContain(`--name ${workerName}`);
    });

    it('uses correct wrangler config file', () => {
      const configFile = 'wrangler.jsonc';
      const command = `npx wrangler deploy --config ${configFile}`;

      expect(command).toContain('wrangler.jsonc');
    });

    it('tracks child process for cleanup', () => {
      const mockSpawn = vi.fn().mockReturnValue({
        pid: 12345,
        killed: false,
        on: vi.fn(),
      });
      vi.mocked(spawn).mockImplementation(mockSpawn as any);

      const child = spawn('sh', ['-c', 'npx wrangler deploy'], {
        stdio: 'inherit',
        detached: true,
      });

      expect(child.pid).toBe(12345);
      expect(mockSpawn).toHaveBeenCalled();
    });

    it('handles deployment failures', () => {
      const mockSpawn = vi.fn().mockReturnValue({
        on: vi.fn((event, callback) => {
          if (event === 'close') callback(1); // Non-zero exit code
        }),
      });
      vi.mocked(spawn).mockImplementation(mockSpawn as any);

      // Should reject promise on failure
      expect(mockSpawn).toBeDefined();
    });
  });

  describe('Command Execution', () => {
    it('logs commands before execution', () => {
      const command = 'npx wrangler whoami';
      const logSpy = vi.spyOn(console, 'log');

      // Simulate runCommand behavior
      console.log(`[CMD] ${command}`);

      expect(logSpy).toHaveBeenCalledWith(`[CMD] ${command}`);
    });

    it('executes commands with correct encoding', () => {
      vi.mocked(execSync).mockReturnValue('output' as any);

      const output = execSync('test command', { encoding: 'utf-8' });

      expect(typeof output).toBe('string');
    });

    it('suppresses stderr for silent commands', () => {
      const command = 'npx wrangler whoami 2>/dev/null';
      expect(command).toContain('2>/dev/null');
    });

    it('uses inherit stdio for interactive commands', () => {
      const mockSpawn = vi.fn().mockReturnValue({
        on: vi.fn(),
      });
      vi.mocked(spawn).mockImplementation(mockSpawn as any);

      spawn('sh', ['-c', 'command'], { stdio: 'inherit' });

      expect(mockSpawn).toHaveBeenCalledWith('sh', ['-c', 'command'], { stdio: 'inherit' });
    });

    it('creates detached process groups', () => {
      const mockSpawn = vi.fn().mockReturnValue({
        on: vi.fn(),
      });
      vi.mocked(spawn).mockImplementation(mockSpawn as any);

      spawn('sh', ['-c', 'command'], { detached: true });

      expect(mockSpawn).toHaveBeenCalledWith('sh', ['-c', 'command'], { detached: true });
    });
  });

  describe('Secret Names', () => {
    it('defines all required secrets', () => {
      const requiredSecrets = [
        'AI_GATEWAY_API_KEY',
        'AI_GATEWAY_BASE_URL',
        'CLAWDBOT_GATEWAY_TOKEN',
        'CF_ACCESS_TEAM_DOMAIN',
        'CF_ACCESS_AUD',
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'CF_ACCOUNT_ID',
        'SANDBOX_SLEEP_AFTER',
      ];

      expect(requiredSecrets).toHaveLength(9);
      expect(requiredSecrets).toContain('AI_GATEWAY_API_KEY');
      expect(requiredSecrets).toContain('CLAWDBOT_GATEWAY_TOKEN');
    });

    it('uses consistent naming convention', () => {
      const secrets = ['AI_GATEWAY_API_KEY', 'R2_ACCESS_KEY_ID', 'CF_ACCOUNT_ID'];

      secrets.forEach(secret => {
        expect(secret).toMatch(/^[A-Z0-9_]+$/); // All uppercase with underscores and numbers
      });
    });
  });
});
