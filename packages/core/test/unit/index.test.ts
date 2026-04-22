import { describe, it, expect } from 'vitest';

describe('@agentskillmania/colts-workspace-core', () => {
  it('should export without error', async () => {
    const mod = await import('../../src/index.js');
    expect(mod).toBeDefined();
  });
});
