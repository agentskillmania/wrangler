import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFileReadTool } from '../../../../src/tools/builtin/file-read.js';
import { HostToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';
import type { ToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';
import { NodeHostEnv } from '../../../../src/host-env/index.js';

/**
 * Create a mock ToolDeps with default implementations.
 * Individual tests override specific methods as needed.
 */
function createMockDeps(overrides?: Partial<ToolDeps>): ToolDeps {
  return {
    workspaceRoot: '/workspace',
    maxOutputSize: 1024 * 1024,
    resolvePath: vi.fn((filePath: string) => `/workspace/${filePath}`),
    exec: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    editFile: vi.fn(),
    glob: vi.fn(),
    grep: vi.fn(),
    statFile: vi.fn(async () => ({ exists: true, isFile: true })),
    isBinaryFile: vi.fn(async () => false),
    ...overrides,
  } as unknown as ToolDeps;
}

describe('file_read', () => {
  let workspace: string;
  let deps: HostToolDeps;

  beforeEach(async () => {
    workspace = join(tmpdir(), `wrangler-test-fr-${Date.now()}`);
    await mkdir(workspace, { recursive: true });
    deps = new HostToolDeps(new NodeHostEnv(), workspace);
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  });

  // Real filesystem tests using HostToolDeps

  it('reads file with line-numbered output', async () => {
    await writeFile(join(workspace, 'test.txt'), 'hello\nworld\n');
    const tool = createFileReadTool(deps);
    const result = await tool.execute({ filePath: 'test.txt' });
    expect(result).toContain('1:hello');
    expect(result).toContain('2:world');
  });

  it('reads with offset and limit', async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
    await writeFile(join(workspace, 'test.txt'), lines.join('\n'));
    const tool = createFileReadTool(deps);
    const result = await tool.execute({ filePath: 'test.txt', offset: 3, limit: 2 });
    expect(result).toContain('3:line 3');
    expect(result).toContain('4:line 4');
    expect(result).not.toContain('2:line 2');
    expect(result).not.toContain('5:line 5');
  });

  it('throws error for non-existent file', async () => {
    const tool = createFileReadTool(deps);
    await expect(tool.execute({ filePath: 'nope.txt' })).rejects.toThrow('File not found');
  });

  it('rejects path traversal', async () => {
    const tool = createFileReadTool(deps);
    await expect(tool.execute({ filePath: '../../etc/passwd' })).rejects.toThrow(
      'Path traversal detected'
    );
  });

  it('rejects binary file', async () => {
    const buf = Buffer.alloc(100);
    for (let i = 0; i < 50; i++) buf[i] = 0;
    await writeFile(join(workspace, 'test.zip'), buf);
    const tool = createFileReadTool(deps);
    const result = await tool.execute({ filePath: 'test.zip' });
    expect(result).toContain('Error: Cannot read binary file');
  });

  it('truncates long lines to 2000 chars', async () => {
    await writeFile(join(workspace, 'long.txt'), 'x'.repeat(3000));
    const tool = createFileReadTool(deps);
    const result = await tool.execute({ filePath: 'long.txt' });
    const line1 = result.split('\n')[0];
    expect(line1).toContain('...');
    expect(line1.length).toBeLessThan(2100);
  });

  it('shows pagination hint for large files', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    await writeFile(join(workspace, 'big.txt'), lines.join('\n'));
    const tool = createFileReadTool(deps);
    const result = await tool.execute({ filePath: 'big.txt', limit: 10 });
    expect(result).toContain('Use offset=11 to continue reading');
  });

  it('handles empty file', async () => {
    await writeFile(join(workspace, 'empty.txt'), '');
    const tool = createFileReadTool(deps);
    const result = await tool.execute({ filePath: 'empty.txt' });
    expect(result).toBe('Total lines: 0');
  });

  it('returns error when offset exceeds file length', async () => {
    await writeFile(join(workspace, 'short.txt'), 'line1\nline2\n');
    const tool = createFileReadTool(deps);
    const result = await tool.execute({ filePath: 'short.txt', offset: 100 });
    expect(result).toContain('offset 100 exceeds file length');
  });

  it('has correct tool metadata', () => {
    const tool = createFileReadTool(deps);
    expect(tool.name).toBe('file_read');
    expect(tool.description).toContain('Read file contents');
    expect(tool.parameters).toBeInstanceOf(z.ZodObject);
  });

  // Mock deps tests — verify file_read uses deps, not Node.js APIs

  describe('uses deps methods (not Node.js APIs)', () => {
    it('calls deps.statFile() to check file existence', async () => {
      const mockDeps = createMockDeps({
        statFile: vi.fn(async () => ({ exists: false, isFile: false })),
      });
      const tool = createFileReadTool(mockDeps);
      await expect(tool.execute({ filePath: 'test.txt' })).rejects.toThrow('File not found');
      expect(mockDeps.statFile).toHaveBeenCalledWith('test.txt');
    });

    it('calls deps.statFile() and returns error for directory', async () => {
      const mockDeps = createMockDeps({
        statFile: vi.fn(async () => ({ exists: true, isFile: false })),
      });
      const tool = createFileReadTool(mockDeps);
      const result = await tool.execute({ filePath: 'somedir' });
      expect(result).toContain('Error: Not a file');
    });

    it('calls deps.isBinaryFile() to detect binary', async () => {
      const mockDeps = createMockDeps({
        statFile: vi.fn(async () => ({ exists: true, isFile: true })),
        isBinaryFile: vi.fn(async () => true),
      });
      const tool = createFileReadTool(mockDeps);
      const result = await tool.execute({ filePath: 'image.png' });
      expect(result).toContain('Error: Cannot read binary file');
      expect(mockDeps.isBinaryFile).toHaveBeenCalledWith('image.png');
    });

    it('calls deps.readFile() to get content', async () => {
      const mockDeps = createMockDeps({
        statFile: vi.fn(async () => ({ exists: true, isFile: true })),
        isBinaryFile: vi.fn(async () => false),
        readFile: vi.fn(async () => 'hello\nworld\n'),
      });
      const tool = createFileReadTool(mockDeps);
      const result = await tool.execute({ filePath: 'test.txt' });
      expect(result).toContain('1:hello');
      expect(result).toContain('2:world');
      expect(mockDeps.readFile).toHaveBeenCalledWith('test.txt');
    });

    it('throws permission denied from statFile EACCES', async () => {
      const mockDeps = createMockDeps({
        statFile: vi.fn(async () => {
          throw new Error('Permission denied: secret.txt');
        }),
      });
      const tool = createFileReadTool(mockDeps);
      await expect(tool.execute({ filePath: 'secret.txt' })).rejects.toThrow('Permission denied');
    });
  });
});
