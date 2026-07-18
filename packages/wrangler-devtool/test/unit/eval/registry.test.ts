import { describe, it, expect } from 'vitest';

import {
  EvaluatorRegistry,
  suiteUsesLlmJudge,
  requiresLlmJudge,
} from '../../../src/eval/evaluators/index.js';
import type { EvalTrace, EvaluatorSpec } from '../../../src/eval/types.js';

function makeTrace(answer: string = 'hello'): EvalTrace {
  return {
    caseName: 'test',
    sampleIndex: 0,
    input: 'test',
    answer,
    result: { type: 'success', answer, totalSteps: 1, tokens: { input: 5, output: 3 } },
    toolCalls: [],
    steps: 1,
    duration: 100,
    workspacePath: '/tmp/test',
  };
}

describe('EvaluatorRegistry', () => {
  it('dispatches deterministic evaluators', async () => {
    const registry = new EvaluatorRegistry();
    const spec: EvaluatorSpec = { type: 'output_contains', value: 'hello' };

    const result = await registry.evaluate(makeTrace(), spec);

    expect(result.passed).toBe(true);
    expect(result.name).toBe('output_contains');
  });

  it('returns error result for llm-judge when not configured', async () => {
    const registry = new EvaluatorRegistry();
    const spec: EvaluatorSpec = {
      type: 'llm-judge',
      name: 'quality',
      criteria: 'good?',
      rubric: [{ score: 5, description: 'ok' }],
      minScore: 3,
    };

    const result = await registry.evaluate(makeTrace(), spec);

    expect(result.passed).toBe(false);
    expect(result.message).toContain('not configured');
  });

  it('evaluateAll returns one result per spec', async () => {
    const registry = new EvaluatorRegistry();
    const specs: EvaluatorSpec[] = [
      { type: 'output_contains', value: 'hello' },
      { type: 'output_not_contains', value: 'error' },
      { type: 'exit_code', equals: 'success' },
    ];

    const results = await registry.evaluateAll(makeTrace(), specs);

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('hasLlmJudge is false by default', () => {
    const registry = new EvaluatorRegistry();
    expect(registry.hasLlmJudge).toBe(false);
  });
});

describe('suiteUsesLlmJudge', () => {
  it('returns true when any spec is llm-judge', () => {
    const specs: EvaluatorSpec[] = [
      { type: 'output_contains', value: 'x' },
      {
        type: 'llm-judge',
        name: 'q',
        criteria: 'c',
        rubric: [{ score: 1, description: 'd' }],
        minScore: 1,
      },
    ];
    expect(suiteUsesLlmJudge(specs)).toBe(true);
  });

  it('returns false when no spec is llm-judge', () => {
    const specs: EvaluatorSpec[] = [
      { type: 'output_contains', value: 'x' },
      { type: 'file_exists', path: 'a.txt' },
    ];
    expect(suiteUsesLlmJudge(specs)).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(suiteUsesLlmJudge([])).toBe(false);
  });
});

describe('requiresLlmJudge', () => {
  it('returns true for llm-judge spec', () => {
    expect(
      requiresLlmJudge({ type: 'llm-judge', name: 'q', criteria: 'c', rubric: [], minScore: 1 })
    ).toBe(true);
  });

  it('returns false for deterministic spec', () => {
    expect(requiresLlmJudge({ type: 'output_contains', value: 'x' })).toBe(false);
  });
});
