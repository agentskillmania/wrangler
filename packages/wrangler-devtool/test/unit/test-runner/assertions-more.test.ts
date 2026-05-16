import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluateAssertion } from '../../../src/test-runner/assertions.js';
import type { HardAssertion, AgentRunOutput } from '../../../src/test-runner/types.js';

function makeOutput(overrides: Partial<AgentRunOutput> = {}): AgentRunOutput {
  return {
    answer: '',
    toolCalls: [],
    resultType: 'success',
    totalSteps: 1,
    ...overrides,
  };
}

describe('evaluateAssertion edge cases', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wrangler-assert-edge-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should handle file read error in file_exists', () => {
    // Create a directory with the name, so readFileSync fails
    mkdirSync(join(tempDir, 'is-dir'));
    const assertion: HardAssertion = {
      type: 'file_exists',
      path: 'is-dir',
      contentContains: 'test',
    };
    const output = makeOutput();
    const result = evaluateAssertion(assertion, output, tempDir);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('could not be read');
  });

  it('should handle unknown assertion type gracefully', () => {
    const assertion = { type: 'unknown_type' } as unknown as HardAssertion;
    const output = makeOutput();
    const result = evaluateAssertion(assertion, output, tempDir);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('Unknown assertion type');
  });

  it('should handle exit_code with unexpected resultType', () => {
    const assertion: HardAssertion = { type: 'exit_code', value: '0' };
    const output = makeOutput({ resultType: 'unexpected' as 'success' });
    const result = evaluateAssertion(assertion, output, tempDir);
    expect(result.passed).toBe(false);
  });
});
