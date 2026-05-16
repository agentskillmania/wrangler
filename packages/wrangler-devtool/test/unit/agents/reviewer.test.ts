import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runReviewer } from '../../../src/agents/reviewer.js';
import { resetLLMClient } from '../../../src/llm.js';
import * as configModule from '../../../src/config.js';
import * as orchestratorModule from '../../../src/agents/orchestrator.js';

describe('runReviewer', () => {
  beforeEach(() => {
    resetLLMClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should throw without LLM config', async () => {
    vi.spyOn(configModule, 'requireLLMConfig').mockRejectedValue(
      new Error('No valid LLM configuration found.')
    );
    await expect(runReviewer('path', 'content')).rejects.toThrow('No valid LLM configuration');
  });

  it('should use custom model from options', async () => {
    vi.spyOn(configModule, 'requireLLMConfig').mockResolvedValue({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    const runReviewAgentSpy = vi.spyOn(orchestratorModule, 'runReviewAgent').mockResolvedValue({
      overallScore: 4,
      dimensions: {
        clarity: { score: 4, reasoning: 'Clear' },
        completeness: { score: 4, reasoning: 'Complete' },
        focus: { score: 4, reasoning: 'Focused' },
        safety: { score: 4, reasoning: 'Safe' },
        efficiency: { score: 4, reasoning: 'Efficient' },
      },
      issues: [],
      summary: 'Good',
    });

    await runReviewer('path', 'content', 'focus', { model: 'custom-model' });
    expect(runReviewAgentSpy).toHaveBeenCalledWith(
      expect.anything(),
      'custom-model',
      expect.stringContaining('focus'),
      { model: 'custom-model' }
    );
  });

  it('should use config model when no options provided', async () => {
    vi.spyOn(configModule, 'requireLLMConfig').mockResolvedValue({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    const runReviewAgentSpy = vi.spyOn(orchestratorModule, 'runReviewAgent').mockResolvedValue({
      overallScore: 4,
      dimensions: {},
      issues: [],
      summary: 'Good',
    });

    await runReviewer('path', 'content');
    expect(runReviewAgentSpy).toHaveBeenCalledWith(
      expect.anything(),
      'gpt-4o',
      expect.stringContaining('path'),
      undefined
    );
  });

  it('should omit additional focus when no prompt provided', async () => {
    vi.spyOn(configModule, 'requireLLMConfig').mockResolvedValue({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    const runReviewAgentSpy = vi.spyOn(orchestratorModule, 'runReviewAgent').mockResolvedValue({
      overallScore: 4,
      dimensions: {},
      issues: [],
      summary: 'Good',
    });

    await runReviewer('path', 'content');
    const callArgs = runReviewAgentSpy.mock.calls[0];
    const reviewPrompt = callArgs[2] as string;
    expect(reviewPrompt).not.toContain('Additional focus');
  });
});
