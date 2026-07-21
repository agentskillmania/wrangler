import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { CrewLoader, crewToRunnerOptions } from '../../../src/crew/crew-loader.js';

const FIXTURE_DIR = join(__dirname, '../../fixtures/crew');

describe('CrewLoader', () => {
  it('loads crew meta from fixture directory', async () => {
    const loader = new CrewLoader(FIXTURE_DIR);
    const config = await loader.load();

    expect(config.meta).toEqual({
      name: 'test-crew',
      description: 'A test crew for unit tests',
      primaryAgent: 'primary',
    });
  });

  it('loads crew memory from fixture directory', async () => {
    const loader = new CrewLoader(FIXTURE_DIR);
    const config = await loader.load();

    expect(config.memory).toContain('shared context');
  });

  it('loads agent definitions from fixture directory', async () => {
    const loader = new CrewLoader(FIXTURE_DIR);
    const config = await loader.load();

    expect(Object.keys(config.agentDefs)).toEqual(['primary', 'searcher']);
    expect(config.agentDefs.primary).toMatchObject({
      name: 'primary',
      model: 'gpt-4o',
    });
    expect(config.agentDefs.searcher).toMatchObject({
      name: 'searcher',
      description: 'Searches the web',
      instructions: expect.stringContaining('search agent'),
    });
  });

  it('loads empty skillDirs when skills directory is absent', async () => {
    const loader = new CrewLoader(FIXTURE_DIR);
    const config = await loader.load();

    expect(config.skillDirs).toEqual([]);
  });

  it('uses meta.name as agentDefs key', async () => {
    const loader = new CrewLoader(FIXTURE_DIR);
    const config = await loader.load();

    expect(config.agentDefs.primary.name).toBe('primary');
    expect(config.agentDefs.searcher.name).toBe('searcher');
  });

  it('throws when directory does not exist', async () => {
    const loader = new CrewLoader('/nonexistent/path');
    await expect(loader.load()).rejects.toThrow('Crew directory not found');
  });

  it('throws when CREW.md does not exist', async () => {
    const tmpDir = join(__dirname, '../../fixtures/crew-no-md');
    try {
      await mkdir(tmpDir, { recursive: true });
      const loader = new CrewLoader(tmpDir);
      await expect(loader.load()).rejects.toThrow('CREW.md not found');
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('throws when CREW.md has no frontmatter', async () => {
    const tmpDir = join(__dirname, '../../fixtures/crew-bad-md');
    try {
      await mkdir(tmpDir, { recursive: true });
      await writeFile(join(tmpDir, 'CREW.md'), 'Just plain text without frontmatter');
      const loader = new CrewLoader(tmpDir);
      await expect(loader.load()).rejects.toThrow('YAML frontmatter');
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('throws when CREW.md frontmatter missing name', async () => {
    const tmpDir = join(__dirname, '../../fixtures/crew-no-name');
    try {
      await mkdir(tmpDir, { recursive: true });
      await writeFile(
        join(tmpDir, 'CREW.md'),
        '---\ndescription: test\nprimary-agent: primary\n---\nMemory'
      );
      const loader = new CrewLoader(tmpDir);
      await expect(loader.load()).rejects.toThrow('missing "name"');
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('throws when CREW.md frontmatter missing primary-agent', async () => {
    const tmpDir = join(__dirname, '../../fixtures/crew-no-primary');
    try {
      await mkdir(tmpDir, { recursive: true });
      await writeFile(
        join(tmpDir, 'CREW.md'),
        '---\nname: test-crew\ndescription: test\n---\nMemory'
      );
      const loader = new CrewLoader(tmpDir);
      await expect(loader.load()).rejects.toThrow('missing "primary-agent"');
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('returns empty agentDefs when agents/ directory missing', async () => {
    const tmpDir = join(__dirname, '../../fixtures/crew-no-agents');
    try {
      await mkdir(tmpDir, { recursive: true });
      await writeFile(
        join(tmpDir, 'CREW.md'),
        '---\nname: test-crew\nprimary-agent: primary\n---\nMemory'
      );
      const loader = new CrewLoader(tmpDir);
      const config = await loader.load();
      expect(config.agentDefs).toEqual({});
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('returns empty skillDirs when skills/ directory missing', async () => {
    const tmpDir = join(__dirname, '../../fixtures/crew-no-skills');
    try {
      await mkdir(tmpDir, { recursive: true });
      await mkdir(join(tmpDir, 'agents'), { recursive: true });
      await writeFile(
        join(tmpDir, 'CREW.md'),
        '---\nname: test-crew\nprimary-agent: primary\n---\nMemory'
      );
      const loader = new CrewLoader(tmpDir);
      const config = await loader.load();
      expect(config.skillDirs).toEqual([]);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('parses sandbox field from CREW.md frontmatter', async () => {
    const tmpDir = join(__dirname, '../../fixtures/crew-sandbox');
    try {
      await mkdir(tmpDir, { recursive: true });
      await writeFile(
        join(tmpDir, 'CREW.md'),
        '---\nname: sandbox-crew\nprimary-agent: primary\nsandbox: true\n---\nMemory'
      );
      const loader = new CrewLoader(tmpDir);
      const config = await loader.load();
      expect(config.meta.sandbox).toBe(true);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('defaults sandbox to undefined when not in CREW.md', async () => {
    const loader = new CrewLoader(FIXTURE_DIR);
    const config = await loader.load();
    expect(config.meta.sandbox).toBeUndefined();
  });

  // --- Negative paths (W3-1) ---

  it('rejects malformed YAML in CREW.md frontmatter', async () => {
    const tmpDir = join(__dirname, '../../fixtures/crew-bad-yaml');
    try {
      await mkdir(tmpDir, { recursive: true });
      await writeFile(join(tmpDir, 'CREW.md'), '---\nname: [broken: yaml: {{\n---\nMemory');
      const loader = new CrewLoader(tmpDir);
      await expect(loader.load()).rejects.toThrow();
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('handles empty skills directory', async () => {
    const tmpDir = join(__dirname, '../../fixtures/crew-empty-skills');
    try {
      await mkdir(tmpDir, { recursive: true });
      await mkdir(join(tmpDir, 'skills'), { recursive: true });
      await writeFile(
        join(tmpDir, 'CREW.md'),
        '---\nname: test-crew\nprimary-agent: primary\n---\nMemory'
      );
      const loader = new CrewLoader(tmpDir);
      const config = await loader.load();
      expect(config.skillDirs).toEqual([]);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('handles skills directory with non-directory entries', async () => {
    const tmpDir = join(__dirname, '../../fixtures/crew-skills-files');
    try {
      await mkdir(tmpDir, { recursive: true });
      const skillsDir = join(tmpDir, 'skills');
      await mkdir(skillsDir, { recursive: true });
      // Place a plain file in skills/ (not a directory)
      await writeFile(join(skillsDir, 'README.md'), 'Not a skill directory');
      await writeFile(
        join(tmpDir, 'CREW.md'),
        '---\nname: test-crew\nprimary-agent: primary\n---\nMemory'
      );
      const loader = new CrewLoader(tmpDir);
      const config = await loader.load();
      // Current implementation adds all entries (files and dirs) — verify the behavior
      expect(config.skillDirs).toHaveLength(1);
      expect(config.skillDirs[0]).toContain('README.md');
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('handles agent MD with no frontmatter — parsed as name-only agent', async () => {
    const tmpDir = join(__dirname, '../../fixtures/crew-agent-no-frontmatter');
    try {
      await mkdir(tmpDir, { recursive: true });
      const agentsDir = join(tmpDir, 'agents');
      await mkdir(agentsDir, { recursive: true });
      // Agent MD without frontmatter — parseAgentMd uses filename as fallback name
      await writeFile(join(agentsDir, 'plain.md'), 'Just instructions without frontmatter');
      await writeFile(
        join(tmpDir, 'CREW.md'),
        '---\nname: test-crew\nprimary-agent: primary\n---\nMemory'
      );
      const loader = new CrewLoader(tmpDir);
      const config = await loader.load();
      // parseAgentMd should gracefully handle missing frontmatter
      expect(config.agentDefs).toHaveProperty('plain');
      expect(config.agentDefs.plain.name).toBe('plain');
      expect(config.agentDefs.plain.instructions).toBe('Just instructions without frontmatter');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('crewToRunnerOptions', () => {
  it('sets inheritParentTools=true and inheritParentSkills=true on each sub-agent by default', async () => {
    // Build a minimal crew config inline — crewToRunnerOptions is pure
    // over CrewConfig, so no disk I/O needed.
    const crewConfig = {
      meta: {
        name: 'test-crew',
        description: 'd',
        primaryAgent: 'orchestrator',
      },
      memory: 'shared memory',
      agentDefs: {
        orchestrator: {
          name: 'orchestrator',
          instructions: 'You orchestrate.',
        },
        researcher: {
          name: 'researcher',
          description: 'Research helper',
          instructions: 'You research.',
        },
        coder: {
          name: 'coder',
          description: 'Code writer',
          instructions: 'You write code.',
        },
      },
      skillDirs: [],
    };

    const opts = crewToRunnerOptions(crewConfig as never);

    expect(opts.subAgents).toHaveLength(2);
    for (const sa of opts.subAgents) {
      expect(sa.inheritParentTools).toBe(true);
      expect(sa.inheritParentSkills).toBe(true);
    }
    expect(opts.subAgents.map((s) => s.name).sort()).toEqual(['coder', 'researcher']);
    expect(opts.primaryAgent).toBe('orchestrator');
  });

  it('composes system prompt from memory + primary instructions + sub-agent catalog', () => {
    const crewConfig = {
      meta: { name: 'c', description: '', primaryAgent: 'lead' },
      memory: 'CREW MEMORY HERE',
      agentDefs: {
        lead: { name: 'lead', instructions: 'LEAD INSTRUCTIONS' },
        worker: {
          name: 'worker',
          description: 'WORKER DESC',
          instructions: 'work',
        },
      },
      skillDirs: [],
    };

    const opts = crewToRunnerOptions(crewConfig as never);

    expect(opts.systemPrompt).toContain('CREW MEMORY HERE');
    expect(opts.systemPrompt).toContain('LEAD INSTRUCTIONS');
    expect(opts.systemPrompt).toContain('Available Sub-Agents');
    expect(opts.systemPrompt).toContain('**worker**: WORKER DESC');
  });
});
