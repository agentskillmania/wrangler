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

  describe('instruction persistence (B1)', () => {
    it('persists skill instructions as a load_skill tool result when body is present', async () => {
      const provider = createMockSkillProvider({
        loadInstructions: vi.fn().mockResolvedValue('## Code Review Skill\nReview thoroughly.'),
      });
      const handler = createSkillHandler(provider);
      const result = await handler.handle({
        command: { name: 'skill', target: 'code-review', body: 'Review this code' },
        state: createMockState(),
        runnerOptions: mockRunnerOptions,
      });

      // Body present => continue to LLM.
      expect(result.handled).toBe(false);
      expect(result.state).toBeDefined();
      const messages = result.state!.context.messages;

      // The synthesized pair: an assistant message with a load_skill toolCall,
      // followed by a tool message whose content is the instructions.
      const toolMsg = messages.find(
        (m) => m.role === 'tool' && m.toolName === 'load_skill'
      );
      expect(toolMsg).toBeDefined();
      expect(toolMsg!.content).toContain('Code Review Skill');

      const assistantWithCall = messages.find(
        (m) => m.role === 'assistant' && m.toolCalls?.some((c) => c.name === 'load_skill')
      );
      expect(assistantWithCall).toBeDefined();
      // The tool message must reference the assistant's toolCall id.
      const callId = assistantWithCall!.toolCalls!.find((c) => c.name === 'load_skill')!.id;
      expect(toolMsg!.toolCallId).toBe(callId);
    });

    it('persists skill instructions even without a body (no-body branch)', async () => {
      const provider = createMockSkillProvider({
        loadInstructions: vi.fn().mockResolvedValue('Review instructions body.'),
      });
      const handler = createSkillHandler(provider);
      const result = await handler.handle({
        command: { name: 'skill', target: 'code-review', body: '' },
        state: createMockState(),
        runnerOptions: mockRunnerOptions,
      });

      expect(result.handled).toBe(true);
      expect(result.state).toBeDefined();
      const messages = result.state!.context.messages;
      const toolMsg = messages.find(
        (m) => m.role === 'tool' && m.toolName === 'load_skill'
      );
      expect(toolMsg).toBeDefined();
      expect(toolMsg!.content).toBe('Review instructions body.');
    });
  });
});
