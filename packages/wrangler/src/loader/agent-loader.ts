import { parseAgentMd } from '../agent/agent-parser.js';
import type { ParsedAgent } from '../agent/agent-parser.js';
import type { HostEnv } from '../host-env/index.js';
import { NodeHostEnv } from '../host-env/node-host-env.js';
import type { SessionSource } from '../types.js';

export interface AgentLoadResult extends ParsedAgent {
  skillDirs: string[];
  mcpPaths: string[];
  source: SessionSource;
}

export class AgentLoader {
  static async loadFrom(dir: string, runtime?: HostEnv): Promise<AgentLoadResult> {
    const rt = runtime ?? new NodeHostEnv();
    const absDir = rt.path.resolve(dir);

    let content: string;
    try {
      content = await rt.fs.readFile(rt.path.join(absDir, 'AGENT.md'));
    } catch {
      throw new Error(`AGENT.md not found in: ${absDir}`);
    }

    const parsed = parseAgentMd(content);
    const skillDirs = await AgentLoader.scanSkillsDir(absDir, rt);

    const mcpPaths: string[] = [];
    const localMcp = rt.path.join(absDir, 'mcp.json');
    if (await rt.fs.exists(localMcp)) mcpPaths.push(localMcp);

    return { ...parsed, skillDirs, mcpPaths, source: { type: 'agent', configPath: absDir } };
  }

  private static async scanSkillsDir(absDir: string, runtime: HostEnv): Promise<string[]> {
    const skillsDir = runtime.path.join(absDir, 'skills');
    try {
      const entries = await runtime.fs.readdir(skillsDir);
      return entries.map((e) => runtime.path.join(skillsDir, e.name));
    } catch {
      return [];
    }
  }
}
