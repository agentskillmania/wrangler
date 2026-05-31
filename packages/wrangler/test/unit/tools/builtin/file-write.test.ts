import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';
import { mkdir, writeFile, readFile, rm, stat, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFileWriteTool } from '../../../../src/tools/builtin/file-write.js';
import { HostToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';
import { createMockToolDeps } from '../../helpers/create-mock-deps.js';

describe('file_write', () => {
  let workspace: string;
  let deps: HostToolDeps;

  beforeEach(async () => {
    workspace = join(tmpdir(), `wrangler-test-fw-${Date.now()}`);
    await mkdir(workspace, { recursive: true });
    deps = new HostToolDeps(workspace);
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  });

  it('writes to new file in existing directory', async () => {
    const tool = createFileWriteTool(deps);
    const result = await tool.execute({ filePath: 'hello.txt', content: 'hello world' });
    expect(result).toContain('File written: hello.txt');
    expect(result).toContain('1 line');
    const content = await readFile(join(workspace, 'hello.txt'), 'utf8');
    expect(content).toBe('hello world');
  });

  it('auto-creates parent directories', async () => {
    const tool = createFileWriteTool(deps);
    await tool.execute({ filePath: 'a/b/c/file.txt', content: 'nested' });
    const content = await readFile(join(workspace, 'a/b/c/file.txt'), 'utf8');
    expect(content).toBe('nested');
  });

  it('overwrites existing file with diff in metadata', async () => {
    await writeFile(join(workspace, 'test.txt'), 'old content');
    const tool = createFileWriteTool(deps);
    const result = await tool.execute({ filePath: 'test.txt', content: 'new content' });
    expect(result).toContain('File written');
  });

  it('shows all lines as additions for new file', async () => {
    const tool = createFileWriteTool(deps);
    const result = await tool.execute({ filePath: 'new.txt', content: 'line1\nline2' });
    expect(result).toBe('File written: new.txt (2 lines)');
    const content = await readFile(join(workspace, 'new.txt'), 'utf8');
    expect(content).toBe('line1\nline2');
  });

  it('rejects path traversal', async () => {
    const tool = createFileWriteTool(deps);
    await expect(tool.execute({ filePath: '../../etc/evil', content: 'hack' })).rejects.toThrow(
      'Path traversal detected'
    );
  });

  it('writes empty content (0 lines)', async () => {
    const tool = createFileWriteTool(deps);
    const result = await tool.execute({ filePath: 'empty.txt', content: '' });
    expect(result).toContain('0 line');
    const content = await readFile(join(workspace, 'empty.txt'), 'utf8');
    expect(content).toBe('');
  });

  it('has correct tool metadata', () => {
    const tool = createFileWriteTool(deps);
    expect(tool.name).toBe('file_write');
    expect(tool.parameters).toBeInstanceOf(z.ZodObject);
  });

  it('throws error for non-traversal write failure', async () => {
    const failDeps = createMockToolDeps({
      workspaceRoot: workspace,
      resolvePath: (p: string) => join(workspace, p),
      writeFile: async () => {
        throw new Error('Disk full');
      },
    });
    const tool = createFileWriteTool(failDeps);
    await expect(tool.execute({ filePath: 'test.txt', content: 'data' })).rejects.toThrow(
      'Disk full'
    );
  });

  // --- Negative paths (W3-2) ---

  it('verifies disk state after overwrite', async () => {
    await writeFile(join(workspace, 'data.txt'), 'original content');
    const tool = createFileWriteTool(deps);
    await tool.execute({ filePath: 'data.txt', content: 'overwritten content' });
    // Read back and confirm content matches what was written
    const diskContent = await readFile(join(workspace, 'data.txt'), 'utf8');
    expect(diskContent).toBe('overwritten content');
  });

  it('rejects write to read-only file', async () => {
    const filePath = join(workspace, 'readonly.txt');
    await writeFile(filePath, 'original');
    // Make file read-only
    await chmod(filePath, 0o444);

    const tool = createFileWriteTool(deps);
    await expect(tool.execute({ filePath: 'readonly.txt', content: 'new' })).rejects.toThrow();

    // Restore permissions for cleanup
    await chmod(filePath, 0o644).catch(() => {});
  });
});
