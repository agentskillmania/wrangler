/**
 * @fileoverview Agent adapter — evaluates an agent definition (AGENT.md).
 *
 * Creates an EnhancedRunner pointed at the agent's project directory,
 * builds an empty AgentState, and lets the runner execute normally.
 */

import { EnhancedRunner } from '@agentskillmania/wrangler';
import { createAgentState, type AgentState } from '@agentskillmania/colts';

import type { EvalSuite } from '../types.js';
import { BaseAdapter } from './base-adapter.js';

export class AgentAdapter extends BaseAdapter {
  protected async buildInitialState(
    _runner: EnhancedRunner,
    suite: EvalSuite,
    _workspacePath: string
  ): Promise<AgentState> {
    // Minimal agent state — the runner's tools and system prompt come from
    // EnhancedRunner.create() config. We just need a name and instructions.
    return createAgentState({
      name: 'eval-agent',
      instructions: 'You are being evaluated. Complete the task as instructed.',
      tools: [],
    });
  }
}
