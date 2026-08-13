import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { AgentLoader } from '../../../src/loader/index.js';
import { defaultNodeHostEnv } from '../../../src/host-env/node-host-env.js';

describe('AgentLoader', () => {
  it('loads agent from directory with AGENT.md', async () => {
    const tempDir = await mkdtemp('agent-loader-test-');
    try {
      const agentMd = `---
name: developer
description: Code specialist
model: claude-sonnet-4
thinking:
  enabled: true
---

You are a senior developer.`;
      await writeFile(join(tempDir, 'AGENT.md'), agentMd, 'utf-8');

      const result = await AgentLoader.loadFrom(tempDir, defaultNodeHostEnv);

      expect(result.name).toBe('developer');
      expect(result.description).toBe('Code specialist');
      expect(result.model).toBe('claude-sonnet-4');
      expect(result.thinking?.enabled).toBe(true);
      expect(result.instructions).toContain('You are a senior developer.');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('scans skills/ directory and returns skillDirs', async () => {
    const tempDir = await mkdtemp('agent-loader-test-');
    try {
      await writeFile(join(tempDir, 'AGENT.md'), 'name: test\n---\nInstructions', 'utf-8');
      await mkdir(join(tempDir, 'skills'), { recursive: true });
      await writeFile(join(tempDir, 'skills', 'skill1.md'), 'skill 1', 'utf-8');
      await writeFile(join(tempDir, 'skills', 'skill2.md'), 'skill 2', 'utf-8');

      const result = await AgentLoader.loadFrom(tempDir, defaultNodeHostEnv);

      expect(result.skillDirs).toHaveLength(2);
      expect(result.skillDirs).toContain(resolve(tempDir, 'skills', 'skill1.md'));
      expect(result.skillDirs).toContain(resolve(tempDir, 'skills', 'skill2.md'));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('collects mcp.json path when present', async () => {
    const tempDir = await mkdtemp('agent-loader-test-');
    try {
      await writeFile(join(tempDir, 'AGENT.md'), 'name: test\n---\nInstructions', 'utf-8');
      await writeFile(join(tempDir, 'mcp.json'), '{"servers": {}}', 'utf-8');

      const result = await AgentLoader.loadFrom(tempDir, defaultNodeHostEnv);

      expect(result.mcpPaths).toHaveLength(1);
      expect(result.mcpPaths[0]).toBe(resolve(tempDir, 'mcp.json'));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('returns empty arrays when skills/ and mcp.json absent', async () => {
    const tempDir = await mkdtemp('agent-loader-test-');
    try {
      await writeFile(join(tempDir, 'AGENT.md'), 'name: test\n---\nInstructions', 'utf-8');

      const result = await AgentLoader.loadFrom(tempDir, defaultNodeHostEnv);

      expect(result.skillDirs).toEqual([]);
      expect(result.mcpPaths).toEqual([]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('throws when AGENT.md not found', async () => {
    const tempDir = await mkdtemp('agent-loader-test-');
    try {
      await expect(AgentLoader.loadFrom(tempDir, defaultNodeHostEnv)).rejects.toThrow(
        'AGENT.md not found'
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('throws when directory does not exist', async () => {
    const nonExistentDir = '/tmp/non-existent-dir-12345';
    await expect(AgentLoader.loadFrom(nonExistentDir)).rejects.toThrow();
  });

  it('handles AGENT.md without frontmatter (name defaults to unknown)', async () => {
    const tempDir = await mkdtemp('agent-loader-test-');
    try {
      const agentMd = 'Just instructions without frontmatter';
      await writeFile(join(tempDir, 'AGENT.md'), agentMd, 'utf-8');

      const result = await AgentLoader.loadFrom(tempDir, defaultNodeHostEnv);

      expect(result.name).toBe('unknown');
      expect(result.instructions).toBe('Just instructions without frontmatter');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('handles skills directory with subdirectories', async () => {
    const tempDir = await mkdtemp('agent-loader-test-');
    try {
      await writeFile(join(tempDir, 'AGENT.md'), 'name: test\n---\nInstructions', 'utf-8');
      await mkdir(join(tempDir, 'skills'), { recursive: true });
      await mkdir(join(tempDir, 'skills', 'subdir'), { recursive: true });
      await writeFile(join(tempDir, 'skills', 'skill.md'), 'skill', 'utf-8');

      const result = await AgentLoader.loadFrom(tempDir, defaultNodeHostEnv);

      expect(result.skillDirs).toHaveLength(2);
      expect(result.skillDirs).toContain(resolve(tempDir, 'skills', 'skill.md'));
      expect(result.skillDirs).toContain(resolve(tempDir, 'skills', 'subdir'));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('handles malformed YAML in AGENT.md frontmatter', async () => {
    const tempDir = await mkdtemp('agent-loader-test-');
    try {
      const agentMd = `---
name: [invalid: yaml
---

Body text`;
      await writeFile(join(tempDir, 'AGENT.md'), agentMd, 'utf-8');

      const result = await AgentLoader.loadFrom(tempDir, defaultNodeHostEnv);

      expect(result.name).toBe('unknown');
      expect(result.instructions).toContain('Body text');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('parses all optional fields from AGENT.md', async () => {
    const tempDir = await mkdtemp('agent-loader-test-');
    try {
      const agentMd = `---
name: researcher
description: Deep analysis expert
model: claude-opus-4
thinking:
  enabled: false
---

Conduct thorough research.`;
      await writeFile(join(tempDir, 'AGENT.md'), agentMd, 'utf-8');

      const result = await AgentLoader.loadFrom(tempDir, defaultNodeHostEnv);

      expect(result.name).toBe('researcher');
      expect(result.description).toBe('Deep analysis expert');
      expect(result.model).toBe('claude-opus-4');
      expect(result.thinking?.enabled).toBe(false);
      expect(result.instructions).toContain('Conduct thorough research.');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
