import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { DeterministicEvaluators } from '../../../src/eval/evaluators/deterministic.js';
import type { EvalTrace, EvaluatorSpec } from '../../../src/eval/types.js';

// ─── Helpers ────────────────────────────────────────────────

const evals = new DeterministicEvaluators();

let tempDir: string;

function makeTrace(overrides: Partial<EvalTrace> = {}): EvalTrace {
  return {
    caseName: 'test',
    sampleIndex: 0,
    input: 'test input',
    answer: 'Hello World',
    result: { type: 'success', answer: 'Hello World', totalSteps: 3, tokens: { input: 10, output: 5 } },
    toolCalls: [],
    steps: 3,
    duration: 1000,
    workspacePath: tempDir,
    ...overrides,
  };
}

function setupWorkspace(): string {
  tempDir = join(tmpdir(), `eval-det-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function teardownWorkspace(): void {
  rmSync(tempDir, { recursive: true, force: true });
}

async function runEval(spec: EvaluatorSpec, trace: EvalTrace) {
  return evals.evaluate(trace, spec);
}

// ─── Tests ──────────────────────────────────────────────────

describe('DeterministicEvaluators', () => {
  beforeEach(() => setupWorkspace());
  afterEach(() => teardownWorkspace);

  // output_contains
  describe('output_contains', () => {
    it('passes when answer contains value', async () => {
      const result = await runEval(
        { type: 'output_contains', value: 'Hello' },
        makeTrace()
      );
      expect(result.passed).toBe(true);
      expect(result.name).toBe('output_contains');
    });

    it('fails when answer does not contain value', async () => {
      const result = await runEval(
        { type: 'output_contains', value: 'Goodbye' },
        makeTrace()
      );
      expect(result.passed).toBe(false);
    });

    it('respects caseInsensitive', async () => {
      const result = await runEval(
        { type: 'output_contains', value: 'hello', caseInsensitive: true },
        makeTrace({ answer: 'HELLO WORLD' })
      );
      expect(result.passed).toBe(true);
    });

    it('is case-sensitive by default', async () => {
      const result = await runEval(
        { type: 'output_contains', value: 'hello' },
        makeTrace({ answer: 'HELLO WORLD' })
      );
      expect(result.passed).toBe(false);
    });
  });

  // output_not_contains
  describe('output_not_contains', () => {
    it('passes when answer does not contain value', async () => {
      const result = await runEval(
        { type: 'output_not_contains', value: 'error' },
        makeTrace()
      );
      expect(result.passed).toBe(true);
    });

    it('fails when answer contains value', async () => {
      const result = await runEval(
        { type: 'output_not_contains', value: 'Hello' },
        makeTrace()
      );
      expect(result.passed).toBe(false);
    });
  });

  // output_equals
  describe('output_equals', () => {
    it('passes on exact match', async () => {
      const result = await runEval(
        { type: 'output_equals', value: 'Hello World' },
        makeTrace()
      );
      expect(result.passed).toBe(true);
    });

    it('fails on partial match', async () => {
      const result = await runEval(
        { type: 'output_equals', value: 'Hello' },
        makeTrace()
      );
      expect(result.passed).toBe(false);
    });
  });

  // output_matches
  describe('output_matches', () => {
    it('passes when pattern matches', async () => {
      const result = await runEval(
        { type: 'output_matches', pattern: '^Hello' },
        makeTrace()
      );
      expect(result.passed).toBe(true);
    });

    it('respects flags', async () => {
      const result = await runEval(
        { type: 'output_matches', pattern: '^hello', flags: 'i' },
        makeTrace({ answer: 'HELLO' })
      );
      expect(result.passed).toBe(true);
    });
  });

  // tool_called
  describe('tool_called', () => {
    it('passes when tool was called', async () => {
      const result = await runEval(
        { type: 'tool_called', tool: 'file_read' },
        makeTrace({
          toolCalls: [{ name: 'file_read', arguments: { path: 'a.txt' } }],
        })
      );
      expect(result.passed).toBe(true);
    });

    it('fails when tool was not called', async () => {
      const result = await runEval(
        { type: 'tool_called', tool: 'shell' },
        makeTrace({
          toolCalls: [{ name: 'file_read', arguments: {} }],
        })
      );
      expect(result.passed).toBe(false);
    });
  });

  // tool_not_called
  describe('tool_not_called', () => {
    it('passes when tool was not called', async () => {
      const result = await runEval(
        { type: 'tool_not_called', tool: 'shell' },
        makeTrace({
          toolCalls: [{ name: 'file_read', arguments: {} }],
        })
      );
      expect(result.passed).toBe(true);
    });
  });

  // tool_called_with
  describe('tool_called_with', () => {
    it('passes when tool called with matching arguments (subset)', async () => {
      const result = await runEval(
        {
          type: 'tool_called_with',
          tool: 'file_write',
          arguments: { path: 'out.txt' },
        },
        makeTrace({
          toolCalls: [
            { name: 'file_write', arguments: { path: 'out.txt', content: 'data' } },
          ],
        })
      );
      expect(result.passed).toBe(true);
    });

    it('fails when argument value differs', async () => {
      const result = await runEval(
        {
          type: 'tool_called_with',
          tool: 'file_write',
          arguments: { path: 'other.txt' },
        },
        makeTrace({
          toolCalls: [
            { name: 'file_write', arguments: { path: 'out.txt' } },
          ],
        })
      );
      expect(result.passed).toBe(false);
    });
  });

  // tool_call_count
  describe('tool_call_count', () => {
    it('passes within min/max range', async () => {
      const result = await runEval(
        { type: 'tool_call_count', min: 1, max: 3 },
        makeTrace({
          toolCalls: [
            { name: 'a', arguments: {} },
            { name: 'b', arguments: {} },
          ],
        })
      );
      expect(result.passed).toBe(true);
    });

    it('fails when below min', async () => {
      const result = await runEval(
        { type: 'tool_call_count', min: 3 },
        makeTrace({ toolCalls: [{ name: 'a', arguments: {} }] })
      );
      expect(result.passed).toBe(false);
    });

    it('fails when above max', async () => {
      const result = await runEval(
        { type: 'tool_call_count', max: 1 },
        makeTrace({
          toolCalls: [
            { name: 'a', arguments: {} },
            { name: 'b', arguments: {} },
            { name: 'c', arguments: {} },
          ],
        })
      );
      expect(result.passed).toBe(false);
    });
  });

  // file_exists
  describe('file_exists', () => {
    it('passes when file exists', async () => {
      writeFileSync(join(tempDir, 'review.md'), '# Review\nAll good');
      const result = await runEval(
        { type: 'file_exists', path: 'review.md' },
        makeTrace()
      );
      expect(result.passed).toBe(true);
    });

    it('fails when file does not exist', async () => {
      const result = await runEval(
        { type: 'file_exists', path: 'missing.txt' },
        makeTrace()
      );
      expect(result.passed).toBe(false);
    });

    it('checks contentContains', async () => {
      writeFileSync(join(tempDir, 'review.md'), 'Found SQL injection');
      const result = await runEval(
        { type: 'file_exists', path: 'review.md', contentContains: 'SQL injection' },
        makeTrace()
      );
      expect(result.passed).toBe(true);
    });

    it('fails contentContains when content missing', async () => {
      writeFileSync(join(tempDir, 'review.md'), 'All good');
      const result = await runEval(
        { type: 'file_exists', path: 'review.md', contentContains: 'SQL injection' },
        makeTrace()
      );
      expect(result.passed).toBe(false);
    });
  });

  // file_not_exists
  describe('file_not_exists', () => {
    it('passes when file does not exist', async () => {
      const result = await runEval(
        { type: 'file_not_exists', path: 'nope.txt' },
        makeTrace()
      );
      expect(result.passed).toBe(true);
    });

    it('fails when file exists', async () => {
      writeFileSync(join(tempDir, 'temp.txt'), 'data');
      const result = await runEval(
        { type: 'file_not_exists', path: 'temp.txt' },
        makeTrace()
      );
      expect(result.passed).toBe(false);
    });
  });

  // exit_code
  describe('exit_code', () => {
    it('passes when result type matches', async () => {
      const result = await runEval(
        { type: 'exit_code', equals: 'success' },
        makeTrace()
      );
      expect(result.passed).toBe(true);
    });

    it('fails when result type differs', async () => {
      const result = await runEval(
        { type: 'exit_code', equals: 'error' },
        makeTrace()
      );
      expect(result.passed).toBe(false);
    });
  });

  // step_count
  describe('step_count', () => {
    it('passes within range', async () => {
      const result = await runEval(
        { type: 'step_count', max: 5 },
        makeTrace({ steps: 3 })
      );
      expect(result.passed).toBe(true);
    });

    it('fails when above max', async () => {
      const result = await runEval(
        { type: 'step_count', max: 2 },
        makeTrace({ steps: 5 })
      );
      expect(result.passed).toBe(false);
    });
  });
});
