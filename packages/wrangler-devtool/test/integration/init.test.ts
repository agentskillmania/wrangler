import { describe, it, expect } from 'vitest';
import { mkdtemp, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../../src/tools/init-project.js';

describe('US1: Initialize a project', () => {
  it('AC1.1: init --type agent creates correct directory structure', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));
    const targetDir = join(tempDir, 'my-agent');

    await initProject(targetDir, { type: 'agent' });

    await expect(access(join(targetDir, 'AGENT.md'))).resolves.toBeUndefined();
    await expect(access(join(targetDir, 'skills'))).resolves.toBeUndefined();
    await expect(access(join(targetDir, 'evals'))).resolves.toBeUndefined();
  });

  it('AC1.3: init --type crew creates correct directory structure', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));
    const targetDir = join(tempDir, 'my-crew');

    await initProject(targetDir, { type: 'crew' });

    await expect(access(join(targetDir, 'CREW.md'))).resolves.toBeUndefined();
    await expect(access(join(targetDir, 'agents'))).resolves.toBeUndefined();
    await expect(access(join(targetDir, 'skills'))).resolves.toBeUndefined();
    await expect(access(join(targetDir, 'evals'))).resolves.toBeUndefined();
  });

  it('AC1.4: AGENT.md contains valid frontmatter with name and description', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));
    const targetDir = join(tempDir, 'my-agent');

    await initProject(targetDir, { type: 'agent' });

    const { readFile } = await import('node:fs/promises');
    const content = await readFile(join(targetDir, 'AGENT.md'), 'utf-8');
    expect(content).toMatch(/^---\s*\n/);
    expect(content).toContain('name:');
    expect(content).toContain('description:');
  });
});
