import { describe, it, expect, vi } from 'vitest';
import { createBuiltinTools } from '../../../../src/tools/builtin/index.js';

describe('createBuiltinTools', () => {
  it('returns 11 colts Tool instances (calculator + 10 builtin)', () => {
    const tools = createBuiltinTools({ workspacePath: '/tmp/test-workspace' });
    expect(tools).toHaveLength(11);
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
    expect(names).toContain('calculate');
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
    // Should attempt to read from workspace path and throw when file missing
    await expect(fileRead.execute({ filePath: 'nonexistent.txt' })).rejects.toThrow(
      'File not found'
    );
  });

  it('web_search uses default BingScrapeSearchProvider when no provider configured', async () => {
    const tools = createBuiltinTools({ workspacePath: '/tmp/test-workspace' });
    const webSearch = tools.find((t) => t.name === 'web_search')!;
    expect(webSearch).toHaveProperty('name', 'web_search');
    expect(webSearch).toHaveProperty('parameters');
    expect(webSearch).toHaveProperty('execute');
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

  it('uses SandboxToolDeps when sandbox option is provided', async () => {
    const mockSandbox = {
      run: vi.fn().mockResolvedValue({ stdout: 'sandbox output', stderr: '', exitCode: 0 }),
    } as unknown as import('@agentskillmania/sandbox').Sandbox;
    const tools = createBuiltinTools({
      workspacePath: '/tmp/test-workspace',
      sandbox: mockSandbox,
    });
    expect(tools).toHaveLength(11);
    const shell = tools.find((t) => t.name === 'shell')!;
    const result = await shell.execute({ command: 'echo hi' });
    expect(result).toContain('sandbox output');
    expect(mockSandbox.run).toHaveBeenCalledWith('echo hi');
  });

  it('passes maxToolOutput to shell tool for truncation', async () => {
    const tools = createBuiltinTools({
      workspacePath: '/tmp/test-workspace',
      maxToolOutput: 500,
    });
    const shell = tools.find((t) => t.name === 'shell')!;
    const result = await shell.execute({ command: 'seq 1 100000' });
    expect(result).toContain('output truncated');
    // Output body capped at 500 chars + marker
    expect(result.length).toBeLessThanOrEqual(500 + 50);
  });

  it('passes toolTimeout to deps (construction succeeds)', () => {
    const tools = createBuiltinTools({
      workspacePath: '/tmp/test-workspace',
      toolTimeout: 30_000,
    });
    expect(tools).toHaveLength(11);
    // The timeout is applied internally to HostToolDeps/SandboxToolDeps;
    // verify the shell tool still works with a quick command
    const shell = tools.find((t) => t.name === 'shell')!;
    return expect(shell.execute({ command: 'echo ok' })).resolves.toContain('ok');
  });

  it('includes ask_human tool when askHumanHandler is provided', () => {
    const handler = vi.fn();
    const tools = createBuiltinTools({
      workspacePath: '/tmp/test-workspace',
      askHumanHandler: handler as never,
    });
    expect(tools).toHaveLength(12);
    expect(tools.map((t) => t.name)).toContain('ask_human');
  });

  it('omits ask_human tool when no askHumanHandler', () => {
    const tools = createBuiltinTools({ workspacePath: '/tmp/test-workspace' });
    expect(tools.map((t) => t.name)).not.toContain('ask_human');
  });
});
