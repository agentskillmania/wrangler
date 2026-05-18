import { describe, it, expect } from 'vitest';

const TEST_TIMEOUT = 30000;

describe('@agentskillmania/wrangler-devtool', () => {
  it(
    'should export public API',
    async () => {
      const mod = await import('../../src/index.js');
      expect(mod).toBeDefined();
      expect(typeof mod.initWorkspace).toBe('function');
      expect(typeof mod.createTemplate).toBe('function');
      expect(typeof mod.forkSession).toBe('function');
      expect(typeof mod.listSessions).toBe('function');
      expect(typeof mod.applyChanges).toBe('function');
      expect(typeof mod.ExitCode).toBe('object');
      expect(typeof mod.CliError).toBe('function');
      expect(typeof mod.runTests).toBe('function');
      expect(typeof mod.TestRunner).toBe('function');
      expect(typeof mod.evaluateAssertion).toBe('function');
      expect(typeof mod.loadTestCases).toBe('function');
      expect(typeof mod.loadTestFile).toBe('function');
      expect(typeof mod.discoverTestFiles).toBe('function');
      expect(typeof mod.printReport).toBe('function');
      expect(typeof mod.formatReport).toBe('function');
    },
    TEST_TIMEOUT
  );
});
