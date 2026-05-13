import type { ILLMProvider, AskHumanHandler } from '@agentskillmania/colts';

/** Agent .md YAML frontmatter */
export interface AgentMeta {
  name: string;
  description?: string;
  model?: string;
  thinking?: {
    enabled?: boolean;
  };
}

/** Parsed agent .md */
export interface AgentDefinition {
  meta: AgentMeta;
  instructions: string;
}

/** Options for ConfigurableAgent */
export interface ConfigurableAgentOptions {
  llmClient: ILLMProvider;
  defaultModel?: string;
  askHumanHandler?: AskHumanHandler;
  sessionBaseDir?: string;
  skillDirectories?: string[];
}
