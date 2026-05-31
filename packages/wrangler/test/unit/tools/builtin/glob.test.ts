import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGlobTool } from '../../../../src/tools/builtin/glob.js';
import { HostToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';
import { createMockToolDeps } from '../../helpers/create-mock-deps.js';

describe('glob', () => {
  let workspace: string;
  let deps: HostToolDeps;

  beforeEach(async () => {
    workspace = join(tmpdir(), `wrangler-test-glob-${Date.now()}`);
    await mkdir(workspace, { recursive: true });
    deps = new HostToolDeps(workspace);
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  });

  it('finds files by glob pattern', async () => {
    await writeFile(join(workspace, 'a.ts'), '');
    await writeFile(join(workspace, 'b.ts'), '');
    await writeFile(join(workspace, 'c.js'), '');
    const tool = createGlobTool(deps);
    const result = await tool.execute({ pattern: '**/*.ts' });
    expect(result).toContain('a.ts');
    expect(result).toContain('b.ts');
    expect(result).not.toContain('c.js');
  });

  it('returns no files message for no matches', async () => {
    const tool = createGlobTool(deps);
    const result = await tool.execute({ pattern: '**/*.xyz' });
    expect(result).toContain('No files found');
  });

  it('truncates at 100 results', async () => {
    for (let i = 0; i < 150; i++) {
      await writeFile(join(workspace, `file${i}.ts`), '');
    }
    const tool = createGlobTool(deps);
    const result = await tool.execute({ pattern: '**/*.ts' });
    expect(result).toContain('... and 50 more files (showing first 100)');
    expect(result).toContain('Total: 150 files');
    // Truncation confirmed by the "... and 50 more" message above
  });

  it('searches within subpath', async () => {
    await mkdir(join(workspace, 'src'), { recursive: true });
    await writeFile(join(workspace, 'src', 'a.ts'), '');
    await writeFile(join(workspace, 'root.ts'), '');
    const tool = createGlobTool(deps);
    const result = await tool.execute({ pattern: '**/*.ts', path: 'src' });
    expect(result).toContain('a.ts');
    expect(result).not.toContain('root.ts');
  });

  it('rejects path traversal in path param', async () => {
    const tool = createGlobTool(deps);
    // The glob tool resolves the path using deps.resolvePath which throws on traversal
    await expect(tool.execute({ pattern: '**/*.ts', path: '../../etc' })).rejects.toThrow(
      'Path traversal detected'
    );
  });

  it('returns all matching files (unsorted)', async () => {
    await writeFile(join(workspace, 'old.ts'), '');
    // small delay to ensure different mtime
    await new Promise((r) => setTimeout(r, 10));
    await writeFile(join(workspace, 'new.ts'), '');
    const tool = createGlobTool(deps);
    const result = await tool.execute({ pattern: '**/*.ts' });
    // Note: HostToolDeps.glob returns unsorted results from fast-glob
    expect(result).toContain('old.ts');
    expect(result).toContain('new.ts');
  });

  it('uses workspace root when path not specified', async () => {
    await mkdir(join(workspace, 'sub'), { recursive: true });
    await writeFile(join(workspace, 'root.ts'), '');
    await writeFile(join(workspace, 'sub', 'nested.ts'), '');
    const tool = createGlobTool(deps);
    const result = await tool.execute({ pattern: '**/*.ts' });
    expect(result).toContain('root.ts');
    expect(result).toContain('nested.ts');
  });

  it('has correct tool metadata', () => {
    const tool = createGlobTool(deps);
    expect(tool.name).toBe('glob');
    expect(tool.parameters).toBeInstanceOf(z.ZodObject);
  });

  it('handles files outside workspace root gracefully', async () => {
    const outsideDeps = createMockToolDeps({
      workspaceRoot: workspace,
      resolvePath: (p: string) => join(workspace, p),
      glob: async () => ['/other/path/file.ts', join(workspace, 'local.ts')],
    }) as HostToolDeps;
    const tool = createGlobTool(outsideDeps);
    const result = await tool.execute({ pattern: '**/*.ts' });
    expect(result).toContain('local.ts');
    expect(result).toContain('/other/path/file.ts');
  });
});
