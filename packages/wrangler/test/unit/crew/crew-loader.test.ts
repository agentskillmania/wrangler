import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { CrewLoader } from '../../../src/crew/crew-loader.js';

const FIXTURE_DIR = join(__dirname, '../../fixtures/crew');

describe('CrewLoader', () => {
  it('loads config from fixture directory', async () => {
    const loader = new CrewLoader(FIXTURE_DIR);
    const config = await loader.load();

    expect(config.meta.name).toBe('test-crew');
    expect(config.meta.description).toBe('A test crew for unit tests');
    expect(config.meta.primaryAgent).toBe('primary');
    expect(config.memory).toContain('shared context');
    expect(config.agentDefs).toHaveProperty('primary');
    expect(config.agentDefs).toHaveProperty('searcher');
    expect(config.agentDefs.primary.model).toBe('gpt-4o');
    expect(config.agentDefs.searcher.description).toBe('Searches the web');
    expect(config.agentDefs.searcher.instructions).toContain('search agent');
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
      await rm(tmpDir, { recursive: true });
    }
  });
});
