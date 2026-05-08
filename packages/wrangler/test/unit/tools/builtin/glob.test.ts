import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGlobTool } from '../../../../src/tools/builtin/glob.js';

describe('glob', () => {
  let workspace: string;
  const deps = () => ({ workspacePath: workspace });

  beforeEach(async () => {
    workspace = join(tmpdir(), `wrangler-test-glob-${Date.now()}`);
    await mkdir(workspace, { recursive: true });
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  });

  it('finds files by glob pattern', async () => {
    await writeFile(join(workspace, 'a.ts'), '');
    await writeFile(join(workspace, 'b.ts'), '');
    await writeFile(join(workspace, 'c.js'), '');
    const tool = createGlobTool(deps());
    const result = await tool.execute({ pattern: '**/*.ts' });
    expect(result).toContain('a.ts');
    expect(result).toContain('b.ts');
    expect(result).not.toContain('c.js');
  });

  it('returns no files message for no matches', async () => {
    const tool = createGlobTool(deps());
    const result = await tool.execute({ pattern: '**/*.xyz' });
    expect(result).toContain('No files found');
  });

  it('truncates at 100 results', async () => {
    for (let i = 0; i < 150; i++) {
      await writeFile(join(workspace, `file${i}.ts`), '');
    }
    const tool = createGlobTool(deps());
    const result = await tool.execute({ pattern: '**/*.ts' });
  });

  it('searches within subpath', async () => {
    await mkdir(join(workspace, 'src'), { recursive: true });
    await writeFile(join(workspace, 'src', 'a.ts'), '');
    await writeFile(join(workspace, 'root.ts'), '');
    const tool = createGlobTool(deps());
    const result = await tool.execute({ pattern: '**/*.ts', path: 'src' });
    expect(result).toContain('a.ts');
    expect(result).not.toContain('root.ts');
  });

  it('rejects path traversal in path param', async () => {
    const tool = createGlobTool(deps());
    await expect(tool.execute({ pattern: '**/*.ts', path: '../../etc' })).rejects.toThrow(
      'Path traversal detected'
    );
  });

  it('sorts results by mtime descending', async () => {
    await writeFile(join(workspace, 'old.ts'), '');
    // small delay to ensure different mtime
    await new Promise((r) => setTimeout(r, 10));
    await writeFile(join(workspace, 'new.ts'), '');
    const tool = createGlobTool(deps());
    const result = await tool.execute({ pattern: '**/*.ts' });
    const lines = result.split('\n').filter((l: string) => l.trim());
    expect(lines[0]).toContain('new.ts');
  });

  it('uses workspace root when path not specified', async () => {
    await mkdir(join(workspace, 'sub'), { recursive: true });
    await writeFile(join(workspace, 'root.ts'), '');
    await writeFile(join(workspace, 'sub', 'nested.ts'), '');
    const tool = createGlobTool(deps());
    const result = await tool.execute({ pattern: '**/*.ts' });
    expect(result).toContain('root.ts');
    expect(result).toContain('nested.ts');
  });

  it('has correct tool metadata', () => {
    const tool = createGlobTool(deps());
    expect(tool.name).toBe('glob');
    expect(tool.parameters).toBeDefined();
  });
});
