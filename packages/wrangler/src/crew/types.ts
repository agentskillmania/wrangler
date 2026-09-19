import type { ParsedAgent } from '../agent/agent-parser.js';

// ─── Static config ───

export interface CrewConfig {
  readonly meta: {
    readonly name: string;
    readonly description: string;
    readonly primaryAgent: string;
  };
  readonly memory: string;
  readonly agentDefs: Readonly<Record<string, ParsedAgent>>;
  /**
   * crew 私有技能容器目录（`<crew>/skills` 本身；缺失为空）。
   * 语义是"容器"而非其下条目——provider 按容器扫描（对齐 Rust eef05a1）。
   */
  readonly skillDirs: readonly string[];
  /** crew 私有 MCP 配置路径（`<crew>/mcp.json`；缺失为空）。 */
  readonly mcpPaths: readonly string[];
}
