import { describe, it, expect } from 'vitest';
import { createSkillsHandler } from '../../../../src/command/handlers/skills.js';
import { createAgentState } from '@agentskillmania/colts';
import type { RunnerOptions } from '@agentskillmania/colts';
import type { FilesystemSkillProvider } from '@agentskillmania/colts';

/**
 * Creates a mock FilesystemSkillProvider for testing.
 *
 * @param skills - Array of skills to mock
 * @returns A mock FilesystemSkillProvider
 */
function createMockSkillProvider(
  skills: Array<{ name: string; description: string }>
): FilesystemSkillProvider {
  return {
    listSkills: () => skills,
  } as unknown as FilesystemSkillProvider;
}

const mockRunnerOptions: Readonly<RunnerOptions> = {
  model: 'GLM-4.7',
  maxSteps: 10,
};

describe('createSkillsHandler', () => {
  it('should have name "skills"', () => {
    const handler = createSkillsHandler(createMockSkillProvider([]));
    expect(handler.name).toBe('skills');
  });

  it('should have description', () => {
    const handler = createSkillsHandler(createMockSkillProvider([]));
    expect(handler.description).toBe('List available skills');
  });

  describe('handle', () => {
    it('should list available skills with names and descriptions', async () => {
      const skills = [
        { name: 'code-review', description: 'Review code for quality' },
        { name: 'debug', description: 'Debug errors' },
        { name: 'test', description: 'Write tests' },
      ];
      const handler = createSkillsHandler(createMockSkillProvider(skills));
      const state = createAgentState({
        name: 'test',
        instructions: 'test instructions',
        tools: [],
      });
      const ctx = {
        command: {
          name: 'skills',
          body: '',
        },
        state,
        runnerOptions: mockRunnerOptions,
      };
      const result = await handler.handle(ctx);

      expect(result.handled).toBe(true);
      expect(result.response).toContain('Available skills:');
      expect(result.response).toContain('1. code-review — Review code for quality');
      expect(result.response).toContain('2. debug — Debug errors');
      expect(result.response).toContain('3. test — Write tests');
    });

    it('should show "No skills available." message when empty', async () => {
      const handler = createSkillsHandler(createMockSkillProvider([]));
      const state = createAgentState({
        name: 'test',
        instructions: 'test instructions',
        tools: [],
      });
      const ctx = {
        command: {
          name: 'skills',
          body: '',
        },
        state,
        runnerOptions: mockRunnerOptions,
      };
      const result = await handler.handle(ctx);

      expect(result.handled).toBe(true);
      expect(result.response).toBe('No skills available.');
    });

    it('should format response with numbered list', async () => {
      const skills = [
        { name: 'skill-a', description: 'Description A' },
        { name: 'skill-b', description: 'Description B' },
      ];
      const handler = createSkillsHandler(createMockSkillProvider(skills));
      const state = createAgentState({
        name: 'test',
        instructions: 'test instructions',
        tools: [],
      });
      const ctx = {
        command: {
          name: 'skills',
          body: '',
        },
        state,
        runnerOptions: mockRunnerOptions,
      };
      const result = await handler.handle(ctx);

      expect(result.response).toContain('1. ');
      expect(result.response).toContain('\n2. ');
    });

    it('should handle single skill correctly', async () => {
      const skills = [{ name: 'only-skill', description: 'Only one skill' }];
      const handler = createSkillsHandler(createMockSkillProvider(skills));
      const state = createAgentState({
        name: 'test',
        instructions: 'test instructions',
        tools: [],
      });
      const ctx = {
        command: {
          name: 'skills',
          body: '',
        },
        state,
        runnerOptions: mockRunnerOptions,
      };
      const result = await handler.handle(ctx);

      expect(result.handled).toBe(true);
      expect(result.response).toBe('Available skills:\n1. only-skill — Only one skill');
    });
  });
});
