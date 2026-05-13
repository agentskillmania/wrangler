import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { parseAgentMd } from '../agent/agent-loader.js';
import type { CrewConfig } from './types.js';
import type { ParsedAgent } from '../agent/agent-loader.js';

interface CrewMeta {
  name: string;
  description?: string;
  'primary-agent': string;
}

/**
 * Loads CrewConfig from a crew directory.
 *
 * Expected directory structure:
 * - CREW.md (YAML frontmatter for meta, body as memory)
 * - agents/*.md (Layer 5 agent definitions)
 * - skills/ (skill directories)
 */
export class CrewLoader {
  constructor(private crewDir: string) {}

  async load(): Promise<CrewConfig> {
    const absDir = resolve(this.crewDir);

    // Verify directory exists
    try {
      await readdir(absDir);
    } catch {
      throw new Error(`Crew directory not found: ${absDir}`);
    }

    // 1. Parse CREW.md
    const crewMdPath = join(absDir, 'CREW.md');
    let crewMdContent: string;
    try {
      crewMdContent = await readFile(crewMdPath, 'utf-8');
    } catch {
      throw new Error(`CREW.md not found in: ${absDir}`);
    }

    const { meta, memory } = this.parseCrewMd(crewMdContent);

    // 2. Parse agents/*.md
    const agentDefs = await this.loadAgents(absDir);

    // 3. Scan skills/
    const skillDirs = await this.loadSkillDirs(absDir);

    return {
      meta: {
        name: meta.name,
        description: meta.description ?? '',
        primaryAgent: meta['primary-agent'],
      },
      memory,
      agentDefs,
      skillDirs,
    };
  }

  private parseCrewMd(content: string): { meta: CrewMeta; memory: string } {
    const trimmed = content.trim();

    if (!trimmed.startsWith('---')) {
      throw new Error('CREW.md must start with YAML frontmatter (---)');
    }

    const secondDash = trimmed.indexOf('---', 4);
    if (secondDash === -1) {
      throw new Error('CREW.md has unclosed YAML frontmatter');
    }

    const yamlStr = trimmed.slice(4, secondDash);
    const memory = trimmed.slice(secondDash + 3).trim();

    const meta = yaml.load(yamlStr, { schema: yaml.DEFAULT_SCHEMA }) as CrewMeta;

    if (!meta.name) throw new Error('CREW.md frontmatter missing "name"');
    if (!meta['primary-agent']) throw new Error('CREW.md frontmatter missing "primary-agent"');

    return { meta, memory };
  }

  private async loadAgents(absDir: string): Promise<Record<string, ParsedAgent>> {
    const agentsDir = join(absDir, 'agents');
    const agentDefs: Record<string, ParsedAgent> = {};

    try {
      const entries = await readdir(agentsDir);
      const mdFiles = entries.filter((f) => f.endsWith('.md'));

      for (const file of mdFiles) {
        const content = await readFile(join(agentsDir, file), 'utf-8');
        const parsed = parseAgentMd(content, file.replace(/\.md$/, ''));
        agentDefs[parsed.name] = parsed;
      }
    } catch {
      // agents/ directory doesn't exist — empty agentDefs is fine
    }

    return agentDefs;
  }

  private async loadSkillDirs(absDir: string): Promise<string[]> {
    const skillsDir = join(absDir, 'skills');
    const skillDirs: string[] = [];

    try {
      const entries = await readdir(skillsDir);
      for (const entry of entries) {
        skillDirs.push(join(skillsDir, entry));
      }
    } catch {
      // skills/ directory doesn't exist — empty array is fine
    }

    return skillDirs;
  }
}
