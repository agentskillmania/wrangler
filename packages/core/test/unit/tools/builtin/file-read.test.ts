import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFileReadTool } from '../../../../src/tools/builtin/file-read.js';

describe('file_read', () => {
  let workspace: string;
  const deps = () => ({ workspacePath: workspace });

  beforeEach(async () => {
    workspace = join(tmpdir(), `wrangler-test-fr-${Date.now()}`);
    await mkdir(workspace, { recursive: true });
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  });

  it('reads file with line-numbered output', async () => {
    await writeFile(join(workspace, 'test.txt'), 'hello\nworld\n');
    const tool = createFileReadTool(deps());
    const result = await tool.execute({ filePath: 'test.txt' });
    expect(result.output).toContain('1:hello');
    expect(result.output).toContain('2:world');
    expect(result.metadata).toMatchObject({
      path: 'test.txt',
      totalLines: 2,
      offset: 1,
      truncated: false,
    });
  });

  it('reads with offset and limit', async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
    await writeFile(join(workspace, 'test.txt'), lines.join('\n'));
    const tool = createFileReadTool(deps());
    const result = await tool.execute({ filePath: 'test.txt', offset: 3, limit: 2 });
    expect(result.output).toContain('3:line 3');
    expect(result.output).toContain('4:line 4');
    expect(result.output).not.toContain('2:line 2');
    expect(result.output).not.toContain('5:line 5');
    expect(result.metadata?.totalLines).toBe(10);
  });

  it('returns error for non-existent file', async () => {
    const tool = createFileReadTool(deps());
    const result = await tool.execute({ filePath: 'nope.txt' });
    expect(result.output).toContain('Error: File not found');
  });

  it('rejects path traversal', async () => {
    const tool = createFileReadTool(deps());
    await expect(tool.execute({ filePath: '../../etc/passwd' })).rejects.toThrow(
      'Path traversal detected'
    );
  });

  it('rejects binary file', async () => {
    await writeFile(join(workspace, 'test.zip'), 'fake zip');
    const tool = createFileReadTool(deps());
    const result = await tool.execute({ filePath: 'test.zip' });
    expect(result.output).toContain('Error: Cannot read binary file');
  });

  it('truncates long lines to 2000 chars', async () => {
    await writeFile(join(workspace, 'long.txt'), 'x'.repeat(3000));
    const tool = createFileReadTool(deps());
    const result = await tool.execute({ filePath: 'long.txt' });
    const line1 = result.output.split('\n')[0];
    // "1:" prefix + 2000 chars + "..."
    expect(line1).toContain('...');
    expect(line1.length).toBeLessThan(2100);
  });

  it('shows pagination hint for large files', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    await writeFile(join(workspace, 'big.txt'), lines.join('\n'));
    const tool = createFileReadTool(deps());
    const result = await tool.execute({ filePath: 'big.txt', limit: 10 });
    expect(result.output).toContain('Use offset=11 to continue reading');
  });

  it('handles empty file', async () => {
    await writeFile(join(workspace, 'empty.txt'), '');
    const tool = createFileReadTool(deps());
    const result = await tool.execute({ filePath: 'empty.txt' });
    expect(result.metadata?.totalLines).toBe(0);
  });

  it('has correct tool metadata', () => {
    const tool = createFileReadTool(deps());
    expect(tool.name).toBe('file_read');
    expect(tool.description).toBeTruthy();
    expect(tool.parameters).toBeDefined();
  });
});
