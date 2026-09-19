/**
 * @fileoverview Crew adapter — evaluates a CREW.md + agents/*.md crew.
 *
 * Loads the crew via CrewLoader, converts to runner options via
 * crewToRunnerOptions, then constructs AgentHarness with subAgents
 * enabled. Mirrors the daemon's /api/crews/:id/chat flow.
 */

import { createAgentState, type AgentState } from '@agentskillmania/colts';
import { LLMClient } from '@agentskillmania/llm-client';
import {
  AgentHarness,
  CrewLoader,
  crewToRunnerOptions,
  type CrewRunnerOptions,
} from '@agentskillmania/wrangler';
import { NodeHostEnv } from '@agentskillmania/wrangler/host-env/node-host-env';

import type { EvalSuite } from '../types.js';
import { BaseAdapter } from './base-adapter.js';

export class CrewAdapter extends BaseAdapter {
  /** Cached crew runner options (loaded once per suite). */
  private crewRunnerOpts: CrewRunnerOptions | undefined;

  /** Lazy-load + convert crew config on first access. */
  private async ensureLoaded(suite: EvalSuite): Promise<CrewRunnerOptions> {
    if (this.crewRunnerOpts) return this.crewRunnerOpts;
    const crewConfig = await new CrewLoader(suite.target.path, new NodeHostEnv()).load();
    this.crewRunnerOpts = crewToRunnerOptions(crewConfig);
    return this.crewRunnerOpts;
  }

  /** Crew skill dirs come from the crew definition itself. */
  protected getSkillDirs(suite: EvalSuite): string[] {
    // Synchronous override — if not yet loaded, fall back to the conventional
    // '<crewDir>/skills' path. The async createRunner re-reads after load.
    if (this.crewRunnerOpts) {
      return [...(this.crewRunnerOpts.skillDirs ?? [])];
    }
    return [suite.target.path + '/skills'];
  }

  /** Override createRunner to inject subAgents + crew model + sandbox. */
  protected async createRunner(suite: EvalSuite, workspacePath: string): Promise<AgentHarness> {
    const opts = await this.ensureLoaded(suite);

    // Load LLM config the same way BaseAdapter does
    const { loadEvalLlmConfig } = await import('../config.js');
    const llmConfig = await loadEvalLlmConfig(suite.target.path);

    // llm 分组结构：quickInit 载荷 + 宿主注入的创建器（引擎 core 不捆绑内置 LLM）
    const llm: Record<string, unknown> = {
      quickInit: llmConfig.llm,
      quickInitFactory: (providers: Parameters<typeof LLMClient.quickInit>[0]['providers']) =>
        LLMClient.quickInit({ providers }),
    };

    const runnerOpts: Record<string, unknown> = {
      workspacePath,
      runtime: new NodeHostEnv(),
      llm,
      // Crew's skill dirs + the conventional <crewDir>/skills (already in
      // crewRunnerOpts) — pass directly.
      skills: { dirs: opts.skillDirs },
      // T7 自包含：crew 私有 MCP 轴透传（否则 eval 永远忽略 <crew>/mcp.json）
      tools: { mcpConfigPaths: opts.mcpPaths },
      session: { enabled: false },
      todolist: { enabled: false },
      commands: { enabled: false },
      // The crew wiring: sub-agents turn on the delegate tool, and the
      // model from the crew definition wins over suite defaults
      // (suite.sampling.model can still override below if set).
      delegation: { subAgents: opts.subAgents },
    };
    if (suite.sampling.model) {
      runnerOpts.llm = { ...(runnerOpts.llm as object), model: suite.sampling.model };
    } else if (opts.model) {
      runnerOpts.llm = { ...(runnerOpts.llm as object), model: opts.model };
    }

    return AgentHarness.create(runnerOpts as Parameters<typeof AgentHarness.create>[0]);
  }

  /**
   * Build initial state using the crew's composed system prompt (memory +
   * primary instructions + sub-agent catalog) as the primary agent's
   * instructions. Mirrors daemon's crew chat route wiring.
   */
  protected async buildInitialState(
    runner: AgentHarness,
    suite: EvalSuite,
    _workspacePath: string
  ): Promise<AgentState> {
    const opts = await this.ensureLoaded(suite);
    return createAgentState({
      name: opts.primaryAgent,
      instructions: opts.systemPrompt,
      tools: runner.getToolInfo().map((t) => ({ name: t.name, description: t.description })),
    });
  }
}
