/** 任务状态 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed';

/** 单个任务项 */
export interface TodoItem {
  id: number;
  subject: string;
  description?: string;
  status: TodoStatus;
  blocks?: number[];
  blockedBy?: number[];
}

/** 任务列表 */
export interface TodoList {
  items: TodoItem[];
  nextId: number;
}
