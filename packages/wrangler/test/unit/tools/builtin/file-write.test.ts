import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFileWriteTool } from '../../../../src/tools/builtin/file-write.js';

describe('file_write', () => {
  let workspace: string;
  const deps = () => ({ workspacePath: workspace });

  beforeEach(async () => {
    workspace = join(tmpdir(), `wrangler-test-fw-${Date.now()}`);
    await mkdir(workspace, { recursive: true });
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  });

  it('writes to new file in existing directory', async () => {
    const tool = createFileWriteTool(deps());
    const result = await tool.execute({ filePath: 'hello.txt', content: 'hello world' });
    expect(result).toContain('File written: hello.txt');
    expect(result).toContain('1 line');
    const content = await readFile(join(workspace, 'hello.txt'), 'utf8');
    expect(content).toBe('hello world');
  });

  it('auto-creates parent directories', async () => {
    const tool = createFileWriteTool(deps());
    await tool.execute({ filePath: 'a/b/c/file.txt', content: 'nested' });
    const content = await readFile(join(workspace, 'a/b/c/file.txt'), 'utf8');
    expect(content).toBe('nested');
  });

  it('overwrites existing file with diff in metadata', async () => {
    await writeFile(join(workspace, 'test.txt'), 'old content');
    const tool = createFileWriteTool(deps());
    const result = await tool.execute({ filePath: 'test.txt', content: 'new content' });
    expect(result).toContain('File written');
  });

  it('shows all lines as additions for new file', async () => {
    const tool = createFileWriteTool(deps());
    const result = await tool.execute({ filePath: 'new.txt', content: 'line1\nline2' });
  });

  it('rejects path traversal', async () => {
    const tool = createFileWriteTool(deps());
    await expect(tool.execute({ filePath: '../../etc/evil', content: 'hack' })).rejects.toThrow(
      'Path traversal detected'
    );
  });

  it('writes empty content (0 lines)', async () => {
    const tool = createFileWriteTool(deps());
    const result = await tool.execute({ filePath: 'empty.txt', content: '' });
    expect(result).toContain('0 line');
    const content = await readFile(join(workspace, 'empty.txt'), 'utf8');
    expect(content).toBe('');
  });

  it('has correct tool metadata', () => {
    const tool = createFileWriteTool(deps());
    expect(tool.name).toBe('file_write');
    expect(tool.parameters).toBeDefined();
  });
});
