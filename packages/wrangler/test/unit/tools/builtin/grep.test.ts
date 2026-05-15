import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
    expect(tool.parameters).toBeDefined();
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
    const result = await tool.execute({ pattern: 'match_\\d+_\\d+' });
  });
});
