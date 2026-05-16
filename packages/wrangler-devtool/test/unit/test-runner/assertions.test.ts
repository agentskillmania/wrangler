import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
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

describe('evaluateAssertion', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wrangler-assert-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('output_contains', () => {
    it('should pass when output contains value', () => {
      const assertion: HardAssertion = { type: 'output_contains', value: 'hello' };
      const output = makeOutput({ answer: 'hello world' });
      const result = evaluateAssertion(assertion, output, tempDir);
      expect(result.passed).toBe(true);
      expect(result.message).toContain('contains');
    });

    it('should fail when output does not contain value', () => {
      const assertion: HardAssertion = { type: 'output_contains', value: 'goodbye' };
      const output = makeOutput({ answer: 'hello world' });
      const result = evaluateAssertion(assertion, output, tempDir);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('goodbye');
    });
  });

  describe('output_not_contains', () => {
    it('should pass when output does not contain value', () => {
      const assertion: HardAssertion = { type: 'output_not_contains', value: 'error' };
      const output = makeOutput({ answer: 'success' });
      const result = evaluateAssertion(assertion, output, tempDir);
      expect(result.passed).toBe(true);
    });

    it('should fail when output contains value', () => {
      const assertion: HardAssertion = { type: 'output_not_contains', value: 'error' };
      const output = makeOutput({ answer: 'an error occurred' });
      const result = evaluateAssertion(assertion, output, tempDir);
      expect(result.passed).toBe(false);
    });
  });

  describe('output_matches', () => {
    it('should pass when output matches pattern', () => {
      const assertion: HardAssertion = { type: 'output_matches', pattern: '^hello' };
      const output = makeOutput({ answer: 'hello world' });
      const result = evaluateAssertion(assertion, output, tempDir);
      expect(result.passed).toBe(true);
    });

    it('should fail when output does not match pattern', () => {
      const assertion: HardAssertion = { type: 'output_matches', pattern: '^goodbye' };
      const output = makeOutput({ answer: 'hello world' });
      const result = evaluateAssertion(assertion, output, tempDir);
      expect(result.passed).toBe(false);
    });

    it('should fail for invalid regex', () => {
      const assertion: HardAssertion = { type: 'output_matches', pattern: '[invalid' };
      const output = makeOutput({ answer: 'hello' });
      const result = evaluateAssertion(assertion, output, tempDir);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Invalid regex');
    });
  });

  describe('tool_called', () => {
    it('should pass when tool was called', () => {
      const assertion: HardAssertion = { type: 'tool_called', tool: 'shell' };
      const output = makeOutput({
        toolCalls: [{ name: 'shell', args: { command: 'ls' } }],
      });
      const result = evaluateAssertion(assertion, output, tempDir);
      expect(result.passed).toBe(true);
    });

    it('should fail when tool was not called', () => {
      const assertion: HardAssertion = { type: 'tool_called', tool: 'shell' };
      const output = makeOutput({ toolCalls: [{ name: 'file-read', args: {} }] });
      const result = evaluateAssertion(assertion, output, tempDir);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('shell');
    });
  });

  describe('tool_not_called', () => {
    it('should pass when tool was not called', () => {
      const assertion: HardAssertion = { type: 'tool_not_called', tool: 'delete' };
      const output = makeOutput({ toolCalls: [{ name: 'shell', args: {} }] });
      const result = evaluateAssertion(assertion, output, tempDir);
      expect(result.passed).toBe(true);
    });

    it('should fail when tool was called', () => {
      const assertion: HardAssertion = { type: 'tool_not_called', tool: 'shell' };
      const output = makeOutput({ toolCalls: [{ name: 'shell', args: {} }] });
      const result = evaluateAssertion(assertion, output, tempDir);
      expect(result.passed).toBe(false);
    });
  });

  describe('tool_called_with', () => {
    it('should pass when tool called with matching args', () => {
      const assertion: HardAssertion = {
        type: 'tool_called_with',
        tool: 'shell',
        withArgs: { command: 'ls' },
      };
      const output = makeOutput({
        toolCalls: [{ name: 'shell', args: { command: 'ls' } }],
      });
      const result = evaluateAssertion(assertion, output, tempDir);
      expect(result.passed).toBe(true);
    });

    it('should fail when tool called with different args', () => {
      const assertion: HardAssertion = {
        type: 'tool_called_with',
        tool: 'shell',
        withArgs: { command: 'ls' },
      };
      const output = makeOutput({
        toolCalls: [{ name: 'shell', args: { command: 'pwd' } }],
      });
      const result = evaluateAssertion(assertion, output, tempDir);
      expect(result.passed).toBe(false);
    });

    it('should fail when tool was not called at all', () => {
      const assertion: HardAssertion = {
        type: 'tool_called_with',
        tool: 'shell',
        withArgs: { command: 'ls' },
      };
      const output = makeOutput({ toolCalls: [] });
      const result = evaluateAssertion(assertion, output, tempDir);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('not called at all');
    });

    it('should match partial args', () => {
      const assertion: HardAssertion = {
        type: 'tool_called_with',
        tool: 'shell',
        withArgs: { command: 'ls' },
      };
      const output = makeOutput({
        toolCalls: [{ name: 'shell', args: { command: 'ls', dir: '/' } }],
      });
      const result = evaluateAssertion(assertion, output, tempDir);
      expect(result.passed).toBe(true);
    });
  });

  describe('file_exists', () => {
    it('should pass when file exists', () => {
      writeFileSync(join(tempDir, 'exists.txt'), 'hello', 'utf-8');
      const assertion: HardAssertion = { type: 'file_exists', path: 'exists.txt' };
      const output = makeOutput();
      const result = evaluateAssertion(assertion, output, tempDir);
      expect(result.passed).toBe(true);
    });

    it('should fail when file does not exist', () => {
      const assertion: HardAssertion = { type: 'file_exists', path: 'missing.txt' };
      const output = makeOutput();
      const result = evaluateAssertion(assertion, output, tempDir);
      expect(result.passed).toBe(false);
    });

    it('should pass when file exists and contains expected content', () => {
      writeFileSync(join(tempDir, 'data.txt'), 'hello world', 'utf-8');
      const assertion: HardAssertion = {
        type: 'file_exists',
        path: 'data.txt',
        contentContains: 'world',
      };
      const output = makeOutput();
      const result = evaluateAssertion(assertion, output, tempDir);
      expect(result.passed).toBe(true);
    });

    it('should fail when file exists but does not contain expected content', () => {
      writeFileSync(join(tempDir, 'data.txt'), 'hello world', 'utf-8');
      const assertion: HardAssertion = {
        type: 'file_exists',
        path: 'data.txt',
        contentContains: 'goodbye',
      };
      const output = makeOutput();
      const result = evaluateAssertion(assertion, output, tempDir);
      expect(result.passed).toBe(false);
    });
  });

  describe('file_not_exists', () => {
    it('should pass when file does not exist', () => {
      const assertion: HardAssertion = { type: 'file_not_exists', path: 'missing.txt' };
      const output = makeOutput();
      const result = evaluateAssertion(assertion, output, tempDir);
      expect(result.passed).toBe(true);
    });

    it('should fail when file exists', () => {
      writeFileSync(join(tempDir, 'exists.txt'), 'hello', 'utf-8');
      const assertion: HardAssertion = { type: 'file_not_exists', path: 'exists.txt' };
      const output = makeOutput();
      const result = evaluateAssertion(assertion, output, tempDir);
      expect(result.passed).toBe(false);
    });
  });

  describe('exit_code', () => {
    it('should pass when success result matches 0', () => {
      const assertion: HardAssertion = { type: 'exit_code', value: '0' };
      const output = makeOutput({ resultType: 'success' });
      const result = evaluateAssertion(assertion, output, tempDir);
      expect(result.passed).toBe(true);
    });

    it('should fail when success result does not match 1', () => {
      const assertion: HardAssertion = { type: 'exit_code', value: '1' };
      const output = makeOutput({ resultType: 'success' });
      const result = evaluateAssertion(assertion, output, tempDir);
      expect(result.passed).toBe(false);
    });

    it('should pass when error result matches 1', () => {
      const assertion: HardAssertion = { type: 'exit_code', value: '1' };
      const output = makeOutput({ resultType: 'error' });
      const result = evaluateAssertion(assertion, output, tempDir);
      expect(result.passed).toBe(true);
    });

    it('should pass when max_steps result matches 1', () => {
      const assertion: HardAssertion = { type: 'exit_code', value: '1' };
      const output = makeOutput({ resultType: 'max_steps' });
      const result = evaluateAssertion(assertion, output, tempDir);
      expect(result.passed).toBe(true);
    });
  });
});
