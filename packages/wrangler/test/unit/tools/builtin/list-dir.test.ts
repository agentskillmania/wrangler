import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createListDirTool } from '../../../../src/tools/builtin/list-dir.js';
import { HostToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';
import { NodeHostEnv } from '../../../../src/host-env/node-host-env.js';

describe('list_dir', () => {
  let workspace: string;
  let deps: HostToolDeps;

  beforeEach(async () => {
    workspace = join(tmpdir(), `wrangler-test-listdir-${Date.now()}`);
    await mkdir(workspace, { recursive: true });
    deps = new HostToolDeps(new NodeHostEnv(), workspace);
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  });

  it('lists direct children sorted', async () => {
    await writeFile(join(workspace, 'b.ts'), '');
    await writeFile(join(workspace, 'a.ts'), '');
    await mkdir(join(workspace, 'sub'), { recursive: true });
    const tool = createListDirTool(deps);
    const result = await tool.execute({});
    const lines = (result as string).split('\n');
    expect(lines).toEqual(['a.ts', 'b.ts', 'sub']);
  });

  it('lists a subdirectory when path is given', async () => {
    await mkdir(join(workspace, 'sub'), { recursive: true });
    await writeFile(join(workspace, 'sub', 'inner.txt'), '');
    const tool = createListDirTool(deps);
    const result = await tool.execute({ path: 'sub' });
    expect(result).toBe('inner.txt');
  });

  it('reports empty directory', async () => {
    await mkdir(join(workspace, 'empty'), { recursive: true });
    const tool = createListDirTool(deps);
    const result = await tool.execute({ path: 'empty' });
    expect(result).toBe('(empty directory)');
  });

  it('errors on missing path', async () => {
    const tool = createListDirTool(deps);
    await expect(tool.execute({ path: 'nope' })).rejects.toThrow('Path not found: nope');
  });

  it('errors on a file', async () => {
    await writeFile(join(workspace, 'f.txt'), 'x');
    const tool = createListDirTool(deps);
    await expect(tool.execute({ path: 'f.txt' })).rejects.toThrow('Not a directory: f.txt');
  });
});
