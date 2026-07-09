/**
 * @fileoverview Skill adapter — evaluates a SKILL.md.
 *
 * Creates an EnhancedRunner pointed at the skill's parent directory so the
 * skill is discoverable. Injects a load_skill instruction into the initial
 * state so the skill is deterministically activated (rather than relying on
 * the LLM to autonomously call load_skill).
 */

import { EnhancedRunner } from '@agentskillmania/wrangler';
import { createAgentState, addUserMessage, type AgentState } from '@agentskillmania/colts';

import type { EvalSuite } from '../types.js';
import { BaseAdapter } from './base-adapter.js';

export class SkillAdapter extends BaseAdapter {
  /**
   * For skill evaluation, skillDirs points at the target skill's parent dir
   * so the skill is discoverable by FilesystemSkillProvider.
   */
  protected getSkillDirs(suite: EvalSuite): string[] {
    // suite.target.path is the skill parent dir for type=skill
    return [suite.target.path];
  }

  protected async buildInitialState(
    _runner: EnhancedRunner,
    suite: EvalSuite,
    _workspacePath: string
  ): Promise<AgentState> {
    const skillName = suite.target.skill;
    if (!skillName) {
      throw new Error('SkillAdapter requires target.skill to be set');
    }

    // Deterministic skill activation: inject a load_skill instruction.
    // This ensures the skill is loaded every time, regardless of LLM
    // decision-making — critical for reproducible evaluation.
    let state = createAgentState({
      name: 'eval-skill-agent',
      instructions: 'You are being evaluated. Use the loaded skill to complete the task.',
      tools: [],
    });

    // Pre-inject a message instructing the agent to load the skill.
    // The runner's load_skill tool will handle this on the first turn.
    state = addUserMessage(state, `Load the skill "${skillName}" using the load_skill tool, then complete the task.`);

    return state;
  }
}
