import { AgentRunner } from '@agentskillmania/colts';
import type { AgentState, RunnerEventMap, RunResult } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';
import type { Tool } from '@agentskillmania/colts';
import { createBuiltinTools } from '../tools/builtin/index.js';
import { loadMCPTools } from '../tools/mcp/index.js';
import { discoverGlobalConfigPath } from '../tools/mcp/config-merger.js';
import { createSessionSupport } from '../session/support.js';
import { createTodolistSupport } from '../todolist/support.js';
import { buildTimeContext } from './system-prompt.js';
import { MarkdownMessageAssembler } from './markdown-assembler.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { EnhancedRunnerOptions } from './types.js';

function discoverMCPPaths(workspacePath: string): string[] {
  const paths: string[] = [];
  const globalPath = discoverGlobalConfigPath();
  if (existsSync(globalPath)) paths.push(globalPath);
  const localPath = join(workspacePath, 'mcp.json');
  if (existsSync(localPath)) paths.push(localPath);
  return paths;
}

/**
 * EnhancedRunner — Pre-wired AgentRunner with all wrangler runtime mechanisms
 *
 * Wraps colts AgentRunner and pre-configures:
 * - Builtin tools (file operations, shell, web search/fetch)
 * - MCP tools (discovered from global + local mcp.json configs)
 * - Session support (persistence, calculator, ask_human)
 * - Todolist support (task management)
 * - Time context in system prompt
 *
 * Design principles:
 * - Stateless: state is managed externally, same as AgentRunner
 * - Interface consistent: run(state) signature matches AgentRunner.run()
 * - Pre-wires everything: constructor-time assembly of all Layer 1 mechanisms
 *
 * @example
 * ```typescript
 * const runner = await EnhancedRunner.create({
 *   llmClient,
 *   model: 'gpt-4',
 *   workspacePath: '/my/project',
 * });
 *
 * const result = await runner.run(initialState);
 * ```
 */
export class EnhancedRunner {
  private readonly innerRunner: AgentRunner;

  private constructor(runner: AgentRunner) {
    this.innerRunner = runner;
  }

  /**
   * Create an EnhancedRunner with all tools and middleware pre-wired
   *
   * @param options - Configuration options
   * @returns Configured EnhancedRunner instance
   */
  static async create(options: EnhancedRunnerOptions): Promise<EnhancedRunner> {
    const workspacePath = options.workspacePath ?? process.cwd();

    const builtinTools = createBuiltinTools({
      workspacePath,
      searchProvider: options.searchProvider,
      sandbox: options.sandbox,
    });

    const mcpConfigPaths = options.mcpConfigPaths ?? discoverMCPPaths(workspacePath);
    const mcpTools = await loadMCPTools({ configPaths: mcpConfigPaths });

    const sessionSupport = createSessionSupport({
      workspacePath,
      sessionBaseDir: options.sessionBaseDir,
      askHumanHandler: options.askHumanHandler,
    });

    const todolistSupport = createTodolistSupport();

    const allTools: Tool<ZodTypeAny>[] = [
      ...sessionSupport.tools,
      ...builtinTools,
      ...mcpTools,
      ...todolistSupport.tools,
      ...(options.extraTools ?? []),
    ];

    const runner = new AgentRunner({
      model: options.model ?? 'gpt-4',
      llmClient: options.llmClient,
      tools: allTools,
      middleware: [sessionSupport.middleware, todolistSupport.middleware],
      systemPrompt: buildTimeContext(),
      skillDirectories: options.skillDirectories,
      thinkingEnabled: options.thinkingEnabled,
      messageAssembler: new MarkdownMessageAssembler(),
    });

    return new EnhancedRunner(runner);
  }

  /**
   * Run agent until completion
   *
   * @param state - Current agent state
   * @param options - Optional run configuration (maxSteps, signal)
   * @returns Final state and run result
   */
  run(
    state: AgentState,
    options?: { maxSteps?: number; signal?: AbortSignal }
  ): Promise<{ state: AgentState; result: RunResult }> {
    return this.innerRunner.run(state, options);
  }

  /**
   * Stream agent execution until completion
   *
   * @param state - Current agent state
   * @param options - Optional run configuration (maxSteps, signal)
   * @returns Async generator of run stream events
   */
  runStream(
    state: AgentState,
    options?: { maxSteps?: number; signal?: AbortSignal }
  ): AsyncIterable<unknown> {
    return this.innerRunner.runStream(state, options);
  }

  /**
   * Register event listener on the underlying runner
   *
   * @param event - Event name (keyof RunnerEventMap)
   * @param handler - Event handler (accepts variadic args from EventEmitter)
   * @returns this for chaining
   */
  on<K extends keyof RunnerEventMap>(event: K, handler: (...args: unknown[]) => void): this {
    this.innerRunner.on(event, handler);
    return this;
  }
}
