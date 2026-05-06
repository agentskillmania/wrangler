import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { wrapToColtsTool } from '../../../src/tools/wrap-tool.js';
import type { WranglerToolDef } from '../../../src/tools/types.js';

describe('wrapToColtsTool', () => {
  const schema = z.object({ input: z.string() });

  function makeTool(overrides?: Partial<Pick<WranglerToolDef, 'execute'>>): WranglerToolDef {
    return {
      name: 'test_tool',
      description: 'A test tool',
      parameters: schema,
      execute:
        overrides?.execute ??
        (async (args) => ({
          output: `processed: ${args.input}`,
          metadata: { length: args.input.length },
        })),
    };
  }

  it('returns colts Tool with output only (no metadata)', async () => {
    const wrapped = wrapToColtsTool(makeTool());
    const result = await wrapped.execute({ input: 'hello' });
    expect(result).toBe('processed: hello');
    expect(typeof result).toBe('string');
  });

  it('preserves name, description, and parameters', () => {
    const tool = makeTool();
    const wrapped = wrapToColtsTool(tool);
    expect(wrapped.name).toBe('test_tool');
    expect(wrapped.description).toBe('A test tool');
    expect(wrapped.parameters).toBe(schema);
  });

  it('propagates errors from the inner tool', async () => {
    const tool = makeTool({
      execute: async () => {
        throw new Error('tool failed');
      },
    });
    const wrapped = wrapToColtsTool(tool);
    await expect(wrapped.execute({ input: 'x' })).rejects.toThrow('tool failed');
  });

  it('works with tool that has no metadata', async () => {
    const tool: WranglerToolDef = {
      name: 'no_meta',
      description: 'No metadata',
      parameters: schema,
      execute: async (args) => ({ output: `result: ${args.input}` }),
    };
    const wrapped = wrapToColtsTool(tool);
    const result = await wrapped.execute({ input: 'test' });
    expect(result).toBe('result: test');
  });

  it('passes options (signal) to inner execute', async () => {
    const abortController = new AbortController();
    const tool = makeTool({
      execute: async (_args, options) => ({
        output: `signal: ${options?.signal?.aborted ?? 'none'}`,
      }),
    });
    const wrapped = wrapToColtsTool(tool);
    const result = await wrapped.execute({ input: 'x' }, { signal: abortController.signal });
    expect(result).toBe('signal: false');
  });
});
