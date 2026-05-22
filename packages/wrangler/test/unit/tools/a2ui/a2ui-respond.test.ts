import { describe, it, expect } from 'vitest';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import type { A2UIUserResponse } from '../../../../src/tools/a2ui/types.js';

function makeState() {
  return createAgentState({ name: 'test', instructions: 'test', tools: [] });
}

describe('a2uiRespond', () => {
  it('should add user message with A2UI response data', async () => {
    const { a2uiRespond } = await import('../../../../src/tools/a2ui/a2ui-respond.js');

    const state = makeState();
    const msgCountBefore = state.context.messages.length;

    const response: A2UIUserResponse = {
      type: 'a2ui-response',
      surfaceId: 'register',
      dataModel: { form: { name: 'Alice', email: 'alice@example.com' } },
      functionCall: { name: 'submit_form', args: {} },
    };

    const newState = a2uiRespond(state, response);

    expect(newState.context.messages).toHaveLength(msgCountBefore + 1);
    const lastMsg = newState.context.messages[newState.context.messages.length - 1];
    expect(lastMsg.role).toBe('user');

    const parsed = JSON.parse(lastMsg.content);
    expect(parsed).toEqual({
      type: 'a2ui_response',
      surfaceId: 'register',
      dataModel: { form: { name: 'Alice', email: 'alice@example.com' } },
      functionCall: { name: 'submit_form', args: {} },
    });
  });

  it('should add user message with dataModel only (no functionCall)', async () => {
    const { a2uiRespond } = await import('../../../../src/tools/a2ui/a2ui-respond.js');

    const state = makeState();
    const response: A2UIUserResponse = {
      type: 'a2ui-response',
      surfaceId: 's1',
      dataModel: { value: 'just data' },
    };

    const newState = a2uiRespond(state, response);

    const lastMsg = newState.context.messages[newState.context.messages.length - 1];
    const parsed = JSON.parse(lastMsg.content);
    expect(parsed.dataModel).toEqual({ value: 'just data' });
    expect(parsed.functionCall).toBeUndefined();
  });

  it('should not modify existing messages', async () => {
    const { a2uiRespond } = await import('../../../../src/tools/a2ui/a2ui-respond.js');

    const state = makeState();
    const stateWithMsg = addUserMessage(state, 'Hello');
    const msgCountBefore = stateWithMsg.context.messages.length;

    const newState = a2uiRespond(stateWithMsg, {
      type: 'a2ui-response',
      surfaceId: 's1',
      dataModel: {},
    });

    expect(newState.context.messages).toHaveLength(msgCountBefore + 1);
    expect(newState.context.messages[0].content).toBe('Hello');
  });
});
