import { readdir, mkdir, rm, stat as statFn, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { AgentLoader } from '@agentskillmania/wrangler';
import { parseAgentMd } from '@agentskillmania/wrangler';
import yaml from 'js-yaml';

import type {
  AgentInfo,
  AgentDetail,
  SkillInfo,
  SkillDetail,
  SkillFile,
  CreateAgentOptions,
  CreateSkillOptions,
  CrewInfo,
  CrewDetail,
  CreateCrewOptions,
} from '../types.js';

/**
 * Discovers, loads, and manages agent and skill resources on disk.
 *
 * Agents live in `{agentsDir}/{name}/AGENT.md`.
 * Skills live in `{skillsDir}/{name}/SKILL.md`.
 */
export class ResourceManager {
  private readonly agentsDir: string;
  private readonly skillsDir: string;
  private readonly crewsDir: string;

  constructor(agentsDir: string, skillsDir: string, crewsDir: string) {
    this.agentsDir = resolve(agentsDir);
    this.skillsDir = resolve(skillsDir);
    this.crewsDir = resolve(crewsDir);
  }

  /** Validate resource name: no path traversal, no empty */
  validateName(name: string): void {
    if (!name || !name.trim()) {
      throw new Error('name is required');
    }
    if (name.includes('/') || name.includes('\\') || name.includes('..')) {
      throw new Error('name must not contain path separators or traversal sequences');
    }
  }

  /** Ensure resource directories exist */
  async init(): Promise<void> {
    await mkdir(this.agentsDir, { recursive: true });
    await mkdir(this.skillsDir, { recursive: true });
    await mkdir(this.crewsDir, { recursive: true });
  }

  /** List all valid agents (directories with AGENT.md) */
  async listAgents(): Promise<AgentInfo[]> {
    const agents: AgentInfo[] = [];
    try {
      const entries = await readdir(this.agentsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const agentDir = join(this.agentsDir, entry.name);
        try {
          const content = await readFile(join(agentDir, 'AGENT.md'), 'utf-8');
          const parsed = parseAgentMd(content, entry.name);
          agents.push({
            id: entry.name,
            name: parsed.name,
            description: parsed.description ?? '',
            path: agentDir,
            toolCount: 0,
            skillCount: 0,
          });
        } catch {
          /* skip directories without AGENT.md */
        }
      }
    } catch {
      /* agents directory doesn't exist */
    }
    return agents;
  }

  /** Get detailed agent info by parsing AGENT.md via wrangler AgentLoader */
  async getAgent(id: string): Promise<AgentDetail | null> {
    const agentDir = join(this.agentsDir, id);
    try {
      const result = await AgentLoader.loadFrom(agentDir);
      return {
        id,
        name: result.name,
        description: result.description,
        instructions: result.instructions,
        model: result.model,
        thinking: result.thinking,
        sandbox: result.sandbox,
        path: agentDir,
        skillDirs: result.skillDirs,
        mcpPaths: result.mcpPaths,
        skillCount: result.skillDirs.length,
      };
    } catch {
      return null;
    }
  }

  /** List all valid skills (directories with SKILL.md) */
  async listSkills(): Promise<SkillInfo[]> {
    const skills: SkillInfo[] = [];
    try {
      const entries = await readdir(this.skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillDir = join(this.skillsDir, entry.name);
        try {
          const content = await readFile(join(skillDir, 'SKILL.md'), 'utf-8');
          const parsed = parseSkillMd(content, entry.name);
          skills.push({
            id: entry.name,
            name: parsed.name,
            description: parsed.description ?? '',
            path: skillDir,
          });
        } catch {
          /* skip directories without SKILL.md */
        }
      }
    } catch {
      /* skills directory doesn't exist */
    }
    return skills;
  }

  /** Get detailed skill info with parsed SKILL.md and file listing */
  async getSkill(id: string): Promise<SkillDetail | null> {
    const skillDir = join(this.skillsDir, id);
    try {
      const dirStat = await statFn(skillDir);
      if (!dirStat.isDirectory()) return null;

      const content = await readFile(join(skillDir, 'SKILL.md'), 'utf-8');
      const parsed = parseSkillMd(content, id);

      const entries = await readdir(skillDir, { withFileTypes: true });
      const files: SkillFile[] = [];
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        try {
          const fileStat = await statFn(join(skillDir, entry.name));
          if (fileStat.isFile()) {
            files.push({
              name: entry.name,
              path: entry.name,
              size: fileStat.size,
            });
          }
        } catch {
          /* skip unreadable entries */
        }
      }

      return {
        id,
        name: parsed.name,
        description: parsed.description,
        path: skillDir,
        files,
      };
    } catch {
      return null;
    }
  }

  /** Create a new agent with AGENT.md */
  async createAgent(options: CreateAgentOptions): Promise<string> {
    this.validateName(options.name);
    const agentDir = join(this.agentsDir, options.name);
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, 'AGENT.md'),
      `---\nname: ${options.name}\n---\n\n${options.instructions}\n`,
      'utf-8'
    );
    return options.name;
  }

  /** Delete an agent by id */
  async deleteAgent(id: string): Promise<void> {
    const agentDir = join(this.agentsDir, id);
    await rm(agentDir, { recursive: true, force: true });
  }

  /** Create a new skill with SKILL.md */
  async createSkill(options: CreateSkillOptions): Promise<string> {
    this.validateName(options.name);
    const skillDir = join(this.skillsDir, options.name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---\nname: ${options.name}\ndescription: ${options.description}\n---\n\n# ${options.name}\n`,
      'utf-8'
    );
    return options.name;
  }

  /** Delete a skill by id */
  async deleteSkill(id: string): Promise<void> {
    const skillDir = join(this.skillsDir, id);
    await rm(skillDir, { recursive: true, force: true });
  }

  /** List all valid crews (directories with CREW.md) */
  async listCrews(): Promise<CrewInfo[]> {
    const crews: CrewInfo[] = [];
    try {
      const entries = await readdir(this.crewsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const crewDir = join(this.crewsDir, entry.name);
        try {
          const content = await readFile(join(crewDir, 'CREW.md'), 'utf-8');
          const parsed = parseCrewMd(content, entry.name);
          const agents = await this.listSubDirs(join(crewDir, 'agents'));
          const skills = await this.listSubDirs(join(crewDir, 'skills'));
          crews.push({
            id: entry.name,
            name: parsed.name,
            description: parsed.description ?? '',
            path: crewDir,
            agentCount: agents.length,
            skillCount: skills.length,
          });
        } catch {
          /* skip directories without CREW.md */
        }
      }
    } catch {
      /* crews directory doesn't exist */
    }
    return crews;
  }

  /** Get detailed crew info with CREW.md content, agents, and skills */
  async getCrew(id: string): Promise<CrewDetail | null> {
    const crewDir = join(this.crewsDir, id);
    try {
      const dirStat = await statFn(crewDir);
      if (!dirStat.isDirectory()) return null;

      const content = await readFile(join(crewDir, 'CREW.md'), 'utf-8');
      const parsed = parseCrewMd(content, id);

      const agents: { name: string; fileName: string }[] = [];
      try {
        const agentEntries = await readdir(join(crewDir, 'agents'), { withFileTypes: true });
        for (const entry of agentEntries) {
          if (entry.isFile() && entry.name.endsWith('.md')) {
            agents.push({ name: entry.name.replace('.md', ''), fileName: entry.name });
          }
        }
      } catch {
        /* no agents directory */
      }

      const skills: { name: string; dirName: string }[] = [];
      try {
        const skillEntries = await readdir(join(crewDir, 'skills'), { withFileTypes: true });
        for (const entry of skillEntries) {
          if (entry.isDirectory()) {
            try {
              await statFn(join(crewDir, 'skills', entry.name, 'SKILL.md'));
              skills.push({ name: entry.name, dirName: entry.name });
            } catch {
              /* not a valid skill directory */
            }
          }
        }
      } catch {
        /* no skills directory */
      }

      return {
        id,
        name: parsed.name,
        description: parsed.description,
        primaryAgent: parsed.primaryAgent,
        path: crewDir,
        crewMd: content,
        agents,
        skills,
      };
    } catch {
      return null;
    }
  }

  /** Create a new crew with CREW.md */
  async createCrew(options: CreateCrewOptions): Promise<string> {
    this.validateName(options.name);
    const crewDir = join(this.crewsDir, options.name);
    await mkdir(crewDir, { recursive: true });
    await mkdir(join(crewDir, 'agents'), { recursive: true });
    await mkdir(join(crewDir, 'skills'), { recursive: true });
    const primaryLine = options.primaryAgent ? `\nprimary-agent: ${options.primaryAgent}` : '';
    const descLine = options.description ? `\ndescription: ${options.description}` : '';
    await writeFile(
      join(crewDir, 'CREW.md'),
      `---\nname: ${options.name}${descLine}${primaryLine}\n---\n\n# ${options.name}\n\n${options.instructions ?? ''}\n`,
      'utf-8'
    );
    return options.name;
  }

  /** Delete a crew by id */
  async deleteCrew(id: string): Promise<void> {
    const crewDir = join(this.crewsDir, id);
    await rm(crewDir, { recursive: true, force: true });
  }

  /** Helper: list subdirectories */
  private async listSubDirs(dirPath: string): Promise<string[]> {
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  }
}

