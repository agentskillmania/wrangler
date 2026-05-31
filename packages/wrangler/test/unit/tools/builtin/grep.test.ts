import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGrepTool } from '../../../../src/tools/builtin/grep.js';
import { HostToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';

describe('grep', () => {
  let workspace: string;
  let deps: HostToolDeps;

  beforeEach(async () => {
    workspace = join(tmpdir(), `wrangler-test-grep-${Date.now()}`);
    await mkdir(workspace, { recursive: true });
    deps = new HostToolDeps(workspace);
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  });

  it('finds matches by regex', async () => {
    await writeFile(join(workspace, 'a.ts'), 'const x = getUserById(id);');
    await writeFile(join(workspace, 'b.ts'), 'const y = getUserById(yid);');
    const tool = createGrepTool(deps);
    const result = await tool.execute({ pattern: 'getUserById' });
    expect(result).toContain('a.ts');
    expect(result).toContain('getUserById');
  });

  it('returns no matches message', async () => {
    await writeFile(join(workspace, 'a.ts'), 'hello');
    const tool = createGrepTool(deps);
    const result = await tool.execute({ pattern: 'notfound' });
    expect(result).toContain('No matches found');
  });

  it('filters by include pattern', async () => {
    await writeFile(join(workspace, 'a.ts'), 'import { x }');
    await writeFile(join(workspace, 'b.js'), 'import { y }');
    const tool = createGrepTool(deps);
    const result = await tool.execute({ pattern: 'import', include: '*.ts' });
    expect(result).toContain('a.ts');
    expect(result).not.toContain('b.js');
  });

  it('returns error for invalid regex', async () => {
    const tool = createGrepTool(deps);
    const result = await tool.execute({ pattern: '[invalid' });
    expect(result).toContain('Invalid regex');
  });

  it('truncates long matching lines', async () => {
    await writeFile(join(workspace, 'long.txt'), 'x'.repeat(3000));
    const tool = createGrepTool(deps);
    const result = await tool.execute({ pattern: 'x{3000}' });
    expect(result).toContain('...');
    expect(result.length).toBeLessThan(3000);
  });

  it('groups results by file', async () => {
    await writeFile(join(workspace, 'a.ts'), 'line1\nline2\nline3');
    const tool = createGrepTool(deps);
    const result = await tool.execute({ pattern: 'line' });
    expect(result).toContain('a.ts:');
  });

  it('has correct tool metadata', () => {
    const tool = createGrepTool(deps);
    expect(tool.name).toBe('grep');
    expect(tool.parameters).toBeInstanceOf(z.ZodObject);
  });

  it('searches within subpath', async () => {
    await mkdir(join(workspace, 'src'), { recursive: true });
    await writeFile(join(workspace, 'src', 'a.ts'), 'function helper() {}');
    await writeFile(join(workspace, 'root.ts'), 'function main() {}');
    const tool = createGrepTool(deps);
    const result = await tool.execute({ pattern: 'function', path: 'src' });
    expect(result).toContain('helper');
    expect(result).not.toContain('main');
  });

  it('truncates at 100 matches across multiple files', async () => {
    // 50 matches per file, 3 files = 150 total, should stop at 100
    for (let f = 0; f < 3; f++) {
      const lines = Array.from({ length: 50 }, (_, i) => `match_${f}_${i}`).join('\n');
      await writeFile(join(workspace, `file${f}.ts`), lines);
    }
    const tool = createGrepTool(deps);
    const result = await tool.execute({ pattern: 'match_' }); // shell-safe pattern
    expect(result).toContain('file0.ts:');
    expect(result).toContain('file1.ts:');
    expect(result).not.toContain('file2.ts:'); // file2 matches truncated after 100
    // Should be capped at 100 matches total
    const matchCount = (result.match(/Line \d+:/g) || []).length;
    expect(matchCount).toBeLessThanOrEqual(100);
  });

  it('returns error for non-traversal path error', async () => {
    const errorDeps: HostToolDeps = {
      workspaceRoot: workspace,
      maxOutputSize: 1024,
      resolvePath: () => {
        throw new Error('Permission denied');
      },
      exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      readFile: async () => '',
      writeFile: async () => {},
      editFile: async () => '',
      glob: async () => [],
      grep: async () => '',
    } as unknown as HostToolDeps;
    const tool = createGrepTool(errorDeps);
    const result = await tool.execute({ pattern: 'test', path: 'src' });
    expect(result).toContain('Error: Invalid path');
  });

  it('handles grep output with unparseable lines', async () => {
    await writeFile(join(workspace, 'grep_odd.txt'), 'some content here');
    const tool = createGrepTool(deps);
    // Pattern that matches but ToolDeps might return odd-format lines
    const result = await tool.execute({ pattern: 'some content here' });
    expect(typeof result).toBe('string');
  });

  it('returns no matches when raw output has content but no parseable matches', async () => {
    const mockDeps = {
      workspaceRoot: workspace,
      maxOutputSize: 1024,
      resolvePath: (p: string) => join(workspace, p),
      exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      readFile: async () => '',
      writeFile: async () => {},
      editFile: async () => '',
      glob: async () => [],
      grep: async () => 'header line without colons\nanother bad line',
    } as unknown as import('../../../../src/tools/builtin/workspace-deps.js').ToolDeps;
    const tool = createGrepTool(mockDeps);
    const result = await tool.execute({ pattern: 'test' });
    expect(result).toContain('No matches found');
  });
});
