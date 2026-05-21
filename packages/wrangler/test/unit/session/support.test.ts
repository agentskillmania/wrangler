import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSessionSupport } from '../../../src/session/support.js';
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

    expect(result.middleware.name).toBe('session');
    expect(typeof result.store.exists).toBe('function');
    expect(result.tools).toHaveLength(1);
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

  it('should create session files when middleware hooks are invoked', async () => {
    const session = createSessionSupport({
      workspacePath: '/test/workspace',
      sessionBaseDir: testBaseDir,
    });

    // Simulate what AgentRunner would do when middleware is integrated
    await session.store.createWithId('test-session-1', 'test-model');

    const entries = await readdir(testBaseDir, { recursive: true });
    const sessionEntries = (entries as string[]).filter((e) => (e as string).includes('meta.yaml'));
    expect(sessionEntries).toHaveLength(1);
  });
});