/** Parse SKILL.md frontmatter for name and description */
function parseSkillMd(
  content: string,
  fallbackName: string
): { name: string; description?: string } {
  const trimmed = content.trim();
  if (!trimmed.startsWith('---')) {
    return { name: fallbackName };
  }
  const secondDash = trimmed.indexOf('---', 4);
  if (secondDash === -1) return { name: fallbackName };

  try {
    const yamlStr = trimmed.slice(4, secondDash);
    const raw = yaml.load(yamlStr, { schema: yaml.DEFAULT_SCHEMA }) as Record<string, unknown>;
    return {
      name: (raw.name as string) ?? fallbackName,
      description: raw.description as string | undefined,
    };
  } catch {
    return { name: fallbackName };
  }
}

/** Parse CREW.md frontmatter for name, description, and primary-agent */
function parseCrewMd(
  content: string,
  fallbackName: string
): { name: string; description?: string; primaryAgent?: string } {
  const trimmed = content.trim();
  if (!trimmed.startsWith('---')) {
    return { name: fallbackName };
  }
  const secondDash = trimmed.indexOf('---', 4);
  if (secondDash === -1) return { name: fallbackName };

  try {
    const yamlStr = trimmed.slice(4, secondDash);
    const raw = yaml.load(yamlStr, { schema: yaml.DEFAULT_SCHEMA }) as Record<string, unknown>;
    return {
      name: (raw.name as string) ?? fallbackName,
      description: raw.description as string | undefined,
      primaryAgent: raw['primary-agent'] as string | undefined,
    };
  } catch {
    return { name: fallbackName };
  }
}
