/**
 * @fileoverview Delegate Tool factory (wrangler layer)
 *
 * Creates the 'delegate' tool that allows the parent agent to delegate tasks
 * to specialized sub-agents. Each delegation spins up a fresh SubAgentRunner
 * (a trimmed EnhancedRunner) via {@link createSubAgentRunner}.
 *
 * Migrated from colts — the key difference is that sub-agent creation now uses
 * wrangler's SubAgentRunner (with buildTimeContext, MarkdownMessageAssembler,
 * todolist) instead of colts' bare AgentRunner.
 */

import { z } from 'zod';

import { AgentRunner, createAgentState, addUserMessage } from '@agentskillmania/colts';
import type { ILLMProvider, IToolRegistry, ISkillProvider, Tool } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';

import { createSubAgentRunner, type SubAgentRunnerOptions } from '../runner/sub-agent-runner.js';
import type {
  SubAgentConfig,
  DelegateResult,
} from './types.js';
import { DEFAULT_SUBAGENT_MAX_STEPS } from './types.js';

/**
 * Factory signature for creating a sub-agent runner.
 *
 * Replaces colts' `ISubAgentFactory`. The default implementation
 * ({@link createSubAgentRunner}) wires up buildTimeContext, MarkdownMessageAssembler,
 * todolist, and tool/skill inheritance. Inject a custom factory to override
 * any of that (pool runners, add middleware, swap assembler, etc.).
 *
 * Receives the already-resolved inherited tools (filtered for delegate/load_skill)
 * so the factory doesn't have to re-implement tool inheritance logic.
 */
export type SubAgentRunnerFactory = (options: SubAgentRunnerOptions) => AgentRunner;

/**
 * Dependency injection interface for the delegate tool
 */
export interface DelegateToolDeps {
  /** Sub-agent configuration map (name → SubAgentConfig) */
  subAgentConfigs: Map<string, SubAgentConfig>;
  /** LLM provider instance (shared with parent runner) */
  llmProvider: ILLMProvider;
  /** Parent agent's model identifier, passed through to sub-agent */
  model?: string;
  /** Parent agent's tool registry for inheriting tool implementations */
  parentToolRegistry: IToolRegistry;
  /**
   * Parent runner's skill provider. Forwarded to the sub-agent so it gets
   * the `load_skill` tool when `inheritParentSkills` is true (default).
   */
  parentSkillProvider?: ISkillProvider;
  /** Parent runner's thinking-enabled setting (forwarded to sub-agent) */
  thinkingEnabled?: boolean;
  /** Parent runner's temperature setting (forwarded to sub-agent) */
  temperature?: number;
  /**
   * Custom sub-agent runner factory. Defaults to {@link createSubAgentRunner}.
   * Override to customize how sub-agent runners are built.
   */
  subAgentRunnerFactory?: SubAgentRunnerFactory;
  /**
   * Event emitter callback — forwards sub-agent events to the parent runner's EventEmitter.
   * Called with (type, data) for each event the sub-agent produces.
   */
  emit: (type: string, data: Record<string, unknown>) => void;
}

/**
 * Create the delegate tool.
 *
 * The parent agent uses this tool to delegate specific tasks to specialized sub-agents.
 * Each delegation creates a fresh SubAgentRunner with inherited tools/skills and
 * runs it to completion. Sub-agent events are re-emitted to the parent with a
 * `subagent:` prefix and a unique subtaskId for routing.
 *
 * @param deps - Dependency injection parameters
 * @returns Tool instance, registerable with ToolRegistry
 */
