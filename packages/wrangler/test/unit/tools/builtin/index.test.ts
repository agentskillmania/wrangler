import { describe, it, expect } from 'vitest';
import { createBuiltinTools } from '../../../../src/tools/builtin/index.js';

describe('createBuiltinTools', () => {
  it('returns 7 colts Tool instances', () => {
    const tools = createBuiltinTools({ workspacePath: '/tmp/test-workspace' });
    expect(tools).toHaveLength(7);
    for (const tool of tools) {
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('parameters');
      expect(tool).toHaveProperty('execute');
      expect(typeof tool.execute).toBe('function');
    }
  });

  it('includes all expected tool names', () => {
    const tools = createBuiltinTools({ workspacePath: '/tmp/test-workspace' });
    const names = tools.map((t) => t.name);
    expect(names).toContain('file_read');
    expect(names).toContain('file_write');
    expect(names).toContain('file_edit');
    expect(names).toContain('glob');
    expect(names).toContain('grep');
    expect(names).toContain('web_fetch');
    expect(names).toContain('web_search');
  });

  it('passes workspace config to file tools', async () => {
    const tools = createBuiltinTools({ workspacePath: '/tmp/test-workspace' });
    const fileRead = tools.find((t) => t.name === 'file_read')!;
    const result = await fileRead.execute({ filePath: 'nonexistent.txt' });
    // Should attempt to read from workspace path, not throw about bad path
    expect(result).toBeTypeOf('string');
  });

  it('web_search returns stub when no provider configured', async () => {
    const tools = createBuiltinTools({ workspacePath: '/tmp/test-workspace' });
    const webSearch = tools.find((t) => t.name === 'web_search')!;
    const result = await webSearch.execute({ query: 'test' });
    expect(result).toContain('not configured');
  });

  it('includes shell tool when sandbox provided', () => {
    const tools = createBuiltinTools({
      workspacePath: '/tmp/test-workspace',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox: {} as any,
    });
    expect(tools).toHaveLength(8);
    const names = tools.map((t) => t.name);
    expect(names).toContain('shell');
  });

  it('does not include shell tool when no sandbox', () => {
    const tools = createBuiltinTools({ workspacePath: '/tmp/test-workspace' });
    const names = tools.map((t) => t.name);
    expect(names).not.toContain('shell');
  });
});
