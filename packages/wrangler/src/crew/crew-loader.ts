import yaml from 'js-yaml';

import type { CrewConfig } from './types.js';
import { parseAgentMd } from '../agent/agent-parser.js';
import type { ParsedAgent } from '../agent/agent-parser.js';
import type { HostEnv } from '../host-env/index.js';
import type { SubAgentConfig } from '../subagent/types.js';

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
 * - skills/ (skill container directory — the dir itself is the skillDirs
 *   entry, mirroring config.yaml's global skillDirs convention)
 * - mcp.json (single-file MCP declaration, same convention as an agent dir)
 *
 * 目录即全世界：crew 私有声明存在即全部，不存在则为空——不回落全局。
 */
export class CrewLoader {
  constructor(
    private crewDir: string,
    private runtime: HostEnv
  ) {}

  async load(): Promise<CrewConfig> {
    const rt = this.runtime;
    const absDir = rt.path.resolve(this.crewDir);

    // Verify directory exists
    try {
      await rt.fs.readdir(absDir);
    } catch {
      throw new Error(`Crew directory not found: ${absDir}`);
    }

    // 1. Parse CREW.md
    const crewMdPath = rt.path.join(absDir, 'CREW.md');
    let crewMdContent: string;
    try {
      crewMdContent = await rt.fs.readFile(crewMdPath);
    } catch {
      throw new Error(`CREW.md not found in: ${absDir}`);
    }

    const { meta, memory } = this.parseCrewMd(crewMdContent);

    // 2. Parse agents/*.md
    const agentDefs = await this.loadAgents(absDir, rt);

    // 3. Scan skills/ (container) and mcp.json
    const skillDirs = await this.loadSkillDirs(absDir, rt);
    const mcpPaths = await this.loadMcpPaths(absDir, rt);

    return {
      meta: {
        name: meta.name,
        description: meta.description ?? '',
        primaryAgent: meta['primary-agent'],
      },
      memory,
      agentDefs,
      skillDirs: skillDirs,
      mcpPaths,
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

  private async loadAgents(absDir: string, rt: HostEnv): Promise<Record<string, ParsedAgent>> {
    const agentsDir = rt.path.join(absDir, 'agents');
    const agentDefs: Record<string, ParsedAgent> = {};

    try {
      const entries = await rt.fs.readdir(agentsDir);
      const mdFiles = entries.filter((f) => f.name.endsWith('.md'));

      for (const file of mdFiles) {
        const content = await rt.fs.readFile(rt.path.join(agentsDir, file.name));
        const parsed = parseAgentMd(content, file.name.replace(/\.md$/, ''));
        agentDefs[parsed.name] = parsed;
      }
    } catch {
      // agents/ directory doesn't exist — empty agentDefs is fine
    }

    return agentDefs;
  }

  /**
   * crew 私有技能容器：`<crew>/skills` 本身。
   *
   * skillDirs 的语义是"容器目录"（里面装着若干 skill 子目录，每个含
   * SKILL.md）——与 config.yaml 的全局 skillDirs（~/.agents/skills 等）
   * 同一约定。此前误推 skills/ 下的条目（skill 目录本身），provider 按
   * 容器扫描永远发现不了（对齐 Rust eef05a1）。
   *
   * 目录不存在 → 空数组（不回落全局；"目录即全世界"）。
   */
  private async loadSkillDirs(absDir: string, rt: HostEnv): Promise<string[]> {
    const skillsDir = rt.path.join(absDir, 'skills');
    try {
      const st = await rt.fs.stat(skillsDir);
      if (!st.isDirectory) return [];
    } catch {
      return [];
    }
    return [skillsDir];
  }

  /**
   * crew 私有 MCP 声明：`<crew>/mcp.json`（单文件，与 agent 目录同一约定，
   * 内容 `{ "mcpServers": {...} }`）。存在则返回其路径，缺失返回空。
   */
  private async loadMcpPaths(absDir: string, rt: HostEnv): Promise<string[]> {
    const mcp = rt.path.join(absDir, 'mcp.json');
    try {
      const st = await rt.fs.stat(mcp);
      if (!st.isFile) return [];
    } catch {
      return [];
    }
    return [mcp];
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
  /**
   * Skill container directories (crew-private `<crew>/skills` when present,
   * else empty). Held as container dirs — the provider scans the container,
   * not its entries (对齐 Rust eef05a1).
   */
  skillDirs: string[];
  /**
   * Crew-private MCP config paths (`<crew>/mcp.json` when present, else
   * empty). 目录即全世界：不回落 config.yaml 全局 mcpConfigPaths。
   */
  mcpPaths: string[];
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
    skillDirs: [...crew.skillDirs],
    mcpPaths: [...crew.mcpPaths],
  };
}
