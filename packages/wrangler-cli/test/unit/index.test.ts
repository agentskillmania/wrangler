import { describe, it, expect } from 'vitest';

describe('@agentskillmania/wrangler-cli', () => {
  it('should export without error', async () => {
    const mod = await import('../../src/index.js');
    expect(mod).toBeDefined();
  });
});
