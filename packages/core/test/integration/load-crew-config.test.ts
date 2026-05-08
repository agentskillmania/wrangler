/**
 * US1: 加载 crew 配置
 *
 * 作为开发者，我通过 CrewLoader 从 crew 目录加载 CREW.md 和 agents/*.md，
 * 获取完整的 crew 定义。静态配置与动态状态分离。
 *
 * No LLM required — pure filesystem parsing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CrewLoader } from '../../src/crew/crew-loader.js';

describe('US1: 加载 crew 配置', () => {
  let tmpDir: string;
  let crewDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `wrangler-intg-l6us1-${Date.now()}`);
    crewDir = join(tmpDir, 'my-crew');
    await mkdir(join(crewDir, 'agents'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('loads complete crew config from directory', async () => {
    await mkdir(join(crewDir, 'skills', 'testing'), { recursive: true });
    await writeFile(
      join(crewDir, 'CREW.md'),
      `---
name: dev-team
description: A development team
primary-agent: pm
---

## Crew Memory
- All code must have unit tests
- Use TypeScript strict mode
- Follow SOLID principles
`
    );

    await writeFile(
      join(crewDir, 'agents', 'pm.md'),
      `---
name: pm
description: Project manager who coordinates tasks
skills:
  - testing
---

You are a project manager. You delegate tasks and track progress.`
    );

    await writeFile(
      join(crewDir, 'agents', 'developer.md'),
      `---
name: developer
description: Senior developer
thinking:
  enabled: true
---

You are a senior developer who writes clean, tested code.`
    );

    await writeFile(join(crewDir, 'skills', 'testing', 'SKILL.md'), 'Testing best practices');

    const loader = new CrewLoader(crewDir);
    const config = await loader.load();

    // Verify meta
    expect(config.meta.name).toBe('dev-team');
    expect(config.meta.description).toBe('A development team');
    expect(config.meta.primaryAgent).toBe('pm');

    // Verify memory
    expect(config.memory).toContain('unit tests');
    expect(config.memory).toContain('TypeScript strict mode');

    // Verify agent definitions
    expect(Object.keys(config.agentDefs)).toHaveLength(2);
    expect(config.agentDefs['pm']).toBeDefined();
    expect(config.agentDefs['pm'].meta.skills).toEqual(['testing']);
    expect(config.agentDefs['developer']).toBeDefined();
    expect(config.agentDefs['developer'].meta.thinking?.enabled).toBe(true);
    expect(config.agentDefs['developer'].instructions).toContain('senior developer');

    // Verify skill directories
    expect(config.skillDirs.length).toBeGreaterThan(0);
    expect(config.skillDirs[0]).toContain('testing');
  });

  it('validates primary-agent exists in agent definitions', async () => {
    await writeFile(
      join(crewDir, 'CREW.md'),
      `---
name: broken-crew
description: Crew with invalid primary
primary-agent: nonexistent
---

Memory`
    );

    await writeFile(
      join(crewDir, 'agents', 'dev.md'),
      `---
name: dev
description: Developer
---

You are a developer.`
    );

    const loader = new CrewLoader(crewDir);
    await expect(loader.load()).rejects.toThrow('nonexistent');
  });

  it('validates CREW.md has primary-agent field', async () => {
    await writeFile(
      join(crewDir, 'CREW.md'),
      `---
name: no-primary
description: Missing primary
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
    await expect(loader.load()).rejects.toThrow('primary-agent');
  });

  it('validates agents directory is not empty', async () => {
    await writeFile(
      join(crewDir, 'CREW.md'),
      `---
name: empty-agents
description: No agents
primary-agent: pm
---

Memory`
    );

    const loader = new CrewLoader(crewDir);
    await expect(loader.load()).rejects.toThrow('agent');
  });

  it('works without skills directory', async () => {
    await writeFile(
      join(crewDir, 'CREW.md'),
      `---
name: minimal-crew
description: Minimal
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
    const config = await loader.load();

    expect(config.meta.name).toBe('minimal-crew');
    expect(config.skillDirs).toEqual([]);
  });
});
