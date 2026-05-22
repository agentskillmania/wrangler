import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createAgentState } from '@agentskillmania/colts';
import type { AgentMiddleware, ExecutionState, Phase } from '@agentskillmania/colts';

function makeExecStateWithAction(
  toolName: string,
  args: Record<string, unknown> = {}
): ExecutionState {
  const action = { id: 'call_1', tool: toolName, arguments: args };
  return {
    phase: { type: 'executing-tool', actions: [action] },
    action,
    allActions: [action],
  };
}

describe('A2UIMiddleware', () => {
  it('should intercept a2ui_wait at executing-tool phase', async () => {
    const { A2UIMiddleware } = await import('../../../../src/tools/a2ui/a2ui-middleware.js');

    const mw = new A2UIMiddleware();
    const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
    const execState = makeExecStateWithAction('a2ui_wait', { surfaceId: 'form' });

    const result = await mw.beforeAdvance!({
      state,
      execState,
      fromPhase: { type: 'parsed', thought: 'I need to wait' } as Phase,
      stepNumber: 0,
      runnerOptions: {} as any,
    });

    expect(result).toBeDefined();
    expect(result!.stop).toBe(true);
    if (result!.stop) {
      expect(result!.result!.phase.type).toBe('waiting-human');
      expect(result!.result!.done).toBe(true);

      const request = result!.result!.phase.request;
      expect(request.type).toBe('tool-confirm');
      if (request.type === 'tool-confirm') {
        expect(request.toolName).toBe('a2ui_wait');
        expect(request.args).toEqual({ surfaceId: 'form' });
        expect(request.toolCallId).toBe('call_1');
      }
    }
  });

  it('should NOT intercept rendering tools', async () => {
    const { A2UIMiddleware } = await import('../../../../src/tools/a2ui/a2ui-middleware.js');

    const mw = new A2UIMiddleware();
    const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });

    const toolNames = [
      'a2ui_create_surface',
      'a2ui_update_components',
      'a2ui_update_data_model',
      'a2ui_delete_surface',
    ];
    for (const name of toolNames) {
      const execState = makeExecStateWithAction(name, { surfaceId: 'main' });
      const result = await mw.beforeAdvance!({
        state,
        execState,
        fromPhase: { type: 'parsed', thought: '' } as Phase,
        stepNumber: 0,
        runnerOptions: {} as any,
      });
      expect(result).toBeUndefined();
    }
  });

  it('should NOT intercept non-a2ui tools', async () => {
    const { A2UIMiddleware } = await import('../../../../src/tools/a2ui/a2ui-middleware.js');

    const mw = new A2UIMiddleware();
    const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
    const execState = makeExecStateWithAction('shell', { command: 'ls' });

    const result = await mw.beforeAdvance!({
      state,
      execState,
      fromPhase: { type: 'parsed', thought: '' } as Phase,
      stepNumber: 0,
      runnerOptions: {} as any,
    });

    expect(result).toBeUndefined();
  });

  it('should NOT intercept when phase is not executing-tool', async () => {
    const { A2UIMiddleware } = await import('../../../../src/tools/a2ui/a2ui-middleware.js');

    const mw = new A2UIMiddleware();
    const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });

    const execState = {
      phase: { type: 'idle' as const },
      action: undefined,
      allActions: [],
    } as unknown as ExecutionState;

    const result = await mw.beforeAdvance!({
      state,
      execState,
      fromPhase: { type: 'idle' } as Phase,
      stepNumber: 0,
      runnerOptions: {} as any,
    });

    expect(result).toBeUndefined();
  });
});
