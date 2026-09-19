import { parseAgentMd } from '../agent/agent-parser.js';
import type { ParsedAgent } from '../agent/agent-parser.js';
import type { HostEnv } from '../host-env/index.js';
import type { SessionSource } from '../types.js';

export interface AgentLoadResult extends ParsedAgent {
  skillDirs: string[];
  mcpPaths: string[];
  source: SessionSource;
}

export class AgentLoader {
  static async loadFrom(dir: string, runtime: HostEnv): Promise<AgentLoadResult> {
    const rt = runtime;
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

  /**
   * agent 目录私有技能容器：`<agentDir>/skills` 本身。
   *
   * skillDirs 语义是"容器目录"（与 config.yaml 全局 skillDirs 同一约定），
   * provider 按容器扫描；此前误推其下条目，永远发现不了（对齐 Rust
   * eef05a1 的 resources.rs 修复）。目录缺失 → 空数组。
   */
  private static async scanSkillsDir(absDir: string, runtime: HostEnv): Promise<string[]> {
    const skillsDir = runtime.path.join(absDir, 'skills');
    try {
      const st = await runtime.fs.stat(skillsDir);
      if (!st.isDirectory) return [];
    } catch {
      return [];
    }
    return [skillsDir];
  }
}
