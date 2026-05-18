import { describe, it, expect } from 'vitest';
import { CommandRegistry } from '../../../src/command/registry.js';
import type { CommandHandler } from '../../../src/command/types.js';

describe('CommandRegistry', () => {
  it('should register and resolve a handler by exact name', () => {
    const registry = new CommandRegistry();
    const handler: CommandHandler = {
      name: 'test',
      description: 'Test command',
      handler: async () => ({ success: true, message: 'ok' }),
    };

    registry.register(handler);
    const resolved = registry.resolve('test');

    expect(resolved).toBe(handler);
  });

  it('should resolve undefined for unknown command', () => {
    const registry = new CommandRegistry();
    const resolved = registry.resolve('unknown');

    expect(resolved).toBeUndefined();
  });

  it('should resolve case-insensitively', () => {
    const registry = new CommandRegistry();
    const handler: CommandHandler = {
      name: 'test',
      description: 'Test command',
      handler: async () => ({ success: true, message: 'ok' }),
    };

    registry.register(handler);

    expect(registry.resolve('TEST')).toBe(handler);
    expect(registry.resolve('Test')).toBe(handler);
    expect(registry.resolve('test')).toBe(handler);
    expect(registry.resolve('TeSt')).toBe(handler);
  });

  it('should allow later registration to override earlier', () => {
    const registry = new CommandRegistry();
    const handler1: CommandHandler = {
      name: 'test',
      description: 'Built-in test command',
      handler: async () => ({ success: true, message: 'built-in' }),
    };
    const handler2: CommandHandler = {
      name: 'test',
      description: 'Custom test command',
      handler: async () => ({ success: true, message: 'custom' }),
    };

    registry.register(handler1);
    registry.register(handler2);

    const resolved = registry.resolve('test');
    expect(resolved).toBe(handler2);
    expect(resolved).not.toBe(handler1);
  });

  it('should return all registered handlers via list()', () => {
    const registry = new CommandRegistry();
    const handler1: CommandHandler = {
      name: 'cmd1',
      description: 'Command 1',
      handler: async () => ({ success: true, message: 'ok' }),
    };
    const handler2: CommandHandler = {
      name: 'cmd2',
      description: 'Command 2',
      handler: async () => ({ success: true, message: 'ok' }),
    };
    const handler3: CommandHandler = {
      name: 'cmd3',
      description: 'Command 3',
      handler: async () => ({ success: true, message: 'ok' }),
    };

    registry.register(handler1);
    registry.register(handler2);
    registry.register(handler3);

    const handlers = registry.list();
    expect(handlers).toHaveLength(3);
    expect(handlers).toContain(handler1);
    expect(handlers).toContain(handler2);
    expect(handlers).toContain(handler3);
  });

  it('should replace handler when registering same name twice', () => {
    const registry = new CommandRegistry();
    const handler1: CommandHandler = {
      name: 'duplicate',
      description: 'First handler',
      handler: async () => ({ success: true, message: 'first' }),
    };
    const handler2: CommandHandler = {
      name: 'duplicate',
      description: 'Second handler',
      handler: async () => ({ success: true, message: 'second' }),
    };

    registry.register(handler1);
    registry.register(handler2);

    // Should only have one handler in the list
    const handlers = registry.list();
    expect(handlers).toHaveLength(1);

    // The resolved handler should be the second one
    const resolved = registry.resolve('duplicate');
    expect(resolved).toBe(handler2);
    expect(resolved?.description).toBe('Second handler');
  });
});
