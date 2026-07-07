import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SoftEvaluation, AgentRunOutput } from '../../../src/test-runner/types.js';

// Mock config.ts (createLLMClient moved here from deleted llm.ts)
const mockCall = vi.fn();
vi.mock('../../../src/test-runner/config.js', () => ({
  createLLMClient: () => ({ call: mockCall }),
}));

import { evaluateSoft } from '../../../src/test-runner/soft-evaluator.js';

const BASE_EVALUATION: SoftEvaluation = {
  name: 'quality',
  criteria: 'Output should be clear and accurate',
  rubric: [],
  minScore: 3,
};

const BASE_OUTPUT: AgentRunOutput = {
  answer: 'This is the agent output to evaluate',
  toolCalls: [],
  resultType: 'success',
  totalSteps: 1,
};

const LLM_CONFIG: LLMConfig = {
  providers: [
    {
      name: 'openai',
      apiKey: 'sk-test',
      models: [{ modelId: 'gpt-4o' }],
    },
  ],
};

describe('evaluateSoft', () => {
  beforeEach(() => {
    mockCall.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return score and reasoning from JSON response', async () => {
    mockCall.mockResolvedValue({
      content: '{"score": 4, "reasoning": "Clear and well-structured output"}',
    });

    const result = await evaluateSoft(BASE_EVALUATION, BASE_OUTPUT, LLM_CONFIG);

    expect(result.name).toBe('quality');
    expect(result.score).toBe(4);
    expect(result.reasoning).toBe('Clear and well-structured output');
    expect(result.passed).toBe(true);
  });

  it('should fail when score is below minScore', async () => {
    mockCall.mockResolvedValue({
      content: '{"score": 2, "reasoning": "Incomplete answer"}',
    });

    const result = await evaluateSoft(BASE_EVALUATION, BASE_OUTPUT, LLM_CONFIG);

    expect(result.score).toBe(2);
    expect(result.passed).toBe(false);
  });

  it('should pass when score equals minScore', async () => {
    mockCall.mockResolvedValue({
      content: '{"score": 3, "reasoning": "Meets minimum bar"}',
    });

    const result = await evaluateSoft(BASE_EVALUATION, BASE_OUTPUT, LLM_CONFIG);

    expect(result.score).toBe(3);
    expect(result.passed).toBe(true);
  });

  it('should clamp score above 5 down to 5', async () => {
    mockCall.mockResolvedValue({
      content: '{"score": 9, "reasoning": "Excellent"}',
    });

    const result = await evaluateSoft(BASE_EVALUATION, BASE_OUTPUT, LLM_CONFIG);

    expect(result.score).toBe(5);
  });

  it('should clamp score below 1 up to 1', async () => {
    mockCall.mockResolvedValue({
      content: '{"score": -3, "reasoning": "Terrible"}',
    });

    const result = await evaluateSoft(BASE_EVALUATION, BASE_OUTPUT, LLM_CONFIG);

    expect(result.score).toBe(1);
  });

  it('should include rubric in prompt when provided', async () => {
    mockCall.mockResolvedValue({
      content: '{"score": 4, "reasoning": "Good"}',
    });

    const evaluation: SoftEvaluation = {
      ...BASE_EVALUATION,
      rubric: [
        { score: 5, description: 'Perfect' },
        { score: 1, description: 'Unusable' },
      ],
    };

    await evaluateSoft(evaluation, BASE_OUTPUT, LLM_CONFIG);

    const callArgs = mockCall.mock.calls[0][0];
    const prompt = callArgs.messages[0].content;
    expect(prompt).toContain('Scoring rubric');
    expect(prompt).toContain('5: Perfect');
    expect(prompt).toContain('1: Unusable');
  });

  it('should fall back to text score extraction when JSON parse fails', async () => {
    mockCall.mockResolvedValue({
      content: 'I would give this a score: 4 out of 5. The output is reasonable.',
    });

    const result = await evaluateSoft(BASE_EVALUATION, BASE_OUTPUT, LLM_CONFIG);

    expect(result.score).toBe(4);
    expect(result.passed).toBe(true);
  });

  it('should fall back to text score when JSON object is malformed', async () => {
    mockCall.mockResolvedValue({
      content: 'I would give this a score: 3 out of 5. { not valid json }',
    });

    const result = await evaluateSoft(BASE_EVALUATION, BASE_OUTPUT, LLM_CONFIG);

    expect(result.score).toBe(3);
    expect(result.passed).toBe(true);
  });

  it('should default to score 1 when no score found in text', async () => {
    mockCall.mockResolvedValue({
      content: 'Unable to evaluate this output properly.',
    });

    const result = await evaluateSoft(BASE_EVALUATION, BASE_OUTPUT, LLM_CONFIG);

    expect(result.score).toBe(1);
    expect(result.passed).toBe(false);
  });

  it('should return failure when LLM call throws', async () => {
    mockCall.mockRejectedValue(new Error('API rate limit exceeded'));

    const result = await evaluateSoft(BASE_EVALUATION, BASE_OUTPUT, LLM_CONFIG);

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain('API rate limit exceeded');
  });

  it('should default to empty content when response.content is undefined', async () => {
    mockCall.mockResolvedValue({});

    const result = await evaluateSoft(BASE_EVALUATION, BASE_OUTPUT, LLM_CONFIG);

    expect(result.score).toBe(1);
    expect(result.passed).toBe(false);
  });

  it('should default to score 1 when parsed JSON has no score', async () => {
    mockCall.mockResolvedValue({
      content: '{"reasoning": "Missing score field"}',
    });

    const result = await evaluateSoft(BASE_EVALUATION, BASE_OUTPUT, LLM_CONFIG);

    expect(result.score).toBe(1);
    expect(result.passed).toBe(false);
  });

  it('should handle non-Error thrown values', async () => {
    mockCall.mockRejectedValue('string error');

    const result = await evaluateSoft(BASE_EVALUATION, BASE_OUTPUT, LLM_CONFIG);

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain('string error');
  });
});