export function createDelegateTool(deps: DelegateToolDeps): Tool<ZodTypeAny> {
  const {
    subAgentConfigs,
    llmProvider,
    model,
    parentToolRegistry,
    parentSkillProvider,
    thinkingEnabled,
    temperature,
    subAgentRunnerFactory = createSubAgentRunner,
  } = deps;

  return {
    name: 'delegate',
    description:
      'Delegate a task to a specialized sub-agent. Use when a task requires specific expertise or tools that a sub-agent possesses.',
    parameters: z.object({
      agent: z.string().describe('Name of the sub-agent to use'),
      task: z.string().describe('Clear description of the task to delegate'),
      extraInstructions: z
        .string()
        .optional()
        .describe("Additional instructions appended to the sub-agent's base personality."),
    }),
    execute: async ({ agent, task, extraInstructions }, options) => {
      const config = subAgentConfigs.get(agent);
      if (!config) {
        const available = Array.from(subAgentConfigs.keys()).join(', ');
        return {
          status: 'error',
          error: `Unknown sub-agent '${agent}'. Available: ${available}`,
          totalSteps: 0,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          duration: 0,
        } satisfies DelegateResult;
      }

      // Build sub-agent instructions, optionally appending extra instructions
      let instructions = config.config.instructions;
      if (extraInstructions) {
        instructions = instructions + '\n\n' + extraInstructions;
      }

      // Create sub-agent state
      const subConfig = { ...config.config, instructions };
      const subState = createAgentState(subConfig);
      const stateWithTask = addUserMessage(subState, task);

      // Resolve tools for the sub-agent runner.
      const inheritTools = config.inheritParentTools !== false;
      const inheritSkills = config.inheritParentSkills !== false;
      let inheritedTools: Tool<ZodTypeAny>[] = [];
      if (inheritTools) {
        // Path A (default): inherit the parent runner's full tool set.
        // Filter out tools the SubAgentRunner wires up itself:
        // - `delegate`: would be recursive (and sub-agents can't delegate)
        // - `load_skill`: auto-registered by AgentRunner when skillProvider is present
        const all = parentToolRegistry.getAll?.() ?? [];
        inheritedTools = all.filter(
          (t) => t.name !== 'delegate' && t.name !== 'load_skill'
        );
      } else {
        // Path B (opt-in minimal): only register tools explicitly declared in
        // config.config.tools. This gives "least-privilege" sub-agents — e.g.
        // a researcher that only has web_search, not shell/file_write.
        for (const toolDef of config.config.tools) {
          // `delegate` is never inherited — sub-agents cannot delegate (no recursion)
          if (toolDef.name === 'delegate') continue;
          const parentTool = parentToolRegistry.get(toolDef.name);
          if (parentTool) {
            inheritedTools.push(parentTool);
          }
        }
      }

      // Create a sub-agent runner for this delegation (custom or default factory)
      const subRunner = subAgentRunnerFactory({
        model: model ?? 'sub-agent',
        llmClient: llmProvider,
        inheritedTools,
        skillProvider: inheritSkills ? parentSkillProvider : undefined,
        maxSteps: config.maxSteps ?? DEFAULT_SUBAGENT_MAX_STEPS,
        thinkingEnabled,
        temperature,
      });

      // Wire sub-agent event forwarding: each event is re-emitted to the parent
      // runner's EventEmitter with a 'subagent:' prefix and subtaskId for routing.
      const subtaskId = `${agent}-${Date.now()}`;
      const forwardEvents = ['token', 'thinking', 'tool:start', 'tool:end', 'tools:start', 'tools:end'];
      for (const evtType of forwardEvents) {
        subRunner.on(evtType as 'token', (...args: unknown[]) => {
          const data = (args[0] ?? {}) as Record<string, unknown>;
          deps.emit(`subagent:${evtType}`, { ...data, subtaskId, subagentName: agent });
        });
      }

      // Emit subagent:start before running
      const subStartTime = Date.now();
      deps.emit('subagent:start', { name: agent, task, subtaskId, timestamp: subStartTime });

      // Check abort signal before running
      if (options?.signal?.aborted) {
        return {
          status: 'abort',
          totalSteps: 0,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          duration: 0,
        } satisfies DelegateResult;
      }

      // Set up timeout if configured — combines with caller's signal
      const timeoutMs = config.timeout;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutController = new AbortController();
      const combinedSignal = options?.signal
        ? AbortSignal.any([options.signal, timeoutController.signal])
        : timeoutController.signal;

      if (timeoutMs) {
        timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
      }

      // Run until completion with signal + timeout support
      let result;
      try {
        ({ result } = await subRunner.run(stateWithTask, {
          signal: combinedSignal,
        }));
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      // Check if timeout caused the abort
      if (result.type === 'abort' && timeoutMs && timeoutController.signal.aborted) {
        const timeoutResult: DelegateResult = {
          status: 'timeout',
          partialResult: '',
          totalSteps: result.totalSteps,
          tokens: result.tokens,
          duration: Date.now() - subStartTime,
        };
        deps.emit('subagent:end', {
          name: agent,
          result: timeoutResult,
          subtaskId,
          timestamp: Date.now(),
        });
        return timeoutResult;
      }

      // Build the structured result — tokens and duration flow up from the sub-agent's RunResult
      let delegateResult: DelegateResult;
      if (result.type === 'abort') {
        delegateResult = {
          status: 'abort',
          totalSteps: result.totalSteps,
          tokens: result.tokens,
          duration: Date.now() - subStartTime,
        };
      } else if (result.type === 'success') {
        delegateResult = {
          status: 'success',
          answer: result.answer,
          totalSteps: result.totalSteps,
          tokens: result.tokens,
          duration: Date.now() - subStartTime,
        };
      } else if (result.type === 'error') {
        delegateResult = {
          status: 'error',
          error: result.error.message,
          totalSteps: result.totalSteps,
          tokens: result.tokens,
          duration: Date.now() - subStartTime,
        };
      } else {
        delegateResult = {
          status: 'max_steps',
          lastAnswer: result.type === 'stopped' ? (result.data ?? '') : '',
          totalSteps: result.totalSteps,
          tokens: result.tokens,
          duration: Date.now() - subStartTime,
        };
      }

      // Emit subagent:end with the result
      deps.emit('subagent:end', { name: agent, result: delegateResult, subtaskId, timestamp: Date.now() });

      return delegateResult;
    },
  };
}
