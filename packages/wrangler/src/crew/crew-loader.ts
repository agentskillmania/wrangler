import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import yaml from 'js-yaml';

import type { CrewConfig } from './types.js';
import { parseAgentMd } from '../agent/agent-parser.js';
import type { ParsedAgent } from '../agent/agent-parser.js';
import type { SubAgentConfig } from '../subagent/types.js';

interface CrewMeta {
  name: string;
  description?: string;
  'primary-agent': string;
  sandbox?: boolean;
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
        sandbox: meta.sandbox,
      },
      memory,
      agentDefs,
      skillDirs: skillDirs,
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

// ─── Crew → Runner config conversion ─────────────────────────

/**
 * Runner options derived from a CrewConfig.
 * Used to create an EnhancedRunner that supports crew delegation.
 */
export interface CrewRunnerOptions {
  /** System prompt for the primary agent (includes crew memory + agent catalog) */
  systemPrompt: string;
  /** Sub-agent configs for non-primary agents (enables delegate tool) */
  subAgents: SubAgentConfig[];
  /** Primary agent name */
  primaryAgent: string;
  /** Model override from primary agent definition */
  model?: string;
  /** Sandbox setting */
  sandbox?: boolean;
  /** Skill directories */
  skillDirs: string[];
}

/**
 * Convert a loaded CrewConfig into EnhancedRunner-compatible options.
 *
 * The primary agent becomes the main runner; all other agents become
 * sub-agents accessible via the delegate tool. CREW.md body (memory)
 * is injected into the system prompt as shared context.
 */
export function crewToRunnerOptions(crew: CrewConfig): CrewRunnerOptions {
  const primaryName = crew.meta.primaryAgent;
  const primaryDef = crew.agentDefs[primaryName];
  const workerEntries = Object.entries(crew.agentDefs).filter(([name]) => name !== primaryName);

  const subAgents: SubAgentConfig[] = workerEntries.map(([name, def]) => ({
    name,
    description: def.description ?? `${name} agent`,
    // Crew sub-agents inherit the parent runner's full tool set and skill
    // provider by default, so a researcher can read files / load skills /
    // run shell commands without the user redeclaring every tool per agent.
    // Either flag can be turned off in the SubAgentConfig if a crew wants
    // an isolated sub-agent.
    inheritParentTools: true,
    inheritParentSkills: true,
    config: {
      name,
      instructions: def.instructions,
      tools: [],
    },
  }));

  // Build system prompt: crew memory + primary instructions + agent catalog
  const catalogText =
    workerEntries.length > 0
      ? '\n\n## Available Sub-Agents\n' +
        workerEntries.map(([name, def]) => `- **${name}**: ${def.description ?? name}`).join('\n')
      : '';

  const primaryInstructions = primaryDef?.instructions ?? '';
  const systemPrompt = [crew.memory, primaryInstructions, catalogText].filter(Boolean).join('\n\n');

  return {
    systemPrompt,
    subAgents,
    primaryAgent: primaryName,
    model: primaryDef?.model,
    sandbox: crew.meta.sandbox,
    skillDirs: [...crew.skillDirs],
  };
}
