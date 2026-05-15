import { describe, it, expect } from 'vitest';
import { createBuiltinTools } from '../../../../src/tools/builtin/index.js';

describe('createBuiltinTools', () => {
  it('returns 10 colts Tool instances', () => {
    const tools = createBuiltinTools({ workspacePath: '/tmp/test-workspace' });
    expect(tools).toHaveLength(10);
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
    expect(names).toContain('shell');
    expect(names).toContain('python');
    expect(names).toContain('git');
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

  it('shell tool executes commands in host mode', async () => {
    const tools = createBuiltinTools({ workspacePath: '/tmp/test-workspace' });
    const shell = tools.find((t) => t.name === 'shell')!;
    const result = await shell.execute({ command: 'echo test' });
    expect(result).toContain('test');
  });

  it('python tool executes python code in host mode', async () => {
    const tools = createBuiltinTools({ workspacePath: '/tmp/test-workspace' });
    const python = tools.find((t) => t.name === 'python')!;
    const result = await python.execute({ code: 'print("hello from python")' });
    expect(result).toContain('hello from python');
  });

  it('git tool executes git commands in host mode', async () => {
    const tools = createBuiltinTools({ workspacePath: '/tmp/test-workspace' });
    const git = tools.find((t) => t.name === 'git')!;
    const result = await git.execute({ command: '--version' });
    expect(result).toContain('git version');
  });
});
