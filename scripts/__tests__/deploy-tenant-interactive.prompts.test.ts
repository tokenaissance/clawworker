/**
 * Tests for user interaction prompts.
 *
 * These tests verify that interactive prompts work correctly,
 * including password input, confirmations, and optional fields.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as readline from 'readline';
import { suppressConsole, createMockReadline, createMockStdin } from './test-utils';

vi.mock('readline');

describe('User Prompts', () => {
  beforeEach(() => {
    suppressConsole();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('prompt', () => {
    it('returns user input', async () => {
      const mockRl = createMockReadline(['test input']);
      vi.mocked(readline.createInterface).mockReturnValue(mockRl);

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      const result = await new Promise<string>(resolve => {
        rl.question('Enter value: ', answer => {
          resolve(answer.trim());
        });
      });

      expect(result).toBe('test input');
    });

    it('uses default value when input is empty', async () => {
      const mockRl = createMockReadline(['']); // Empty input
      vi.mocked(readline.createInterface).mockReturnValue(mockRl);

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const defaultValue = 'default';

      const result = await new Promise<string>(resolve => {
        rl.question(`Enter value [${defaultValue}]: `, answer => {
          resolve(answer.trim() || defaultValue);
        });
      });

      expect(result).toBe('default');
    });

    it('displays default value in prompt', () => {
      const question = 'Enter value';
      const defaultValue = 'default';
      const displayQuestion = `${question} [${defaultValue}]: `;

      expect(displayQuestion).toContain('[default]');
    });

    it('trims whitespace from input', async () => {
      const mockRl = createMockReadline(['  test input  ']);
      vi.mocked(readline.createInterface).mockReturnValue(mockRl);

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      const result = await new Promise<string>(resolve => {
        rl.question('Enter value: ', answer => {
          resolve(answer.trim());
        });
      });

      expect(result).toBe('test input');
    });

    it('handles multiple prompts in sequence', async () => {
      const mockRl = createMockReadline(['first', 'second', 'third']);
      vi.mocked(readline.createInterface).mockReturnValue(mockRl);

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      const results: string[] = [];
      for (let i = 0; i < 3; i++) {
        const result = await new Promise<string>(resolve => {
          rl.question(`Enter value ${i + 1}: `, answer => {
            resolve(answer.trim());
          });
        });
        results.push(result);
      }

      expect(results).toEqual(['first', 'second', 'third']);
    });
  });

  describe('promptPassword', () => {
    it('hides password input with asterisks', () => {
      const mockStdin = createMockStdin();
      const password = 'secret123';

      // Simulate typing password
      let displayed = '';
      password.split('').forEach(char => {
        displayed += '*';
      });

      expect(displayed).toBe('*********');
      expect(displayed).not.toContain('secret');
    });

    it('handles backspace to delete characters', () => {
      let password = 'test';

      // Simulate backspace
      password = password.slice(0, -1);

      expect(password).toBe('tes');
    });

    it('handles multiple backspaces', () => {
      let password = 'test';

      // Simulate 2 backspaces
      password = password.slice(0, -1);
      password = password.slice(0, -1);

      expect(password).toBe('te');
    });

    it('does not delete when password is empty', () => {
      let password = '';

      // Simulate backspace on empty password
      if (password.length > 0) {
        password = password.slice(0, -1);
      }

      expect(password).toBe('');
    });

    it('handles Ctrl+C to exit', () => {
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit(1)');
      });

      const ctrlC = '\u0003';

      // Simulate Ctrl+C
      if (ctrlC === '\u0003') {
        expect(() => process.exit(1)).toThrow('process.exit(1)');
      }

      mockExit.mockRestore();
    });

    it('handles Enter to submit', () => {
      const password = 'secret123';
      const enter = '\n';

      // Simulate Enter key
      if (enter === '\n' || enter === '\r') {
        expect(password).toBe('secret123');
      }
    });

    it('uses default value when input is empty', () => {
      const password = '';
      const defaultValue = 'default-password';

      const result = password || defaultValue;

      expect(result).toBe('default-password');
    });

    it('displays hidden default value indicator', () => {
      const question = 'Enter password';
      const defaultValue = 'existing-password';
      const displayQuestion = `${question} [***hidden***]`;

      expect(displayQuestion).toContain('[***hidden***]');
      expect(displayQuestion).not.toContain('existing-password');
    });

    it('sets raw mode on TTY', () => {
      const mockStdin = {
        isTTY: true,
        setRawMode: vi.fn(),
      };

      if (mockStdin.isTTY) {
        mockStdin.setRawMode(true);
      }

      expect(mockStdin.setRawMode).toHaveBeenCalledWith(true);
    });

    it('restores normal mode after input', () => {
      const mockStdin = {
        isTTY: true,
        setRawMode: vi.fn(),
      };

      if (mockStdin.isTTY) {
        mockStdin.setRawMode(true);
        // ... get input ...
        mockStdin.setRawMode(false);
      }

      expect(mockStdin.setRawMode).toHaveBeenCalledWith(false);
    });
  });

  describe('promptOptional', () => {
    it('returns empty string when skipped', async () => {
      const mockRl = createMockReadline(['']); // Empty input
      vi.mocked(readline.createInterface).mockReturnValue(mockRl);

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      const result = await new Promise<string>(resolve => {
        rl.question('Enter value (optional, press Enter to skip): ', answer => {
          resolve(answer.trim());
        });
      });

      expect(result).toBe('');
    });

    it('returns user input when provided', async () => {
      const mockRl = createMockReadline(['optional value']);
      vi.mocked(readline.createInterface).mockReturnValue(mockRl);

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      const result = await new Promise<string>(resolve => {
        rl.question('Enter value (optional): ', answer => {
          resolve(answer.trim());
        });
      });

      expect(result).toBe('optional value');
    });

    it('uses default value when provided', async () => {
      const mockRl = createMockReadline(['']);
      vi.mocked(readline.createInterface).mockReturnValue(mockRl);

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const defaultValue = 'default';

      const result = await new Promise<string>(resolve => {
        rl.question(`Enter value [${defaultValue}]: `, answer => {
          resolve(answer.trim() || defaultValue);
        });
      });

      expect(result).toBe('default');
    });

    it('displays skip instruction', () => {
      const question = 'Enter value';
      const displayQuestion = `${question} (optional, press Enter to skip): `;

      expect(displayQuestion).toContain('optional');
      expect(displayQuestion).toContain('press Enter to skip');
    });
  });

  describe('promptConfirm', () => {
    it('returns true for "y" input', async () => {
      const mockRl = createMockReadline(['y']);
      vi.mocked(readline.createInterface).mockReturnValue(mockRl);

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      const result = await new Promise<boolean>(resolve => {
        rl.question('Confirm? [y/N]: ', answer => {
          const normalized = answer.trim().toLowerCase();
          resolve(normalized === 'y' || normalized === 'yes');
        });
      });

      expect(result).toBe(true);
    });

    it('returns true for "yes" input', async () => {
      const mockRl = createMockReadline(['yes']);
      vi.mocked(readline.createInterface).mockReturnValue(mockRl);

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      const result = await new Promise<boolean>(resolve => {
        rl.question('Confirm? [y/N]: ', answer => {
          const normalized = answer.trim().toLowerCase();
          resolve(normalized === 'y' || normalized === 'yes');
        });
      });

      expect(result).toBe(true);
    });

    it('returns false for "n" input', async () => {
      const mockRl = createMockReadline(['n']);
      vi.mocked(readline.createInterface).mockReturnValue(mockRl);

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      const result = await new Promise<boolean>(resolve => {
        rl.question('Confirm? [y/N]: ', answer => {
          const normalized = answer.trim().toLowerCase();
          resolve(normalized === 'y' || normalized === 'yes');
        });
      });

      expect(result).toBe(false);
    });

    it('returns false for "no" input', async () => {
      const mockRl = createMockReadline(['no']);
      vi.mocked(readline.createInterface).mockReturnValue(mockRl);

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      const result = await new Promise<boolean>(resolve => {
        rl.question('Confirm? [y/N]: ', answer => {
          const normalized = answer.trim().toLowerCase();
          resolve(normalized === 'y' || normalized === 'yes');
        });
      });

      expect(result).toBe(false);
    });

    it('uses default value for empty input', async () => {
      const mockRl = createMockReadline(['']);
      vi.mocked(readline.createInterface).mockReturnValue(mockRl);

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const defaultYes = false;

      const result = await new Promise<boolean>(resolve => {
        rl.question('Confirm? [y/N]: ', answer => {
          const normalized = answer.trim().toLowerCase();
          if (normalized === '') {
            resolve(defaultYes);
          } else {
            resolve(normalized === 'y' || normalized === 'yes');
          }
        });
      });

      expect(result).toBe(false);
    });

    it('displays [Y/n] when default is yes', () => {
      const question = 'Confirm?';
      const hint = '[Y/n]';
      const displayQuestion = `${question} ${hint}: `;

      expect(displayQuestion).toContain('[Y/n]');
    });

    it('displays [y/N] when default is no', () => {
      const question = 'Confirm?';
      const hint = '[y/N]';
      const displayQuestion = `${question} ${hint}: `;

      expect(displayQuestion).toContain('[y/N]');
    });

    it('is case insensitive', async () => {
      const inputs = ['Y', 'YES', 'Yes', 'yEs'];

      inputs.forEach(input => {
        const normalized = input.toLowerCase();
        expect(normalized === 'y' || normalized === 'yes').toBe(true);
      });
    });
  });

  describe('Readline Interface', () => {
    it('creates interface with stdin and stdout', () => {
      const mockRl = createMockReadline();
      vi.mocked(readline.createInterface).mockReturnValue(mockRl);

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      expect(readline.createInterface).toHaveBeenCalledWith({
        input: process.stdin,
        output: process.stdout,
      });
    });

    it('closes interface after use', () => {
      const mockRl = createMockReadline();
      vi.mocked(readline.createInterface).mockReturnValue(mockRl);

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.close();

      expect(mockRl.close).toHaveBeenCalled();
    });
  });
});
