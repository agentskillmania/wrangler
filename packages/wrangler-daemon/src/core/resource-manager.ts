import { readdir, mkdir, rm, stat as statFn, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { AgentLoader } from '@agentskillmania/wrangler';
import { parseAgentMd } from '@agentskillmania/wrangler';
import type {
  AgentInfo,
  AgentDetail,
  SkillInfo,
  SkillDetail,
  SkillFile,
  CreateAgentOptions,
  CreateSkillOptions,
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

  constructor(agentsDir: string, skillsDir: string) {
    this.agentsDir = resolve(agentsDir);
    this.skillsDir = resolve(skillsDir);
  }

  /** Ensure resource directories exist */
  async init(): Promise<void> {
    await mkdir(this.agentsDir, { recursive: true });
    await mkdir(this.skillsDir, { recursive: true });
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
              path: `${id}/${entry.name}`,
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
