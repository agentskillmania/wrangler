/**
 * @fileoverview Sub-agent type definitions
 *
 * Sub-agent types live in wrangler (not colts) because sub-agent creation
 * requires wrangler concerns: buildTimeContext, MarkdownMessageAssembler,
 * todolist — things a bare colts AgentRunner cannot provide.
 */
import type { AgentConfig } from '@agentskillmania/colts';

/**
 * Sub-agent configuration
 *
 * Describes a specialized agent that a parent agent can delegate tasks to
 * via the `delegate` tool. The parent agent sees the sub-agent's name and
 * description in its system prompt and decides when delegation is warranted.
 */
export interface SubAgentConfig {
  /** Sub-agent name (used as the delegate tool's `agent` argument) */
  name: string;
  /** Description (used by parent agent to decide when to delegate) */
  description: string;
  /** AgentConfig (independent instructions) */
  config: AgentConfig;
  /** Max steps limit for sub-agent (default: 500) */
  maxSteps?: number;
  /** Timeout in milliseconds — sub-agent is aborted if it exceeds this (default: no timeout) */
  timeout?: number;
  /**
   * Inherit the parent runner's full tool set (file_read, shell, web_search, ...).
   * The recursive `delegate` tool is always filtered out. Default: true.
   * Set to false to keep the sub-agent limited to a minimal built-in set.
   */
  inheritParentTools?: boolean;
  /**
   * Inherit the parent runner's skill provider, which wires up the
   * `load_skill` tool on the sub-agent. Default: true.
   */
  inheritParentSkills?: boolean;
}

/**
 * Delegate tool result — discriminated union by status.
 * The parent agent receives this as the tool's return value and can
 * branch on status to decide retry/fallback/report.
 */
export type DelegateResult =
  | { status: 'success'; answer: string; totalSteps: number }
  | { status: 'max_steps'; lastAnswer: string; totalSteps: number }
  | { status: 'error'; error: string; totalSteps: number }
  | { status: 'abort'; totalSteps: number }
  | { status: 'timeout'; partialResult: string; totalSteps: number };

/** Default max steps for a sub-agent when not specified in SubAgentConfig */
export const DEFAULT_SUBAGENT_MAX_STEPS = 500;
