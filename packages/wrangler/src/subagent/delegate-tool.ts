/**
 * @fileoverview Delegate Tool factory (wrangler layer)
 *
 * Creates the 'delegate' tool that allows the parent agent to delegate tasks
 * to specialized sub-agents. Each delegation spins up a fresh SubAgentRunner
 * (a trimmed AgentHarness) via {@link createSubAgentRunner}.
 *
 * Migrated from colts — the key difference is that sub-agent creation now uses
 * wrangler's SubAgentRunner (with MarkdownMessageAssembler (tail time/todo reminder),
 * todolist) instead of colts' bare AgentRunner.
 *
 * 双模式（R2P-141c，对齐 Rust delegate_tools.rs / 设计文档 D1）：
 * - 监督者在槽且活着（daemon 会话物化后晚绑定）→ 异步受理：子任务上交
 *   监督者后台执行（并发闸门/看门狗/取消级联归它），handler 立即返回
 *   accepted 回执；结果将作为投递消息自动回到会话。
 * - 空槽 / 会话已逝 / 未配置（devtool/裸 runner/子代理自身）→ 同步阻塞
 *   到子 runner 完成（旧行为，零变化）。
 */

import { AgentRunner, createAgentState, addUserMessage } from '@agentskillmania/colts';
import type {
  ILLMProvider,
  IToolRegistry,
  ISkillProvider,
  Tool,
  RunResult,
} from '@agentskillmania/colts';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

import type { SubAgentConfig, DelegateResult } from './types.js';
import { DEFAULT_SUBAGENT_MAX_STEPS } from './types.js';
import { createSubAgentRunner, type SubAgentRunnerOptions } from '../runner/sub-agent-runner.js';
import type { SupervisorSlot } from '../session/supervisor.js';

/**
 * subtask_id 的进程内序号（对齐 Rust SUBTASK_SEQ）：并行工具批里同 agent
 * 同毫秒的两次委派也必须拿到不同的 id（登记簿/取消级联/前端配对都按
 * id 键控）。
 */
let SUBTASK_SEQ = 0;

/** 下一个 subtask_id：`{agent}-{utc毫秒}-{序号}`。 */
function nextSubtaskId(agent: string): string {
  return `${agent}-${Date.now()}-${SUBTASK_SEQ++}`;
}

const ZERO_TOKENS = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/**
 * Map a sub-runner's RunResult into the DelegateResult wire shape.
 * 纯函数（同步/异步模式共用——同步路径的行为由此保持逐位不变）。
 */
function buildDelegateResult(
  result: RunResult,
  timedOut: boolean,
  startTime: number
): DelegateResult {
  const duration = Date.now() - startTime;
  if (timedOut) {
    return {
      status: 'timeout',
      partialResult: '',
      totalSteps: result.totalSteps,
      tokens: result.tokens,
      duration,
    };
  }
  if (result.type === 'abort') {
    return { status: 'abort', totalSteps: result.totalSteps, tokens: result.tokens, duration };
  }
  if (result.type === 'success') {
    return {
      status: 'success',
      answer: result.answer,
      totalSteps: result.totalSteps,
      tokens: result.tokens,
      duration,
    };
  }
  if (result.type === 'error') {
    return {
      status: 'error',
      error: result.error.message,
      totalSteps: result.totalSteps,
      tokens: result.tokens,
      duration,
    };
  }
  return {
    status: 'max_steps',
    lastAnswer: result.type === 'stopped' ? (result.data ?? '') : '',
    totalSteps: result.totalSteps,
    tokens: result.tokens,
    duration,
  };
}

