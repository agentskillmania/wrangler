// packages/core/src/types.ts

import type {
  CompressionConfig,
  AskHumanHandler,
  SubAgentConfig,
  ISkillProvider,
} from '@agentskillmania/colts';

/**
 * LLM 配置 — 两种互斥模式
 *
 * - llmClient: 注入已有的 ILLMProvider
 * - apiKey: quick-init 模式，colts 内部创建 LLMClient
 */
export interface WranglerLLMConfig {
  /** 注入已有的 ILLMProvider */
  llmClient?: import('@agentskillmania/colts').ILLMProvider;
  /** API Key（quick-init 模式） */
  apiKey?: string;
  /** 提供商名称（默认 'openai'） */
  provider?: string;
  /** 自定义 base URL */
  baseUrl?: string;
  /** 并发上限（默认 5） */
  maxConcurrency?: number;
}

/**
 * Agent 配置（传入 colts createAgentState）
 */
export interface AgentConfig {
  /** Agent 名称 */
  name: string;
  /** Agent 指令 */
  instructions: string;
  /** Agent 工具定义 */
  tools: import('@agentskillmania/colts').ToolDefinition[];
}

/**
 * 创建 Runner 的选项
 */
export interface WranglerOptions {
  /** workspace 目录路径 */
  workspacePath: string;
  /** 模型标识（如 'GLM-4.7'） */
  model: string;
  /** LLM 配置 */
  llm: WranglerLLMConfig;
  /** Agent 配置（name, instructions, tools） */
  agentConfig: AgentConfig;
  /** 系统提示词（与 instructions 合并） */
  systemPrompt?: string;
  /** ask_human 处理器（不传则不注册 ask_human 工具） */
  askHumanHandler?: AskHumanHandler;
  /** sub-agent 配置（不传则不注册 delegate 工具） */
  subAgents?: SubAgentConfig[];
  /** skill 目录列表（不传则不注册 load_skill/return_skill） */
  skillDirectories?: string[];
  /** 直接注入 skill provider（优先于 skillDirectories） */
  skillProvider?: ISkillProvider;
  /** 最大 ReAct 步数（默认 10） */
  maxSteps?: number;
  /** 请求超时（毫秒） */
  requestTimeout?: number;
  /** 上下文压缩配置 */
  compression?: CompressionConfig;
  /** session 存储根目录（默认 ~/.agentskillmania/wrangler/sessions） */
  sessionBaseDir?: string;
  /** 启用 thinking 模式 */
  thinkingEnabled?: boolean;
}

/**
 * Session 元数据 — 存储在 meta.yaml
 */
export interface SessionMeta {
  /** Session ID（= state.id） */
  id: string;
  /** 所属 workspace 路径 */
  workspacePath: string;
  /** 创建时间（ISO string） */
  createdAt: string;
  /** 更新时间（ISO string） */
  updatedAt: string;
  /** 使用的模型 */
  model: string;
  /** 消息计数 */
  messageCount: number;
}

/**
 * Transcript 条目类型
 */
export type TranscriptEntry =
  | { type: 'user'; content: string; timestamp: number }
  | { type: 'assistant'; content: string; timestamp: number }
  | { type: 'tool'; toolName: string; arguments: string; result: string; timestamp: number }
  | { type: 'error'; message: string; timestamp: number };
