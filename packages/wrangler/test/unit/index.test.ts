import { describe, it, expect } from 'vitest';

describe('@agentskillmania/wrangler', () => {
  it('should export without error', { timeout: 15_000 }, async () => {
    const mod = await import('../../src/index.js');
    expect(mod).toBeDefined();
  });
});
