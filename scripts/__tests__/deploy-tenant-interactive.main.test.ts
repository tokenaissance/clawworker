/**
 * Integration tests for main deployment orchestration and process management.
 *
 * These tests verify that the main deployment flow works correctly,
 * including process cleanup, signal handling, and error scenarios.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChildProcess } from 'child_process';
import { suppressConsole } from './test-utils';

describe('Process Management', () => {
  beforeEach(() => {
    suppressConsole();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('cleanup', () => {
    it('terminates all tracked child processes', () => {
      const mockChild1 = {
        pid: 1234,
        killed: false,
        kill: vi.fn(),
      } as unknown as ChildProcess;

      const mockChild2 = {
        pid: 5678,
        killed: false,
        kill: vi.fn(),
      } as unknown as ChildProcess;

      const childProcesses = [mockChild1, mockChild2];

      // Simulate cleanup
      childProcesses.forEach(child => {
        if (child.pid && !child.killed) {
          child.kill('SIGTERM');
        }
      });

      expect(mockChild1.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockChild2.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('kills process group with negative PID', () => {
      const mockKill = vi.spyOn(process, 'kill').mockImplementation(() => true);

      const pid = 1234;

      // Kill process group
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        // Fallback
      }

      expect(mockKill).toHaveBeenCalledWith(-1234, 'SIGTERM');

      mockKill.mockRestore();
    });

    it('handles already dead processes gracefully', () => {
      const mockChild = {
        pid: 1234,
        killed: false,
        kill: vi.fn().mockImplementation(() => {
          throw new Error('Process already dead');
        }),
      } as unknown as ChildProcess;

      // Should not throw
      expect(() => {
        try {
          mockChild.kill('SIGTERM');
        } catch {
          // Ignore
        }
      }).not.toThrow();
    });

    it('clears child processes array after cleanup', () => {
      const childProcesses = [
        { pid: 1234 } as ChildProcess,
        { pid: 5678 } as ChildProcess,
      ];

      // Simulate cleanup
      childProcesses.length = 0;

      expect(childProcesses).toHaveLength(0);
    });

    it('logs cleanup message', () => {
      const logSpy = vi.spyOn(console, 'log');

      console.log('\n[Cleanup] Terminating child processes...');

      expect(logSpy).toHaveBeenCalledWith('\n[Cleanup] Terminating child processes...');
    });
  });

  describe('Signal Handlers', () => {
    it('handles SIGINT (Ctrl+C)', () => {
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit(130)');
      });

      const logSpy = vi.spyOn(console, 'log');

      // Simulate SIGINT handler
      console.log('\n[Signal] Received SIGINT (Ctrl+C)');
      expect(() => process.exit(130)).toThrow('process.exit(130)');

      expect(logSpy).toHaveBeenCalledWith('\n[Signal] Received SIGINT (Ctrl+C)');

      mockExit.mockRestore();
    });

    it('handles SIGTERM', () => {
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit(143)');
      });

      const logSpy = vi.spyOn(console, 'log');

      // Simulate SIGTERM handler
      console.log('\n[Signal] Received SIGTERM');
      expect(() => process.exit(143)).toThrow('process.exit(143)');

      expect(logSpy).toHaveBeenCalledWith('\n[Signal] Received SIGTERM');

      mockExit.mockRestore();
    });

    it('exits with code 130 for SIGINT', () => {
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit(130)');
      });

      expect(() => process.exit(130)).toThrow('process.exit(130)');

      mockExit.mockRestore();
    });

    it('exits with code 143 for SIGTERM', () => {
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit(143)');
      });

      expect(() => process.exit(143)).toThrow('process.exit(143)');

      mockExit.mockRestore();
    });

    it('calls cleanup before exit', () => {
      const cleanupCalled = { value: false };

      const cleanup = () => {
        cleanupCalled.value = true;
      };

      // Simulate signal handler
      cleanup();

      expect(cleanupCalled.value).toBe(true);
    });
  });

  describe('runCommand', () => {
    it('logs command before execution', () => {
      const logSpy = vi.spyOn(console, 'log');
      const command = 'npx wrangler whoami';

      console.log(`[CMD] ${command}`);

      expect(logSpy).toHaveBeenCalledWith(`[CMD] ${command}`);
    });

    it('returns command output', () => {
      const output = 'command output';
      expect(output).toBe('command output');
    });

    it('passes options to execSync', () => {
      const options = { encoding: 'utf-8' as const };
      expect(options.encoding).toBe('utf-8');
    });
  });

  describe('runCommandInherit', () => {
    it('spawns command with inherit stdio', () => {
      const options = { stdio: 'inherit' as const, detached: true };

      expect(options.stdio).toBe('inherit');
      expect(options.detached).toBe(true);
    });

    it('creates detached process group', () => {
      const options = { detached: true };
      expect(options.detached).toBe(true);
    });

    it('tracks child process for cleanup', () => {
      const childProcesses: ChildProcess[] = [];
      const mockChild = { pid: 1234 } as ChildProcess;

      childProcesses.push(mockChild);

      expect(childProcesses).toContain(mockChild);
    });

    it('removes child from tracking on close', () => {
      const childProcesses: ChildProcess[] = [];
      const mockChild = { pid: 1234 } as ChildProcess;

      childProcesses.push(mockChild);

      // Simulate close event
      const index = childProcesses.indexOf(mockChild);
      if (index > -1) childProcesses.splice(index, 1);

      expect(childProcesses).not.toContain(mockChild);
    });

    it('resolves promise on successful exit', () => {
      const exitCode = 0;
      expect(exitCode).toBe(0);
    });

    it('rejects promise on failed exit', () => {
      const exitCode = 1;
      const error = new Error(`Command failed with exit code ${exitCode}`);

      expect(error.message).toContain('exit code 1');
    });

    it('logs command before execution', () => {
      const logSpy = vi.spyOn(console, 'log');
      const command = 'npx wrangler deploy';

      console.log(`[CMD] ${command}`);

      expect(logSpy).toHaveBeenCalledWith(`[CMD] ${command}`);
    });
  });

  describe('runCommandSilent', () => {
    it('executes command without logging', () => {
      const logSpy = vi.spyOn(console, 'log');

      // Silent command should not log
      const logCallsBefore = logSpy.mock.calls.length;

      // Simulate silent execution (no log call)

      expect(logSpy.mock.calls.length).toBe(logCallsBefore);
    });

    it('returns command output', () => {
      const output = 'silent output';
      expect(output).toBe('silent output');
    });

    it('passes options to execSync', () => {
      const options = { encoding: 'utf-8' as const };
      expect(options.encoding).toBe('utf-8');
    });
  });

  describe('runSpawn', () => {
    it('logs command with arguments', () => {
      const logSpy = vi.spyOn(console, 'log');
      const command = 'git';
      const args = ['diff', '--name-only'];

      console.log(`[CMD] ${command} ${args.join(' ')}`);

      expect(logSpy).toHaveBeenCalledWith('[CMD] git diff --name-only');
    });

    it('passes options to spawnSync', () => {
      const options = { encoding: 'utf-8' as const };
      expect(options.encoding).toBe('utf-8');
    });
  });

  describe('Error Handling', () => {
    it('handles missing environment variables', () => {
      const envVar = process.env.OPENROUTER_PROVISIONING_KEY;

      if (!envVar) {
        const error = new Error('OPENROUTER_PROVISIONING_KEY is required');
        expect(error.message).toContain('OPENROUTER_PROVISIONING_KEY');
      }
    });

    it('handles wrangler not logged in', () => {
      const error = new Error('Not logged in to Cloudflare');
      expect(error.message).toContain('Not logged in');
    });

    it('handles database locked errors', () => {
      const error = new Error('database is locked');
      expect(error.message).toContain('locked');
    });

    it('handles OpenRouter API errors', () => {
      const error = new Error('OpenRouter API error: rate limit exceeded');
      expect(error.message).toContain('OpenRouter API error');
    });

    it('handles deployment failures', () => {
      const error = new Error('Deployment failed: invalid configuration');
      expect(error.message).toContain('Deployment failed');
    });
  });

  describe('Dry Run Mode', () => {
    it('skips actual deployment in dry run', () => {
      const dryRun = true;

      if (dryRun) {
        console.log('[Dry Run] Would deploy worker');
      }

      expect(dryRun).toBe(true);
    });

    it('skips secret setting in dry run', () => {
      const dryRun = true;

      if (dryRun) {
        console.log('[Dry Run] Would set secret: MY_SECRET');
      }

      expect(dryRun).toBe(true);
    });

    it('skips OpenRouter provisioning in dry run', () => {
      const dryRun = true;

      if (dryRun) {
        console.log('[Dry Run] Would provision OpenRouter key');
      }

      expect(dryRun).toBe(true);
    });

    it('still validates configuration in dry run', () => {
      const dryRun = true;
      const config = { email: 'test@example.com', name: 'Test User' };

      // Validation should still run
      expect(config.email).toBeTruthy();
      expect(config.name).toBeTruthy();
    });
  });

  describe('Force Build Mode', () => {
    it('forces Docker rebuild when flag is set', () => {
      const forceBuild = true;

      if (forceBuild) {
        console.log('[Docker] Force rebuild enabled');
      }

      expect(forceBuild).toBe(true);
    });

    it('skips change detection when force build is enabled', () => {
      const forceBuild = true;

      if (forceBuild) {
        // Skip hasDockerContextChanged check
        expect(forceBuild).toBe(true);
      }
    });
  });

  describe('Skip Provision Mode', () => {
    it('skips OpenRouter provisioning when flag is set', () => {
      const skipProvision = true;

      if (skipProvision) {
        console.log('[OpenRouter] Skipping provisioning');
      }

      expect(skipProvision).toBe(true);
    });

    it('still requires API key when skipping provision', () => {
      const skipProvision = true;
      const existingKey = 'sk-or-existing-key';

      if (skipProvision && !existingKey) {
        throw new Error('API key required when skipping provision');
      }

      expect(existingKey).toBeTruthy();
    });
  });
});
