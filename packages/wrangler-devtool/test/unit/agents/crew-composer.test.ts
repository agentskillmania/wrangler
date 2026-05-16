import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runCrewComposer } from '../../../src/agents/crew-composer.js';
import { resetLLMClient } from '../../../src/llm.js';
import * as configModule from '../../../src/config.js';
import * as orchestratorModule from '../../../src/agents/orchestrator.js';

describe('runCrewComposer', () => {
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
    await expect(runCrewComposer('test')).rejects.toThrow('No valid LLM configuration');
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

    await runCrewComposer('test', undefined, { model: 'custom-model' });
    expect(runAgentSpy).toHaveBeenCalledWith(
      expect.anything(),
      'custom-model',
      'crew-composer',
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

    await runCrewComposer('test');
    expect(runAgentSpy).toHaveBeenCalledWith(
      expect.anything(),
      'gpt-4o',
      'crew-composer',
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

    await runCrewComposer('test', 'existing content');
    expect(runAgentSpy).toHaveBeenCalledWith(
      expect.anything(),
      'gpt-4o',
      'crew-composer',
      'test',
      'existing content',
      undefined
    );
  });
});
