import { describe, it, expect } from 'vitest';
import { createSkillHandler } from '../../../../src/command/handlers/skill.js';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import type { RunnerOptions } from '@agentskillmania/colts';
import type { FilesystemSkillProvider } from '@agentskillmania/colts';

/**
 * Creates a mock FilesystemSkillProvider for testing.
 *
 * @param skills - Record mapping skill names to their descriptions and instructions
 * @returns A mock FilesystemSkillProvider
 */
function createMockSkillProvider(
  skills: Record<string, { description: string; instructions: string }>
): FilesystemSkillProvider {
  return {
    getManifest: (name: string) =>
      skills[name] ? { name, description: skills[name].description, source: '/test' } : undefined,
    loadInstructions: async (name: string) => {
      if (!skills[name]) {
        throw new Error(`Skill not found: ${name}`);
      }
      return skills[name].instructions;
    },
  } as unknown as FilesystemSkillProvider;
}

const mockRunnerOptions: Readonly<RunnerOptions> = {
  model: 'GLM-4.7',
  maxSteps: 10,
};

describe('createSkillHandler', () => {
  it('should have name "skill"', () => {
    const handler = createSkillHandler(createMockSkillProvider({}));
    expect(handler.name).toBe('skill');
  });

  it('should have description', () => {
    const handler = createSkillHandler(createMockSkillProvider({}));
    expect(handler.description).toBe('Load a skill by name');
  });

  describe('handle', () => {
    it('should load skill and return handled:false when body present', async () => {
      const skills = {
        'code-review': {
          description: 'Review code',
          instructions: 'You are a code reviewer. Review the code carefully.',
        },
      };
      const handler = createSkillHandler(createMockSkillProvider(skills));
      const state = createAgentState({
        name: 'test',
        instructions: 'test instructions',
        tools: [],
      });
      const ctx = {
        command: {
          name: 'skill',
          target: 'code-review',
          body: 'Please review this function',
        },
        state,
        runnerOptions: mockRunnerOptions,
      };
      const result = await handler.handle(ctx);

      expect(result.handled).toBe(false);
      expect(result.state).not.toBe(state);
      expect(result.response).toBeUndefined();
    });

    it('should load skill and return handled:true when no body', async () => {
      const skills = {
        'code-review': {
          description: 'Review code',
          instructions: 'You are a code reviewer.',
        },
      };
      const handler = createSkillHandler(createMockSkillProvider(skills));
      const state = createAgentState({
        name: 'test',
        instructions: 'test instructions',
        tools: [],
      });
      const ctx = {
        command: {
          name: 'skill',
          target: 'code-review',
          body: '',
        },
        state,
        runnerOptions: mockRunnerOptions,
      };
      const result = await handler.handle(ctx);

      expect(result.handled).toBe(true);
      expect(result.state).not.toBe(state);
      expect(result.response).toBe("Skill 'code-review' loaded.");
    });

    it('should return error when target is missing', async () => {
      const handler = createSkillHandler(createMockSkillProvider({}));
      const state = createAgentState({
        name: 'test',
        instructions: 'test instructions',
        tools: [],
      });
      const ctx = {
        command: {
          name: 'skill',
          body: '',
        },
        state,
        runnerOptions: mockRunnerOptions,
      };
      const result = await handler.handle(ctx);

      expect(result.handled).toBe(true);
      expect(result.response).toBe('Usage: /skill:<name> [message]');
      expect(result.state).toBeUndefined();
    });

    it('should return error when skill not found', async () => {
      const handler = createSkillHandler(createMockSkillProvider({}));
      const state = createAgentState({
        name: 'test',
        instructions: 'test instructions',
        tools: [],
      });
      const ctx = {
        command: {
          name: 'skill',
          target: 'nonexistent',
          body: '',
        },
        state,
        runnerOptions: mockRunnerOptions,
      };
      const result = await handler.handle(ctx);

      expect(result.handled).toBe(true);
      expect(result.response).toBe("Skill 'nonexistent' not found.");
      expect(result.state).toBeUndefined();
    });

    it('should reject skill names with path traversal characters', async () => {
      const handler = createSkillHandler(createMockSkillProvider({}));
      const state = createAgentState({
        name: 'test',
        instructions: 'test instructions',
        tools: [],
      });
      const ctx = {
        command: {
          name: 'skill',
          target: '../../etc/passwd',
          body: '',
        },
        state,
        runnerOptions: mockRunnerOptions,
      };
      const result = await handler.handle(ctx);

      expect(result.handled).toBe(true);
      expect(result.response).toBe('Invalid skill name. Use alphanumeric, dash, underscore only.');
    });

    it('should handle loadInstructions failure gracefully', async () => {
      const provider = {
        getManifest: () => ({ name: 'broken', description: 'test', source: '/test' }),
        loadInstructions: async () => {
          throw new Error('I/O error reading skill file');
        },
      } as unknown as FilesystemSkillProvider;
      const handler = createSkillHandler(provider);
      const state = createAgentState({
        name: 'test',
        instructions: 'test instructions',
        tools: [],
      });
      const ctx = {
        command: {
          name: 'skill',
          target: 'broken',
          body: '',
        },
        state,
        runnerOptions: mockRunnerOptions,
      };
      const result = await handler.handle(ctx);

      expect(result.handled).toBe(true);
      expect(result.response).toContain('Failed to load skill');
      expect(result.response).toContain('I/O error reading skill file');
    });

    it('should verify skill state is actually modified', async () => {
      const skills = {
        debugger: {
          description: 'Debug code',
          instructions: 'You are a debugging assistant.',
        },
      };
      const handler = createSkillHandler(createMockSkillProvider(skills));
      const state = createAgentState({
        name: 'test',
        instructions: 'test instructions',
        tools: [],
      });
      const ctx = {
        command: {
          name: 'skill',
          target: 'debugger',
          body: '',
        },
        state,
        runnerOptions: mockRunnerOptions,
      };
      const result = await handler.handle(ctx);

      // Verify state was returned and is a new object (immutable)
      expect(result.state).not.toBe(state);
      // Verify the state ID is preserved
      expect(result.state!.id).toBe(state.id);
    });

    it('should preserve existing state when loading skill', async () => {
      const skills = {
        'code-review': {
          description: 'Review code',
          instructions: 'You are a code reviewer.',
        },
      };
      const handler = createSkillHandler(createMockSkillProvider(skills));
      const state = createAgentState({
        name: 'test-agent',
        instructions: 'Original instructions',
        tools: [],
      });
      const stateWithMessages = addUserMessage(state, 'Hello');
      const originalId = state.id;
      const ctx = {
        command: {
          name: 'skill',
          target: 'code-review',
          body: '',
        },
        state: stateWithMessages,
        runnerOptions: mockRunnerOptions,
      };
      const result = await handler.handle(ctx);

      expect(result.state!.id).toBe(originalId);
      expect(result.state!.config.name).toBe('test-agent');
      expect(result.state!.config.instructions).toBe('Original instructions');
      expect(result.state!.context.messages).toHaveLength(1);
    });
  });
});
