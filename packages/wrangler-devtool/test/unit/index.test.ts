import { describe, it, expect } from 'vitest';

describe('@agentskillmania/wrangler-devtool', () => {
  it('should export public API', async () => {
    const mod = await import('../../src/index.js');
    expect(mod).toBeDefined();
    expect(typeof mod.initWorkspace).toBe('function');
    expect(typeof mod.createTemplate).toBe('function');
    expect(typeof mod.forkSession).toBe('function');
    expect(typeof mod.listSessions).toBe('function');
    expect(typeof mod.applyChanges).toBe('function');
    expect(typeof mod.ExitCode).toBe('object');
    expect(typeof mod.CliError).toBe('function');
  });
});
