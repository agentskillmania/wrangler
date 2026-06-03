import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { parseAgentMd } from '../agent/agent-parser.js';
import type { ParsedAgent } from '../agent/agent-parser.js';

export interface AgentLoadResult extends ParsedAgent {
  skillDirs: string[];
  mcpPaths: string[];
}

export class AgentLoader {
  static async loadFrom(dir: string): Promise<AgentLoadResult> {
    const absDir = resolve(dir);

    let content: string;
    try {
      content = await readFile(join(absDir, 'AGENT.md'), 'utf-8');
    } catch {
      throw new Error(`AGENT.md not found in: ${absDir}`);
    }

    const parsed = parseAgentMd(content);
    const skillDirs = await AgentLoader.scanSkillsDir(absDir);

    const mcpPaths: string[] = [];
    const localMcp = join(absDir, 'mcp.json');
    if (existsSync(localMcp)) mcpPaths.push(localMcp);

    return { ...parsed, skillDirs, mcpPaths };
  }

  private static async scanSkillsDir(absDir: string): Promise<string[]> {
    const skillsDir = join(absDir, 'skills');
    try {
      const entries = await readdir(skillsDir);
      return entries.map((e) => join(skillsDir, e));
    } catch {
      return [];
    }
  }
}
