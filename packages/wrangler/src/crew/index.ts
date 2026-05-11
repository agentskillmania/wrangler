// @agentskillmania/wrangler — Layer 8 crew module

// Crew main class
export { Crew } from './crew.js';

// Tools
export {
  createCreateTaskTool,
  createSendMessageTool,
  createRelayToPrimaryTool,
  createReadCrewTodolistTool,
  createUpdateCrewTodolistTool,
} from './crew-tools.js';

// Internal components
export { AgentInstance } from './agent-instance.js';
export { MessageRouter } from './message-router.js';
export { CrewTodoList } from './crew-todolist.js';
export { buildLiaisonPrompt } from './liaison-prompt.js';
export { CrewLoader } from './crew-loader.js';

// Types
export type {
  AgentRole,
  AgentInstanceStatus,
  AgentInstanceInfo,
  TaskStatus,
  TaskInfo,
  CrewTodoStatus,
  CrewTodoItem,
  CrewStatus,
  CrewState,
  CrewInput,
  CrewOutputEvent,
  CrewEventHandler,
  CrewUserResponseEvent,
  CrewTaskStartedEvent,
  CrewTaskCompletedEvent,
  CrewTaskFailedEvent,
  CrewTodolistUpdatedEvent,
  CrewAgentCreatedEvent,
  CrewAgentDestroyedEvent,
  CrewErrorEvent,
  CrewToolInvokedEvent,
  CrewToolCompletedEvent,
  CrewAgentAdvancedEvent,
  CrewMessageRoutedEvent,
  CrewMessage,
  CrewConfig,
  CrewOptions,
} from './types.js';
