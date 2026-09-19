import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createAgentState,
  createLoadSkillTool,
  createExecutionState,
  ExecutingToolHandler,
  FilesystemSkillProvider,
  setDefaultSkillFsOps,
  ToolRegistry,
  toolCallToAction,
  updateExecState,
} from '@agentskillmania/colts';
import { nodeFsOps } from '@agentskillmania/colts/skills/node-fs-ops';
import { createSkillHandler } from '../../../../src/command/handlers/skill.js';
import { InventorySkillProvider } from '../../../../src/skills/inventory-provider.js';
import type { FilesystemSkillProvider as FilesystemSkillProviderType } from '@agentskillmania/colts';
import type { RunnerOptions } from '@agentskillmania/colts';

// The real node fs backend for FilesystemSkillProvider in these tests.
setDefaultSkillFsOps(nodeFsOps);

const BUNDLED_SUFFIX =
  '\n\n--- bundled files (use these exact paths with read_skill_resource / run_skill_script) ---\n';

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
      const toolMsg = messages.find((m) => m.role === 'tool' && m.toolName === 'load_skill');
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
      const toolMsg = messages.find((m) => m.role === 'tool' && m.toolName === 'load_skill');
      expect(toolMsg).toBeDefined();
      expect(toolMsg!.content).toBe('Review instructions body.');
    });
  });

  describe('bundled inventory delivery (R2P-114w)', () => {
    it('appends the bundled-files suffix with the manifest inventory (exact bytes)', async () => {
      const provider = createMockSkillProvider({
        getManifest: vi.fn().mockReturnValue({
          name: 'code-review',
          description: 'Review code',
          source: '/skills/code-review',
          resources: ['a.md', 'b.json'],
          scripts: ['run.js', 'helper.py'],
        }),
        loadInstructions: vi.fn().mockResolvedValue('Review instructions body.'),
      });
      const handler = createSkillHandler(provider);
      const result = await handler.handle({
        command: { name: 'skill', target: 'code-review', body: '' },
        state: createMockState(),
        runnerOptions: mockRunnerOptions,
      });

      const toolMsg = result.state!.context.messages.find(
        (m) => m.role === 'tool' && m.toolName === 'load_skill'
      );
      // 两侧各 ≥2 文件：单元素 join 对分隔符变异不敏感，精确字节断言
      // 钉不住 handler 侧的 join 分隔符。
      expect(toolMsg!.content).toBe(
        `Review instructions body.${BUNDLED_SUFFIX}resources: a.md, b.json\nscripts: run.js, helper.py`
      );
    });

    it('omits empty sides from the suffix (byte-identical to legacy when no inventory)', async () => {
      const provider = createMockSkillProvider({
        getManifest: vi.fn().mockReturnValue({
          name: 'code-review',
          description: 'Review code',
          source: '/skills/code-review',
          resources: [],
          scripts: [],
        }),
        loadInstructions: vi.fn().mockResolvedValue('Only instructions.'),
      });
      const handler = createSkillHandler(provider);
      const result = await handler.handle({
        command: { name: 'skill', target: 'code-review', body: '' },
        state: createMockState(),
        runnerOptions: mockRunnerOptions,
      });

      const toolMsg = result.state!.context.messages.find(
        (m) => m.role === 'tool' && m.toolName === 'load_skill'
      );
      expect(toolMsg!.content).toBe('Only instructions.');
    });
  });

  describe('cross-boundary shape parity with the load_skill tool (R2P-114w)', () => {
    let skillsDir: string;

    beforeEach(async () => {
      skillsDir = join(
        tmpdir(),
        `wrangler-test-skillcmd-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      const skillDir = join(skillsDir, 'demo');
      await mkdir(join(skillDir, 'reference'), { recursive: true });
      await mkdir(join(skillDir, 'scripts'), { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: demo\ndescription: Demo skill\n---\n\nUse the references.\n'
      );
      await writeFile(join(skillDir, 'reference', 'catalog.md'), 'catalog');
      // 两侧各 ≥2 文件：单元素 join 对分隔符变异不敏感（', ' 改成任意
      // 分隔符输出不变），字节等价断言就钉不住 colts/handler 两侧的
      // join 语义了。
      await writeFile(join(skillDir, 'reference', 'notes.json'), 'notes');
      await writeFile(join(skillDir, 'scripts', 'run.js'), 'code');
      await writeFile(join(skillDir, 'scripts', 'helper.py'), 'code');
    });

    afterEach(async () => {
      await rm(skillsDir, { recursive: true, force: true }).catch(() => {});
    });

    function makeRunnerProvider(): InventorySkillProvider {
      // The same provider shape AgentHarness injects (colts provider +
      // inventory alignment layer).
      return new InventorySkillProvider(new FilesystemSkillProvider([skillsDir]));
    }

    /**
     * Drive colts's REAL load_skill execution path: the tool returns a
     * SWITCH_SKILL signal and ExecutingToolHandler persists it via colts's
     * internal formatSkillToolResult (single source of truth for the tool
     * result content).
     */
    async function runColtsLoadSkillPath(provider: InventorySkillProvider): Promise<string> {
      const registry = new ToolRegistry();
      registry.register(createLoadSkillTool(provider));
      const execState = updateExecState(createExecutionState(), (d) => {
        d.phase = {
          type: 'executing-tool',
          actions: [
            toolCallToAction({ id: 'tc-colts', name: 'load_skill', arguments: { name: 'demo' } }),
          ],
        };
      });
      const ctx = {
        executionPolicy: {
          onToolError: async (err: Error) => ({ decision: 'fail' as const, error: err }),
        },
        llmProvider: {},
        messageAssembler: {},
        toolSchemaFormatter: {},
        options: { model: 'test' },
        emit: () => {},
      } as unknown as Parameters<ExecutingToolHandler['execute']>[0];
      const advance = await new ExecutingToolHandler().execute(
        ctx,
        createAgentState({ name: 'x', instructions: '', tools: [] }),
        execState,
        registry
      );
      const toolMsg = advance.state.context.messages.find(
        (m) => m.role === 'tool' && m.toolName === 'load_skill'
      );
      expect(toolMsg).toBeDefined();
      return toolMsg!.content as string;
    }

    it('/skill: tool result is byte-identical to the load_skill tool result (nested inventory included)', async () => {
      const provider = makeRunnerProvider();

      const handler = createSkillHandler(provider);
      const result = await handler.handle({
        command: { name: 'skill', target: 'demo', body: '' },
        state: createMockState(),
        runnerOptions: mockRunnerOptions,
      });
      const viaCommand = result.state!.context.messages.find(
        (m) => m.role === 'tool' && m.toolName === 'load_skill'
      )!.content as string;

      const viaTool = await runColtsLoadSkillPath(makeRunnerProvider());

      expect(viaCommand).toBe(viaTool);
      // Both paths deliver the recursive, partitioned inventory (sorted), with
      // ≥2 entries per side so the ', ' join separator itself is pinned.
      expect(viaCommand).toContain(
        `${BUNDLED_SUFFIX}resources: reference/catalog.md, reference/notes.json\n`
      );
      expect(viaCommand).toContain('scripts: scripts/helper.py, scripts/run.js');
    });
  });
});
