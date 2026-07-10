import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMResponse } from '@agentskillmania/llm-client';

import { LlmJudgeEvaluator } from '../../../src/eval/evaluators/llm-judge.js';
import type { EvalTrace, EvaluatorSpec } from '../../../src/eval/types.js';

// ─── Mock LLM provider ──────────────────────────────────────

const mockCall = vi.fn();

vi.mock('@agentskillmania/llm-client', () => ({
  LLMClient: vi.fn().mockImplementation(() => ({
    call: mockCall,
    stream: vi.fn(),
    registerProvider: vi.fn(),
    registerApiKey: vi.fn(),
    getModelMeta: vi.fn().mockReturnValue({ contextWindow: 128000, maxTokens: 16384 }),
  })),
}));

// ─── Helpers ────────────────────────────────────────────────

function makeTrace(overrides: Partial<EvalTrace> = {}): EvalTrace {
  return {
    caseName: 'test',
    sampleIndex: 0,
    input: 'Review this code',
    answer: 'The code looks good overall.',
    result: { type: 'success', answer: 'ok', totalSteps: 2, tokens: { input: 10, output: 5 } },
    toolCalls: [{ name: 'file_read', arguments: { path: 'src/main.py' } }],
    steps: 2,
    duration: 1000,
    workspacePath: '/tmp/test',
    ...overrides,
  };
}

function judgeSpec(overrides: Partial<Extract<EvaluatorSpec, { type: 'llm-judge' }>> = {}) {
  return {
    type: 'llm-judge' as const,
    name: 'quality',
    criteria: 'Is the review thorough?',
    rubric: [
      { score: 5, description: 'Excellent' },
      { score: 1, description: 'Poor' },
    ],
    minScore: 3,
    ...overrides,
  };
}

/** Simulate the judge LLM returning a specific score. */
function mockJudgeResponse(score: number, reasoning: string) {
  mockCall.mockResolvedValue({
    content: `SCORE: ${score}\nREASONING: ${reasoning}`,
    tokens: { input: 50, output: 20 },
    stopReason: 'stop',
  } as LLMResponse);
}

// ─── Tests ──────────────────────────────────────────────────

describe('LlmJudgeEvaluator', () => {
  let evaluator: LlmJudgeEvaluator;

  beforeEach(() => {
    mockCall.mockReset();
    // Construct with a mock config — actual LLM calls are mocked above.
    evaluator = new LlmJudgeEvaluator({
      llm: {
        providers: [
          { name: 'openai', apiKey: 'sk-test', models: [{ modelId: 'gpt-4o' }] },
        ],
      },
    });
  });

  it('returns passed=true when score >= minScore', async () => {
    mockJudgeResponse(4, 'Good coverage');
    const trace = makeTrace();
    const result = await evaluator.evaluate(trace, judgeSpec());

    expect(result.passed).toBe(true);
    expect(result.score).toBe(4);
    expect(result.name).toBe('quality');
  });

  it('returns passed=false when score < minScore', async () => {
    mockJudgeResponse(2, 'Missed key issues');
    const result = await evaluator.evaluate(makeTrace(), judgeSpec({ minScore: 3 }));

    expect(result.passed).toBe(false);
    expect(result.score).toBe(2);
  });

  it('includes the trace answer and tool calls in the judge prompt', async () => {
    mockJudgeResponse(5, 'Perfect');
    await evaluator.evaluate(makeTrace(), judgeSpec());

    expect(mockCall).toHaveBeenCalledTimes(1);
    const callArg = mockCall.mock.calls[0][0] as { messages: Array<{ content: string }> };
    const prompt = callArg.messages.map((m) => m.content).join('\n');
    // Answer + tools from trace
    expect(prompt).toContain('The code looks good overall.');
    expect(prompt).toContain('file_read');
    // Criteria + rubric from spec
    expect(prompt).toContain('Is the review thorough?');
    expect(prompt).toContain('Excellent');
    expect(prompt).toContain('Poor');
  });

  it('includes reference answer in prompt when provided', async () => {
    mockJudgeResponse(5, 'Matches reference');
    await evaluator.evaluate(
      makeTrace(),
      judgeSpec({ reference: 'Should mention SQL injection' })
    );

    const callArg = mockCall.mock.calls[0][0] as { messages: Array<{ content: string }> };
    const prompt = callArg.messages.map((m) => m.content).join('\n');
    expect(prompt).toContain('Should mention SQL injection');
  });

  it('uses temperature 0 for deterministic judging', async () => {
    mockJudgeResponse(5, 'ok');
    await evaluator.evaluate(makeTrace(), judgeSpec());

    const callArg = mockCall.mock.calls[0][0] as { temperature?: number };
    expect(callArg.temperature).toBe(0);
  });

  it('handles malformed judge response gracefully', async () => {
    mockCall.mockResolvedValue({
      content: 'I cannot evaluate this.',
      tokens: { input: 10, output: 5 },
      stopReason: 'stop',
    } as LLMResponse);

    const result = await evaluator.evaluate(makeTrace(), judgeSpec());

    expect(result.passed).toBe(false);
    expect(result.score).toBeUndefined();
    expect(result.message).toContain('parse');
  });

  it('throws if constructed without config or llm', () => {
    expect(() => new LlmJudgeEvaluator({})).toThrow('requires either config or llm');
  });

  it('returns error for non-llm-judge spec', async () => {
    mockJudgeResponse(5, 'ok');
    const result = await evaluator.evaluate(makeTrace(), { type: 'output_contains', value: 'x' });

    expect(result.passed).toBe(false);
    expect(result.message).toContain('non-llm-judge');
  });
});
