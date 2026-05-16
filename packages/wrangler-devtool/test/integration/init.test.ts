import { describe, it, expect } from 'vitest';
import { mkdtemp, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initWorkspace } from '../../src/tools/init-workspace.js';

describe('US1: Initialize a workspace', () => {
  it('AC1.1: init --mode agent creates correct directory structure', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));
    const targetDir = join(tempDir, 'my-agent');

    await initWorkspace(targetDir, { mode: 'agent' });

    await expect(access(join(targetDir, 'AGENT.md'))).resolves.toBeUndefined();
    await expect(access(join(targetDir, 'skills'))).resolves.toBeUndefined();
    await expect(access(join(targetDir, 'test'))).resolves.toBeUndefined();
  });

  it('AC1.3: init --mode crew creates correct directory structure', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));
    const targetDir = join(tempDir, 'my-crew');

    await initWorkspace(targetDir, { mode: 'crew' });

    await expect(access(join(targetDir, 'CREW.md'))).resolves.toBeUndefined();
    await expect(access(join(targetDir, 'agents'))).resolves.toBeUndefined();
    await expect(access(join(targetDir, 'skills'))).resolves.toBeUndefined();
    await expect(access(join(targetDir, 'test'))).resolves.toBeUndefined();
  });

  it('AC1.4: AGENT.md contains valid frontmatter with name and description', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));
    const targetDir = join(tempDir, 'my-agent');

    await initWorkspace(targetDir, { mode: 'agent' });

    const { readFile } = await import('node:fs/promises');
    const content = await readFile(join(targetDir, 'AGENT.md'), 'utf-8');
    expect(content).toMatch(/^---\s*\n/);
    expect(content).toContain('name:');
    expect(content).toContain('description:');
  });
});
