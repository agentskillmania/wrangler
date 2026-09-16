/**
 * @fileoverview SubAgentRunner unit tests
 *
 * Verifies that createSubAgentRunner produces a correctly configured AgentRunner:
 * - systemPrompt carries NO header time context (time lives in the tail
 *   dynamic reminder computed by the assembler per build — R2P-101w)
 * - messageAssembler is MarkdownMessageAssembler
 * - todolist tools are included
 * - inherited tools are passed through
 * - NO delegate tool (prevents recursion)
 * - NO session, commands, spec-plan, a2ui
 */

import { describe, it, expect, vi } from 'vitest';
import type { Tool } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';

// Capture the options passed to AgentRunner constructor
let capturedOptions: Record<string, unknown> | undefined;

vi.mock('@agentskillmania/colts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentskillmania/colts')>();
  return {
    ...actual,
    AgentRunner: vi.fn().mockImplementation((options: Record<string, unknown>) => {
      capturedOptions = options;
      return { ...options };
    }),
  };
});

// Mock the todolist support so we don't pull in real middleware
vi.mock('../../../src/todolist/support.js', () => ({
  createTodolistSupport: vi.fn().mockReturnValue({
    tools: [{ name: 'todolist_read', description: 'read todo', parameters: {}, execute: vi.fn() }],
    middleware: { name: 'todolist' },
  }),
}));

describe('createSubAgentRunner', () => {
  const mockLLMClient = {
    call: vi.fn(),
    stream: vi.fn(),
    getModelMeta: vi.fn().mockReturnValue({ contextWindow: 128000, maxTokens: 4096 }),
  } as never;

  it('returns an AgentRunner instance', async () => {
    const { createSubAgentRunner } = await import('../../../src/runner/sub-agent-runner.js');
    const { AgentRunner } = await import('@agentskillmania/colts');
    const runner = createSubAgentRunner({
      model: 'gpt-4',
      llmClient: mockLLMClient,
    });
    // AgentRunner is mocked as a vi.fn() spy — verify it was called
    expect(AgentRunner).toHaveBeenCalled();
    expect(runner).toBeDefined();
  });

  it('injects NO header time context as systemPrompt (time lives in the tail reminder)', async () => {
    const { createSubAgentRunner } = await import('../../../src/runner/sub-agent-runner.js');
    createSubAgentRunner({
      model: 'gpt-4',
      llmClient: mockLLMClient,
    });
    // 头部时间戳是前缀缓存断点（每分钟全量作废）——systemPrompt 必须为空,
    // 时间行由 MarkdownMessageAssembler 的尾部动态 reminder 现算。
    expect(capturedOptions!.systemPrompt).toBeUndefined();
  });

  it('uses MarkdownMessageAssembler', async () => {
    const { createSubAgentRunner } = await import('../../../src/runner/sub-agent-runner.js');
    const { MarkdownMessageAssembler } = await import('../../../src/runner/markdown-assembler.js');
    createSubAgentRunner({
      model: 'gpt-4',
      llmClient: mockLLMClient,
    });
    expect(capturedOptions!.messageAssembler).toBeInstanceOf(MarkdownMessageAssembler);
  });

  it('includes inherited tools + todolist tools', async () => {
    const { createSubAgentRunner } = await import('../../../src/runner/sub-agent-runner.js');
    const inheritedTools: Tool<ZodTypeAny>[] = [
      { name: 'file_read', description: 'read', parameters: {} as never, execute: vi.fn() },
      { name: 'shell', description: 'run', parameters: {} as never, execute: vi.fn() },
    ];

    createSubAgentRunner({
      model: 'gpt-4',
      llmClient: mockLLMClient,
      inheritedTools,
    });

    const tools = capturedOptions!.tools as Tool<ZodTypeAny>[];
    expect(tools.map((t) => t.name)).toContain('file_read');
    expect(tools.map((t) => t.name)).toContain('shell');
    expect(tools.map((t) => t.name)).toContain('todolist_read');
  });

  it('deduplicates todolist tools from inherited set (prevents double-registration)', async () => {
    const { createSubAgentRunner } = await import('../../../src/runner/sub-agent-runner.js');
    // Parent registry includes todolist_read — must not be duplicated
    const inheritedTools: Tool<ZodTypeAny>[] = [
      { name: 'file_read', description: 'read', parameters: {} as never, execute: vi.fn() },
      {
        name: 'todolist_read',
        description: 'parent todo',
        parameters: {} as never,
        execute: vi.fn(),
      },
    ];

    createSubAgentRunner({
      model: 'gpt-4',
      llmClient: mockLLMClient,
      inheritedTools,
    });

    const tools = capturedOptions!.tools as Tool<ZodTypeAny>[];
    const todoCount = tools.filter((t) => t.name === 'todolist_read').length;
    expect(todoCount).toBe(1); // not 2 — the inherited copy is filtered out
  });

  it('passes through maxSteps, thinkingEnabled, temperature', async () => {
    const { createSubAgentRunner } = await import('../../../src/runner/sub-agent-runner.js');
    createSubAgentRunner({
      model: 'gpt-4',
      llmClient: mockLLMClient,
      maxSteps: 10,
      thinkingEnabled: true,
      temperature: 0.5,
    });

    expect(capturedOptions!.maxSteps).toBe(10);
    expect(capturedOptions!.thinkingEnabled).toBe(true);
    expect(capturedOptions!.temperature).toBe(0.5);
  });

  it('does NOT pass subAgents (prevents recursion)', async () => {
    const { createSubAgentRunner } = await import('../../../src/runner/sub-agent-runner.js');
    createSubAgentRunner({
      model: 'gpt-4',
      llmClient: mockLLMClient,
    });

    expect(capturedOptions!.subAgents).toBeUndefined();
  });

  it('only has todolist middleware (no session, command, a2ui)', async () => {
    const { createSubAgentRunner } = await import('../../../src/runner/sub-agent-runner.js');
    createSubAgentRunner({
      model: 'gpt-4',
      llmClient: mockLLMClient,
    });

    const middleware = capturedOptions!.middleware as { name: string }[];
    expect(middleware).toHaveLength(1);
    expect(middleware[0].name).toBe('todolist');
  });
});
