import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSessionSupport } from '../../../src/session/support.js';
import { AgentRunner, createAgentState, addUserMessage } from '@agentskillmania/colts';
import type { ILLMProvider } from '@agentskillmania/colts';
import { mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function createMockLLMProvider(response: string = 'test response'): ILLMProvider {
  return {
    call: vi.fn().mockResolvedValue({
      content: response,
      tokens: { input: 10, output: 20 },
    }),
    stream: vi.fn(),
  };
}

describe('createSessionSupport', () => {
  let testBaseDir: string;

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `wrangler-test-support-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('should return middleware, store, and tools', () => {
    const result = createSessionSupport({
      workspacePath: '/test',
      sessionBaseDir: testBaseDir,
    });

    expect(result.middleware).toBeDefined();
    expect(result.middleware.name).toBe('session');
    expect(result.store).toBeDefined();
    expect(result.tools).toBeDefined();
    expect(result.tools.length).toBeGreaterThanOrEqual(1);
  });

  it('should include calculator tool', () => {
    const result = createSessionSupport({
      workspacePath: '/test',
      sessionBaseDir: testBaseDir,
    });

    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain('calculate');
  });

  it('should include ask_human tool when handler provided', () => {
    const handler = vi.fn().mockResolvedValue({ response: 'ok' });
    const result = createSessionSupport({
      workspacePath: '/test',
      sessionBaseDir: testBaseDir,
      askHumanHandler: handler as any,
    });

    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain('ask_human');
  });

  it('should not include ask_human tool when no handler', () => {
    const result = createSessionSupport({
      workspacePath: '/test',
      sessionBaseDir: testBaseDir,
    });

    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).not.toContain('ask_human');
  });

  it('should work end-to-end with AgentRunner', async () => {
    const provider = createMockLLMProvider('Done.');
    const session = createSessionSupport({
      workspacePath: '/test/workspace',
      sessionBaseDir: testBaseDir,
    });

    const runner = new AgentRunner({
      model: 'test-model',
      llmClient: provider,
      tools: session.tools,
      middleware: [session.middleware],
    });

    let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
    state = addUserMessage(state, 'Hello');

    await runner.run(state);

    const entries = await readdir(testBaseDir, { recursive: true });
    const hasSession = (entries as string[]).some((e) => (e as string).includes('meta.yaml'));
    expect(hasSession).toBe(true);
  });
});
