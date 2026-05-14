import '@agentskillmania/colts';
import type { TodoList } from '../todolist/types.js';

declare module '@agentskillmania/colts' {
  interface AgentContext {
    todoList?: TodoList;
  }
}
