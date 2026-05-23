import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as configModule from '../../../src/config.js';
import * as orchestratorModule from '../../../src/agents/orchestrator.js';

// Import all agent wrapper functions
import { runAgentArchitect } from '../../../src/agents/architect.js';
import { runCrewComposer } from '../../../src/agents/crew-composer.js';
import { runSkillDesigner } from '../../../src/agents/skill-designer.js';
import { runReviewer } from '../../../src/agents/reviewer.js';
import { runSessionCurator } from '../../../src/agents/session-curator.js';

interface AgentWrapper {
  name: string;
  fn: (prompt: string, existing?: string, options?: { model?: string }) => Promise<unknown>;
  agentType: string;
}

// runReviewer uses runReviewAgent instead of runAgent, so it is tested separately
// runSessionCurator uses runSessionCuratorAgent instead of runAgent, so it is tested separately
const AGENTS: AgentWrapper[] = [
  { name: 'runAgentArchitect', fn: runAgentArchitect, agentType: 'architect' },
  { name: 'runCrewComposer', fn: runCrewComposer, agentType: 'crew-composer' },
  { name: 'runSkillDesigner', fn: runSkillDesigner, agentType: 'skill-designer' },
];

describe('agent wrappers', () => {
  beforeEach(() => {});

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(AGENTS)('$name throws without LLM config', async ({ fn }) => {
    vi.spyOn(configModule, 'requireLLMConfig').mockRejectedValue(
      new Error('No valid LLM configuration found.')
    );
    await expect(fn('test')).rejects.toThrow('No valid LLM configuration');
  });

  it.each(AGENTS)('$name uses custom model from options', async ({ fn, agentType }) => {
    vi.spyOn(configModule, 'requireLLMConfig').mockResolvedValue({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    const runAgentSpy = vi.spyOn(orchestratorModule, 'runAgent').mockResolvedValue({
      changes: [],
      summary: 'test',
    });

    await fn('test', undefined, { model: 'custom-model' });
    expect(runAgentSpy).toHaveBeenCalledWith(
      expect.anything(),
      'custom-model',
      agentType,
      'test',
      undefined,
      { model: 'custom-model' }
    );
  });

  it.each(AGENTS)('$name uses config model when no options provided', async ({ fn, agentType }) => {
    vi.spyOn(configModule, 'requireLLMConfig').mockResolvedValue({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    const runAgentSpy = vi.spyOn(orchestratorModule, 'runAgent').mockResolvedValue({
      changes: [],
      summary: 'test',
    });

    await fn('test');
    expect(runAgentSpy).toHaveBeenCalledWith(
      expect.anything(),
      'gpt-4o',
      agentType,
      'test',
      undefined,
      undefined
    );
  });

  it.each(AGENTS)('$name passes existing content to orchestrator', async ({ fn, agentType }) => {
    vi.spyOn(configModule, 'requireLLMConfig').mockResolvedValue({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    const runAgentSpy = vi.spyOn(orchestratorModule, 'runAgent').mockResolvedValue({
      changes: [],
      summary: 'test',
    });

    await fn('test', 'existing content');
    expect(runAgentSpy).toHaveBeenCalledWith(
      expect.anything(),
      'gpt-4o',
      agentType,
      'test',
      'existing content',
      undefined
    );
  });

  describe('runReviewer (special — uses runReviewAgent)', () => {
    it('throws without LLM config', async () => {
      vi.spyOn(configModule, 'requireLLMConfig').mockRejectedValue(
        new Error('No valid LLM configuration found.')
      );
      await expect(runReviewer('test.ts', 'content')).rejects.toThrow('No valid LLM configuration');
    });

    it('uses custom model from options', async () => {
      vi.spyOn(configModule, 'requireLLMConfig').mockResolvedValue({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4o',
      });
      const runReviewSpy = vi.spyOn(orchestratorModule, 'runReviewAgent').mockResolvedValue({
        summary: 'review',
        issues: [],
        suggestions: [],
      } as any);

      await runReviewer('test.ts', 'content', 'focus', { model: 'custom-model' });
      expect(runReviewSpy).toHaveBeenCalledWith(
        expect.anything(),
        'custom-model',
        expect.stringContaining('test.ts'),
        { model: 'custom-model' }
      );
    });

    it('uses config model when no options provided', async () => {
      vi.spyOn(configModule, 'requireLLMConfig').mockResolvedValue({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4o',
      });
      const runReviewSpy = vi.spyOn(orchestratorModule, 'runReviewAgent').mockResolvedValue({
        summary: 'review',
        issues: [],
        suggestions: [],
      } as any);

      await runReviewer('test.ts', 'content');
      expect(runReviewSpy).toHaveBeenCalledWith(
        expect.anything(),
        'gpt-4o',
        expect.stringContaining('test.ts'),
        undefined
      );
    });
  });

  describe('runSessionCurator (special — uses runSessionCuratorAgent)', () => {
    it('throws without LLM config', async () => {
      vi.spyOn(configModule, 'requireLLMConfig').mockRejectedValue(
        new Error('No valid LLM configuration found.')
      );
      await expect(runSessionCurator('test text')).rejects.toThrow('No valid LLM configuration');
    });

    it('uses custom model from options', async () => {
      vi.spyOn(configModule, 'requireLLMConfig').mockResolvedValue({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4o',
      });
      const runSessionCuratorSpy = vi
        .spyOn(orchestratorModule, 'runSessionCuratorAgent')
        .mockResolvedValue({ title: 'Test', description: 'Summary' });

      await runSessionCurator('test text', { model: 'custom-model' });
      expect(runSessionCuratorSpy).toHaveBeenCalledWith(
        expect.anything(),
        'custom-model',
        'test text',
        { model: 'custom-model' }
      );
    });

    it('uses config model when no options provided', async () => {
      vi.spyOn(configModule, 'requireLLMConfig').mockResolvedValue({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4o',
      });
      const runSessionCuratorSpy = vi
        .spyOn(orchestratorModule, 'runSessionCuratorAgent')
        .mockResolvedValue({ title: 'Test', description: 'Summary' });

      await runSessionCurator('test text');
      expect(runSessionCuratorSpy).toHaveBeenCalledWith(
        expect.anything(),
        'gpt-4o',
        'test text',
        undefined
      );
    });
  });
});
