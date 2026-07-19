import type { ParsedAgent } from '../agent/agent-parser.js';

// ─── Static config ───

export interface CrewConfig {
  readonly meta: {
    readonly name: string;
    readonly description: string;
    readonly primaryAgent: string;
    readonly sandbox?: boolean;
  };
  readonly memory: string;
  readonly agentDefs: Readonly<Record<string, ParsedAgent>>;
  readonly skillDirs: readonly string[];
}
