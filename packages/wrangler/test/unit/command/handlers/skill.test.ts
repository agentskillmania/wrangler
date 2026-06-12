import { describe, it, expect, vi } from 'vitest';
import { createAgentState } from '@agentskillmania/colts';
import { createSkillHandler } from '../../../../src/command/handlers/skill.js';
import type { FilesystemSkillProvider } from '@agentskillmania/colts';
import type { RunnerOptions } from '@agentskillmania/colts';

const mockRunnerOptions: Readonly<RunnerOptions> = {
  model: 'GLM-4.7',
  maxSteps: 10,
};

function createMockSkillProvider(
  overrides?: Partial<FilesystemSkillProvider>
): FilesystemSkillProvider {
  return {
    getManifest: vi.fn().mockReturnValue({ name: 'code-review', description: 'Review code' }),
    loadInstructions: vi.fn().mockResolvedValue('Review instructions'),
    listSkills: vi.fn().mockReturnValue([]),
    ...overrides,
  } as unknown as FilesystemSkillProvider;
}

function createMockState() {
  return createAgentState({
    name: 'test',
    instructions: 'test instructions',
    tools: [],
  });
}

describe('createSkillHandler', () => {
  it('should have name "skill"', () => {
    const handler = createSkillHandler(createMockSkillProvider());
    expect(handler.name).toBe('skill');
  });

  describe('negative paths', () => {
    it('returns usage message when target is missing', async () => {
      const handler = createSkillHandler(createMockSkillProvider());
      const result = await handler.handle({
        command: { name: 'skill', target: undefined, body: '' },
        state: createMockState(),
        runnerOptions: mockRunnerOptions,
      });

      expect(result.handled).toBe(true);
      expect(result.response).toBe('Usage: /skill:<name> [message]');
    });

    it('returns error for invalid skill name characters', async () => {
      const handler = createSkillHandler(createMockSkillProvider());
      const result = await handler.handle({
        command: { name: 'skill', target: 'bad/name', body: '' },
        state: createMockState(),
        runnerOptions: mockRunnerOptions,
      });

      expect(result.handled).toBe(true);
      expect(result.response).toBe('Invalid skill name. Use alphanumeric, dash, underscore only.');
    });

    it('returns not-found message when skill does not exist', async () => {
      const handler = createSkillHandler(
        createMockSkillProvider({ getManifest: vi.fn().mockReturnValue(null) })
      );
      const result = await handler.handle({
        command: { name: 'skill', target: 'missing', body: '' },
        state: createMockState(),
        runnerOptions: mockRunnerOptions,
      });

      expect(result.handled).toBe(true);
      expect(result.response).toBe("Skill 'missing' not found.");
    });

    it('returns error when skillProvider throws', async () => {
      const handler = createSkillHandler(
        createMockSkillProvider({
          getManifest: vi.fn().mockImplementation(() => {
            throw new Error('disk read failed');
          }),
        })
      );
      const result = await handler.handle({
        command: { name: 'skill', target: 'code-review', body: '' },
        state: createMockState(),
        runnerOptions: mockRunnerOptions,
      });

      expect(result.handled).toBe(true);
      expect(result.response).toContain('disk read failed');
    });
  });
});
