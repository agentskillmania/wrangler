import { describe, it, expect, vi } from 'vitest';
import { defineCommand, runCli } from '../../../src/cli/framework.js';
import { CliError, ExitCode } from '../../../src/cli/options.js';

describe('defineCommand', () => {
  it('should return the command definition', () => {
    const cmd = defineCommand({
      name: 'test',
      description: 'Test command',
      handler: async () => ExitCode.Success,
    });
    expect(cmd.name).toBe('test');
    expect(cmd.description).toBe('Test command');
  });
});

describe('runCli', () => {
  it('should show help for empty argv', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await runCli({}, []);
    expect(code).toBe(ExitCode.Success);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Commands:'));
    logSpy.mockRestore();
  });

  it('should show root help with commands', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const commands = {
      a: defineCommand({ name: 'a', description: 'A', handler: async () => 0 }),
    };
    const code = await runCli(commands, []);
    expect(code).toBe(ExitCode.Success);
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain('a');
    expect(output).toContain('A');
    logSpy.mockRestore();
  });

  it('should show help for command with options', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const commands = {
      test: defineCommand({
        name: 'test',
        description: 'Test',
        options: {
          mode: { type: 'string', required: true, description: 'The mode' },
        },
        handler: async () => ExitCode.Success,
      }),
    };
    const code = await runCli(commands, ['test', '--help']);
    expect(code).toBe(ExitCode.Success);
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain('Options:');
    expect(output).toContain('--mode');
    expect(output).toContain('(required)');
    logSpy.mockRestore();
  });

  it('should route to handler', async () => {
    const handler = vi.fn().mockResolvedValue(ExitCode.Success);
    const commands = {
      test: defineCommand({
        name: 'test',
        description: 'Test',
        handler,
      }),
    };
    const code = await runCli(commands, ['test']);
    expect(code).toBe(ExitCode.Success);
    expect(handler).toHaveBeenCalledWith([], {});
  });

  it('should parse string options', async () => {
    const handler = vi.fn().mockResolvedValue(ExitCode.Success);
    const commands = {
      test: defineCommand({
        name: 'test',
        description: 'Test',
        options: {
          mode: { type: 'string', required: true },
        },
        handler,
      }),
    };
    await runCli(commands, ['test', '--mode', 'agent']);
    expect(handler).toHaveBeenCalledWith([], { mode: 'agent' });
  });

  it('should parse options with equals sign', async () => {
    const handler = vi.fn().mockResolvedValue(ExitCode.Success);
    const commands = {
      test: defineCommand({
        name: 'test',
        description: 'Test',
        options: {
          mode: { type: 'string' },
        },
        handler,
      }),
    };
    await runCli(commands, ['test', '--mode=crew']);
    expect(handler).toHaveBeenCalledWith([], { mode: 'crew' });
  });

  it('should validate required options', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const commands = {
      test: defineCommand({
        name: 'test',
        description: 'Test',
        options: {
          mode: { type: 'string', required: true },
        },
        handler: async () => ExitCode.Success,
      }),
    };
    const code = await runCli(commands, ['test']);
    expect(code).toBe(ExitCode.GeneralError);
    errorSpy.mockRestore();
  });

  it('should show subcommand help when no handler', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const commands = {
      test: defineCommand({
        name: 'test',
        description: 'Test',
        subcommands: {
          sub: defineCommand({
            name: 'sub',
            description: 'Subcommand',
            handler: async () => ExitCode.Success,
          }),
        },
      }),
    };
    const code = await runCli(commands, ['test']);
    expect(code).toBe(ExitCode.Success);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Subcommands:'));
    logSpy.mockRestore();
  });

  it('should handle --help on command', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const commands = {
      test: defineCommand({
        name: 'test',
        description: 'Test',
        handler: async () => ExitCode.Success,
      }),
    };
    const code = await runCli(commands, ['test', '--help']);
    expect(code).toBe(ExitCode.Success);
    logSpy.mockRestore();
  });

  it('should return unknown command error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await runCli({}, ['unknown']);
    expect(code).toBe(ExitCode.GeneralError);
    errorSpy.mockRestore();
  });

  it('should handle boolean options with --no- prefix', async () => {
    const handler = vi.fn().mockResolvedValue(ExitCode.Success);
    const commands = {
      test: defineCommand({
        name: 'test',
        description: 'Test',
        options: {
          dryRun: { type: 'boolean', default: true },
        },
        handler,
      }),
    };
    await runCli(commands, ['test', '--no-dry-run']);
    expect(handler).toHaveBeenCalledWith([], { dryRun: false });
  });

  it('should handle number options', async () => {
    const handler = vi.fn().mockResolvedValue(ExitCode.Success);
    const commands = {
      test: defineCommand({
        name: 'test',
        description: 'Test',
        options: {
          count: { type: 'number' },
        },
        handler,
      }),
    };
    await runCli(commands, ['test', '--count', '42']);
    expect(handler).toHaveBeenCalledWith([], { count: 42 });
  });

  it('should reject non-number for number option', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const commands = {
      test: defineCommand({
        name: 'test',
        description: 'Test',
        options: {
          count: { type: 'number' },
        },
        handler: async () => ExitCode.Success,
      }),
    };
    const code = await runCli(commands, ['test', '--count', 'abc']);
    expect(code).toBe(ExitCode.GeneralError);
    errorSpy.mockRestore();
  });

  it('should handle single-dash options', async () => {
    const handler = vi.fn().mockResolvedValue(ExitCode.Success);
    const commands = {
      test: defineCommand({
        name: 'test',
        description: 'Test',
        options: {
          f: { type: 'string' },
        },
        handler,
      }),
    };
    await runCli(commands, ['test', '-f', 'value']);
    expect(handler).toHaveBeenCalledWith([], { f: 'value' });
  });

  it('should handle positional args', async () => {
    const handler = vi.fn().mockResolvedValue(ExitCode.Success);
    const commands = {
      test: defineCommand({
        name: 'test',
        description: 'Test',
        args: '<name>',
        handler,
      }),
    };
    await runCli(commands, ['test', 'myname']);
    expect(handler).toHaveBeenCalledWith(['myname'], {});
  });

  it('should error on missing required args', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const commands = {
      test: defineCommand({
        name: 'test',
        description: 'Test',
        args: '<name>',
        handler: async () => ExitCode.Success,
      }),
    };
    const code = await runCli(commands, ['test']);
    expect(code).toBe(ExitCode.GeneralError);
    errorSpy.mockRestore();
  });

  it('should error on too many args', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const commands = {
      test: defineCommand({
        name: 'test',
        description: 'Test',
        args: '<name>',
        handler: async () => ExitCode.Success,
      }),
    };
    const code = await runCli(commands, ['test', 'a', 'b']);
    expect(code).toBe(ExitCode.GeneralError);
    errorSpy.mockRestore();
  });

  it('should handle optional args', async () => {
    const handler = vi.fn().mockResolvedValue(ExitCode.Success);
    const commands = {
      test: defineCommand({
        name: 'test',
        description: 'Test',
        args: '[name]',
        handler,
      }),
    };
    await runCli(commands, ['test']);
    expect(handler).toHaveBeenCalledWith([], {});
    await runCli(commands, ['test', 'myname']);
    expect(handler).toHaveBeenCalledWith(['myname'], {});
  });

  it('should handle subcommands', async () => {
    const handler = vi.fn().mockResolvedValue(ExitCode.Success);
    const commands = {
      parent: defineCommand({
        name: 'parent',
        description: 'Parent',
        subcommands: {
          child: defineCommand({
            name: 'child',
            description: 'Child',
            handler,
          }),
        },
      }),
    };
    const code = await runCli(commands, ['parent', 'child']);
    expect(code).toBe(ExitCode.Success);
    expect(handler).toHaveBeenCalledWith([], {});
  });

  it('should pass through CliError with custom exit code', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const commands = {
      test: defineCommand({
        name: 'test',
        description: 'Test',
        handler: async () => {
          throw new CliError('Custom error', 'CUSTOM', ExitCode.ConfigError);
        },
      }),
    };
    const code = await runCli(commands, ['test']);
    expect(code).toBe(ExitCode.ConfigError);
    errorSpy.mockRestore();
  });

  it('should pass through unknown errors', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const commands = {
      test: defineCommand({
        name: 'test',
        description: 'Test',
        handler: async () => {
          throw new Error('Unexpected');
        },
      }),
    };
    const code = await runCli(commands, ['test']);
    expect(code).toBe(ExitCode.GeneralError);
    errorSpy.mockRestore();
  });

  it('should reject unknown options', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const commands = {
      test: defineCommand({
        name: 'test',
        description: 'Test',
        options: {
          known: { type: 'string' },
        },
        handler: async () => ExitCode.Success,
      }),
    };
    const code = await runCli(commands, ['test', '--unknown', 'val']);
    expect(code).toBe(ExitCode.GeneralError);
    errorSpy.mockRestore();
  });

  it('should use default option values', async () => {
    const handler = vi.fn().mockResolvedValue(ExitCode.Success);
    const commands = {
      test: defineCommand({
        name: 'test',
        description: 'Test',
        options: {
          mode: { type: 'string', default: 'agent' },
        },
        handler,
      }),
    };
    await runCli(commands, ['test']);
    expect(handler).toHaveBeenCalledWith([], { mode: 'agent' });
  });

  it('should handle -- separator', async () => {
    const handler = vi.fn().mockResolvedValue(ExitCode.Success);
    const commands = {
      test: defineCommand({
        name: 'test',
        description: 'Test',
        args: '<arg>',
        handler,
      }),
    };
    await runCli(commands, ['test', '--', '--not-a-flag']);
    expect(handler).toHaveBeenCalledWith(['--not-a-flag'], {});
  });
});
