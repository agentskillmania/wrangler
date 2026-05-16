import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runAgentArchitect } from '../../../src/agents/architect.js';
import { resetLLMClient } from '../../../src/llm.js';
import * as configModule from '../../../src/config.js';
import * as orchestratorModule from '../../../src/agents/orchestrator.js';

describe('runAgentArchitect', () => {
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
    await expect(runAgentArchitect('test')).rejects.toThrow('No valid LLM configuration');
  });

  it('should use custom model from options', async () => {
    vi.spyOn(configModule, 'requireLLMConfig').mockResolvedValue({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    const runAgentSpy = vi.spyOn(orchestratorModule, 'runAgent').mockResolvedValue({
      changes: [],
      summary: 'test',
    });

    await runAgentArchitect('test', undefined, { model: 'custom-model' });
    expect(runAgentSpy).toHaveBeenCalledWith(
      expect.anything(),
      'custom-model',
      'architect',
      'test',
      undefined,
      { model: 'custom-model' }
    );
  });

  it('should use config model when no options provided', async () => {
    vi.spyOn(configModule, 'requireLLMConfig').mockResolvedValue({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    const runAgentSpy = vi.spyOn(orchestratorModule, 'runAgent').mockResolvedValue({
      changes: [],
      summary: 'test',
    });

    await runAgentArchitect('test');
    expect(runAgentSpy).toHaveBeenCalledWith(
      expect.anything(),
      'gpt-4o',
      'architect',
      'test',
      undefined,
      undefined
    );
  });

  it('should pass existing content to orchestrator', async () => {
    vi.spyOn(configModule, 'requireLLMConfig').mockResolvedValue({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    const runAgentSpy = vi.spyOn(orchestratorModule, 'runAgent').mockResolvedValue({
      changes: [],
      summary: 'test',
    });

    await runAgentArchitect('test', 'existing');
    expect(runAgentSpy).toHaveBeenCalledWith(
      expect.anything(),
      'gpt-4o',
      'architect',
      'test',
      'existing',
      undefined
    );
  });
});
