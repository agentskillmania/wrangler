// packages/core/src/crew/crew-loader.ts

import { readFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import yaml from 'js-yaml';
import { parseAgentMd } from '../agent/agent-loader.js';
import type { AgentDefinition } from '../agent/types.js';
import type { CrewConfig, CrewMeta } from './types.js';

export class CrewLoader {
  constructor(private crewDir: string) {}

  async load(): Promise<CrewConfig> {
    const crewMdPath = join(this.crewDir, 'CREW.md');
    let crewContent: string;
    try {
      crewContent = await readFile(crewMdPath, 'utf-8');
    } catch {
      throw new Error(`CREW.md not found in ${this.crewDir}`);
    }

    const parsed = this.parseCrewMd(crewContent);

    const agentDefs = await this.loadAgents();

    if (Object.keys(agentDefs).length === 0) {
      throw new Error(`No agent definitions found in ${join(this.crewDir, 'agents/')}`);
    }

    if (!agentDefs[parsed.meta.primaryAgent]) {
      throw new Error(`primary-agent "${parsed.meta.primaryAgent}" not found in agents/ directory`);
    }

    const skillDirs = await this.loadSkillDirs();

    return {
      meta: parsed.meta,
      memory: parsed.memory,
      agentDefs,
      skillDirs,
    };
  }

  async getAgent(name: string): Promise<AgentDefinition | null> {
    const agentsDir = join(this.crewDir, 'agents');
    try {
      const files = await readdir(agentsDir);
      for (const file of files) {
        if (extname(file) !== '.md') continue;
        const content = await readFile(join(agentsDir, file), 'utf-8');
        const agentDef = parseAgentMd(content, file.replace(/\.md$/, ''));
        if (agentDef.meta.name === name) {
          return agentDef;
        }
      }
    } catch {
      // agents/ doesn't exist yet
    }
    return null;
  }

  private parseCrewMd(content: string): { meta: CrewMeta; memory: string } {
    const trimmed = content.trim();

    if (!trimmed.startsWith('---')) {
      throw new Error('CREW.md must start with YAML frontmatter');
    }

    const secondDash = trimmed.indexOf('---', 4);
    if (secondDash === -1) {
      throw new Error('CREW.md has unclosed YAML frontmatter');
    }

    const yamlStr = trimmed.slice(4, secondDash);
    const memory = trimmed.slice(secondDash + 3).trim();

    const raw = yaml.load(yamlStr, { schema: yaml.DEFAULT_SCHEMA }) as Record<string, unknown>;

    if (!raw['primary-agent'] && !raw.primaryAgent) {
      throw new Error('CREW.md must specify primary-agent in frontmatter');
    }

    return {
      meta: {
        name: (raw.name as string) ?? 'unnamed-crew',
        description: (raw.description as string) ?? '',
        primaryAgent: (raw['primary-agent'] as string) ?? (raw.primaryAgent as string),
      },
      memory,
    };
  }

  private async loadAgents(): Promise<Record<string, AgentDefinition>> {
    const agentsDir = join(this.crewDir, 'agents');
    const agentDefs: Record<string, AgentDefinition> = {};

    try {
      const files = await readdir(agentsDir);
      for (const file of files) {
        if (extname(file) !== '.md') continue;
        const content = await readFile(join(agentsDir, file), 'utf-8');
        const agentDef = parseAgentMd(content, file.replace(/\.md$/, ''));
        agentDefs[agentDef.meta.name] = agentDef;
      }
    } catch {
      // agents/ doesn't exist
    }

    return agentDefs;
  }

  private async loadSkillDirs(): Promise<string[]> {
    const skillsDir = join(this.crewDir, 'skills');
    const dirs: string[] = [];

    try {
      const entries = await readdir(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          dirs.push(join(skillsDir, entry.name));
        }
      }
    } catch {
      // skills/ doesn't exist — OK, optional
    }

    return dirs;
  }
}
