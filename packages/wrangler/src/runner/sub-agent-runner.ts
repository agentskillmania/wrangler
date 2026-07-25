/**
 * @fileoverview SubAgentRunner factory
 *
 * Builds a trimmed AgentRunner for sub-agents. Sub-agents get the wrangler
 * goodness (buildTimeContext, MarkdownMessageAssembler, todolist, inherited
 * tools/skills) but NOT the things that would be dangerous or redundant in a
 * delegation context:
 *
 *   ❌ session middleware   (no persistence — sub-agent conversations are ephemeral)
 *   ❌ delegate tool        (prevents recursion)
 *   ❌ commands             (/compact, /clear — not user-facing)
 *   ❌ spec-plan            (planning is the parent's job)
 *   ❌ a2ui                 (no UI generation for sub-agents)
 *   ❌ ask_human            (sub-agents cannot do human-in-the-loop)
 *   ❌ crewId               (sub-agents are not crew members)
 *
 * Capability matrix vs EnhancedRunner:
 *   buildTimeContext          ✅
 *   MarkdownMessageAssembler  ✅
 *   tool inheritance          ✅ (from parent runner, minus delegate/load_skill)
 *   skill inheritance         ✅ (from parent runner's skill provider)
 *   todolist                  ✅ (default on)
 *   thinkingEnabled           ✅
 */

import { AgentRunner } from '@agentskillmania/colts';
import type { ILLMProvider, ISkillProvider, Tool } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';

import { MarkdownMessageAssembler } from './markdown-assembler.js';
import { buildTimeContext } from './system-prompt.js';
import { createTodolistSupport } from '../todolist/support.js';

/** Options for creating a sub-agent runner */
export interface SubAgentRunnerOptions {
  /** Model identifier (forwarded from parent runner) */
  model: string;
  /** LLM provider (shared with parent runner) */
  llmClient: ILLMProvider;
  /**
   * Tools inherited from the parent runner. The caller must already filter
   * out `delegate` (recursion) and `load_skill` (auto-registered by
   * AgentRunner when skillProvider is present).
   */
  inheritedTools?: Tool<ZodTypeAny>[];
  /** Skill provider inherited from the parent runner */
  skillProvider?: ISkillProvider;
  /** Max steps (default: 500) */
  maxSteps?: number;
  /** Enable native thinking mode */
  thinkingEnabled?: boolean;
  /** Sampling temperature */
  temperature?: number;
}

/**
 * Create a trimmed AgentRunner for a sub-agent.
 *
 * @param options - Sub-agent runner options
 * @returns AgentRunner configured for delegation (no session, no delegate, no HITL)
 */
export function createSubAgentRunner(options: SubAgentRunnerOptions): AgentRunner {
  const todolistSupport = createTodolistSupport();

  // Names of tools this runner wires up itself — filtered out of the
  // inherited set to avoid "Tool X is already registered" collisions.
  const selfRegisteredNames = new Set([
    ...todolistSupport.tools.map((t) => t.name),
    // AgentRunner auto-registers load_skill when skillProvider is present
    ...(options.skillProvider ? ['load_skill'] : []),
  ]);

  const tools: Tool<ZodTypeAny>[] = [
    ...(options.inheritedTools ?? []).filter((t) => !selfRegisteredNames.has(t.name)),
    ...todolistSupport.tools,
  ];

  return new AgentRunner({
    model: options.model,
    llmClient: options.llmClient,
    tools,
    skillProvider: options.skillProvider,
    middleware: [todolistSupport.middleware],
    systemPrompt: buildTimeContext(),
    messageAssembler: new MarkdownMessageAssembler(),
    thinkingEnabled: options.thinkingEnabled,
    temperature: options.temperature,
    maxSteps: options.maxSteps,
  });
}
