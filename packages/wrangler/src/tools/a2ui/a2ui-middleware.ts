/**
 * @fileoverview A2UI Middleware — intercepts a2ui_wait tool calls
 *
 * Uses the colts waiting-human mechanism with tool-confirm as carrier type.
 * The A2UI-specific request is identified by toolName === 'a2ui_wait'.
 */

import type { AgentMiddleware } from '@agentskillmania/colts';
import type { BeforeAdvanceContext, AdvanceHookReturn } from '@agentskillmania/colts';

export class A2UIMiddleware implements AgentMiddleware {
  readonly name = 'A2UIMiddleware';

  async beforeAdvance(ctx: BeforeAdvanceContext): Promise<AdvanceHookReturn> {
    const { state, execState } = ctx;

    if (execState.phase.type !== 'executing-tool') return;
    if (!execState.action) return;

    // Only intercept a2ui_wait
    if (execState.action.tool !== 'a2ui_wait') return;

    const action = execState.action;
    const surfaceId = (action.arguments as Record<string, unknown>).surfaceId as string;

    return {
      state,
      execState,
      stop: true,
      result: {
        state,
        execState,
        phase: {
          type: 'waiting-human',
          request: {
            type: 'tool-confirm',
            toolName: 'a2ui_wait',
            args: { surfaceId },
            toolCallId: action.id,
          },
        },
        done: true,
      },
    };
  }
}
