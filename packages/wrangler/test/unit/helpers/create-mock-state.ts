/**
 * @fileoverview Test helper: type-safe mock AgentState for wrangler tests
 *
 * Wrangler augments colts AgentState with extra fields (todoList, skillState, etc.)
 * that the base `createAgentState()` doesn't include. This helper builds a complete
 * state with sensible defaults, eliminating `as any` casts.
 */

import { createAgentState } from '@agentskillmania/colts';
import type { AgentState, AgentConfig } from '@agentskillmania/colts';

/** Default agent config for tests */
const defaultConfig: AgentConfig = {
  name: 'test-agent',
  instructions: 'You are a test agent.',
  tools: [],
};

/**
 * Create a mock AgentState with wrangler-augmented fields pre-populated.
 *
 * @param overrides - Partial state overrides applied on top of defaults
 * @returns A fully-typed AgentState with sensible test defaults
 */
export function createMockAgentState(
  overrides?: Partial<AgentState> & {
    /** Wrangler augmentation: todolist state */
    todoList?: unknown;
    /** Wrangler augmentation: skill state */
    skillState?: unknown;
  }
): AgentState {
  const { todoList, skillState, ...stateOverrides } = overrides ?? {};
  const base = createAgentState(defaultConfig);

  const state = {
    ...base,
    ...stateOverrides,
    context: {
      ...base.context,
      ...(stateOverrides?.context ?? {}),
    },
  } as AgentState & Record<string, unknown>;

  if (todoList !== undefined) {
    state.todoList = todoList;
  }
  if (skillState !== undefined) {
    state.context.skillState = skillState;
  }

  return state as AgentState;
}
