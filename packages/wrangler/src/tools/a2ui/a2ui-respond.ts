/**
 * @fileoverview a2uiRespond — injects A2UI user response as a user message
 *
 * When a user submits an A2UI form, the data is injected as a user message
 * into the conversation. The agent sees it as normal user input on the next run.
 */

import { addUserMessage } from '@agentskillmania/colts';
import type { AgentState } from '@agentskillmania/colts';
import type { A2UIUserResponse } from './types.js';

export function a2uiRespond(state: AgentState, response: A2UIUserResponse): AgentState {
  return addUserMessage(
    state,
    JSON.stringify({
      type: 'a2ui_response',
      surfaceId: response.surfaceId,
      dataModel: response.dataModel,
      functionCall: response.functionCall,
    })
  );
}