/**
 * Factory signature for creating a sub-agent runner.
 *
 * Replaces colts' `ISubAgentFactory`. The default implementation
 * ({@link createSubAgentRunner}) wires up MarkdownMessageAssembler (tail time/todo reminder),
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
   * 异步委派监督者槽（R2P-141c，对齐 Rust DelegateDeps.supervisor）：
   * AgentHarness 构建时创建（空 = 同步模式默认），会话物化后由宿主
   * 晚绑定（setDelegateSupervisor）。handler 每次调用时读槽——有活监督者
   * 即「受理即返回」，空槽/失活回落同步（零变化）。
   */
  supervisorSlot?: SupervisorSlot;
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
        inheritedTools = all.filter((t) => t.name !== 'delegate' && t.name !== 'load_skill');
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

      // 委派模式分叉（R2P-141c）：监督者在槽且活着 = 异步受理。帧写口
      // 取监督者 sink（直写会话通道——轮外也可见、断线重放不丢子女进展）；
      // sink 失配（与 is_alive 的良性竞态）兜底父 runner 通道（轮内搬运）。
      // 空槽 = 同步模式，写口仍是 deps.emit（旧行为零变化）。
      const slotted = deps.supervisorSlot?.current;
      const supervisor = slotted?.isAlive() ? slotted : undefined;
      const emitFn: (type: string, data: Record<string, unknown>) => void = supervisor
        ? (supervisor.eventSink() ?? deps.emit)
        : deps.emit;

      // Wire sub-agent event forwarding: each event is re-emitted with a
      // 'subagent:' prefix and subtaskId for routing.
      const subtaskId = nextSubtaskId(agent);
      const forwardEvents = [
        'token',
        'thinking',
        'tool:start',
        'tool:end',
        'tools:start',
        'tools:end',
      ];
      for (const evtType of forwardEvents) {
        subRunner.on(evtType as 'token', (...args: unknown[]) => {
          const data = (args[0] ?? {}) as Record<string, unknown>;
          emitFn(`subagent:${evtType}`, { ...data, subtaskId, subagentName: agent });
        });
      }

      const subStartTime = Date.now();

      if (supervisor) {
        // 异步受理（对齐 Rust 受理回执形状）：handler 立即返回，子任务后台
        // 执行——驱动闭包只受配置 timeout 与监督者看门狗约束（父轮信号不
        // 级联进后台子女；用户叫停走 cancelAll 级联）。
        const run = async (signal: AbortSignal): Promise<DelegateResult> => {
          // subagent:start 在实际开跑（过闸门后进入 run 闭包）时才发——
          // 对齐 Rust drive 闭包内的发射位。受理即发会把排队中的子女全部
          // 误标 started，且排队中被 cancelAll 的子女有 start 无 end。
          emitFn('subagent:start', { name: agent, task, subtaskId, timestamp: subStartTime });
          const timeoutMs = config.timeout;
          const timeoutController = new AbortController();
          const combinedSignal = AbortSignal.any([signal, timeoutController.signal]);
          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          if (timeoutMs) {
            timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
          }
          let result: RunResult;
          try {
            ({ result } = await subRunner.run(stateWithTask, { signal: combinedSignal }));
          } catch (err) {
            // run 抛错路径也补 subagent:end（前端不悬块）；错误投递走
            // supervisor 的 errorOutcome 链路。
            emitFn('subagent:end', {
              name: agent,
              result: {
                status: 'error',
                error: String(err),
                durationMs: Date.now() - subStartTime,
              },
              subtaskId,
              timestamp: Date.now(),
            });
            throw err;
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
          }
          const timedOut = result.type === 'abort' && timeoutController.signal.aborted;
          const delegateResult = buildDelegateResult(result, timedOut, subStartTime);
          emitFn('subagent:end', {
            name: agent,
            result: delegateResult,
            subtaskId,
            timestamp: Date.now(),
          });
          return delegateResult;
        };
        supervisor.accept({ subtaskId, agent, task, run });
        return {
          status: 'accepted',
          subtaskId,
          agent,
          task,
          // accepted 回执：告诉父 agent 任务已在后台执行，结果会以投递消息的
          // 形式回到会话，不要等待或重复委派。message 用英文——协议层的
          // 统一语言。
          message:
            'Sub-task accepted and running in the background. Its result will be delivered back to this session automatically — do not wait for it or re-delegate.',
        };
      }

      // ── 同步模式（旧行为，零变化）──

      // Emit subagent:start before running
      deps.emit('subagent:start', { name: agent, task, subtaskId, timestamp: subStartTime });

      // Check abort signal before running
      if (options?.signal?.aborted) {
        return {
          status: 'abort',
          totalSteps: 0,
          tokens: { ...ZERO_TOKENS },
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
      const timedOut = result.type === 'abort' && timeoutController.signal.aborted;
      const delegateResult = buildDelegateResult(result, timedOut, subStartTime);

      // Emit subagent:end with the result
      deps.emit('subagent:end', {
        name: agent,
        result: delegateResult,
        subtaskId,
        timestamp: Date.now(),
      });

      return delegateResult;
    },
  };
}
