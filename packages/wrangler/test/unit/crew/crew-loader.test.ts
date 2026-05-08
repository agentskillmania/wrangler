import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CrewLoader } from '../../../src/crew/crew-loader.js';

describe('CrewLoader', () => {
  let tmpDir: string;
  let crewDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `crew-loader-test-${Date.now()}`);
    crewDir = join(tmpDir, 'test-crew');
    await mkdir(join(crewDir, 'agents'), { recursive: true });
    await mkdir(join(crewDir, 'skills', 'code-review'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('loads a valid crew directory', async () => {
    await writeFile(
      join(crewDir, 'CREW.md'),
      `---
name: test-crew
description: A test crew
primary-agent: pm
---

## Crew Memory
- Use TypeScript strict mode
`
    );
    await writeFile(
      join(crewDir, 'agents', 'pm.md'),
      `---
name: pm
description: Project manager
---

You are a project manager.`
    );
    await writeFile(
      join(crewDir, 'agents', 'developer.md'),
      `---
name: developer
description: Developer
skills:
  - code-review
---

You are a developer.`
    );

    const loader = new CrewLoader(crewDir);
    const config = await loader.load();

    expect(config.meta.name).toBe('test-crew');
    expect(config.meta.primaryAgent).toBe('pm');
    expect(config.memory).toContain('TypeScript strict mode');
    expect(config.agentDefs['pm']).toBeDefined();
    expect(config.agentDefs['developer']).toBeDefined();
    expect(config.agentDefs['developer'].meta.skills).toEqual(['code-review']);
  });

  it('throws if CREW.md is missing', async () => {
    const loader = new CrewLoader(crewDir);
    await expect(loader.load()).rejects.toThrow('CREW.md');
  });

  it('throws if primary-agent is missing in CREW.md', async () => {
    await writeFile(
      join(crewDir, 'CREW.md'),
      `---
name: test-crew
description: No primary
---

Memory here`
    );

    const loader = new CrewLoader(crewDir);
    await expect(loader.load()).rejects.toThrow('primary-agent');
  });

  it('throws if agents directory is empty', async () => {
    await writeFile(
      join(crewDir, 'CREW.md'),
      `---
name: test-crew
description: A test crew
primary-agent: pm
---

Memory`
    );

    const loader = new CrewLoader(crewDir);
    await expect(loader.load()).rejects.toThrow('agent');
  });

  it('scans skills directories', async () => {
    await writeFile(
      join(crewDir, 'CREW.md'),
      `---
name: test-crew
description: A test crew
primary-agent: pm
---

Memory`
    );
    await writeFile(
      join(crewDir, 'agents', 'pm.md'),
      `---
name: pm
description: PM
---

You are a PM.`
    );
    await writeFile(join(crewDir, 'skills', 'code-review', 'SKILL.md'), 'Code review skill');

    const loader = new CrewLoader(crewDir);
    const config = await loader.load();

    expect(config.skillDirs.length).toBeGreaterThanOrEqual(1);
    expect(config.skillDirs[0]).toContain('code-review');
  });

  it('getAgent returns specific agent definition', async () => {
    await writeFile(
      join(crewDir, 'CREW.md'),
      `---
name: test-crew
description: A test crew
primary-agent: pm
---

Memory`
    );
    await writeFile(
      join(crewDir, 'agents', 'pm.md'),
      `---
name: pm
description: PM
---

You are a PM.`
    );

    const loader = new CrewLoader(crewDir);
    const agent = await loader.getAgent('pm');
    expect(agent).not.toBeNull();
    expect(agent!.meta.name).toBe('pm');
  });

  it('getAgent returns null for non-existent agent', async () => {
    await writeFile(
      join(crewDir, 'CREW.md'),
      `---
name: test-crew
description: A test crew
primary-agent: pm
---

Memory`
    );
    await writeFile(
      join(crewDir, 'agents', 'pm.md'),
      `---
name: pm
description: PM
---

You are a PM.`
    );

    const loader = new CrewLoader(crewDir);
    const agent = await loader.getAgent('nonexistent');
    expect(agent).toBeNull();
  });
});
