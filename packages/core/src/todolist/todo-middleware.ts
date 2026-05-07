import type { AgentMiddleware, AgentState } from '@agentskillmania/colts';
import { updateState } from '@agentskillmania/colts';
import type { TodoList } from './types.js';
import { formatTodoForContext } from './todo-state.js';

const MARKER_START = '=== Current Task List ===';

/**
 * 创建 todolist 上下文注入 middleware
 *
 * 在 beforeStep 中将 todolist 状态注入 instructions，
 * 每步用原始 instructions + 当前 todolist 重建，不累积。
 */
export function createTodolistMiddleware(getList: () => TodoList | null): AgentMiddleware {
  // 保存原始 instructions 的 WeakMap，key 是 state 对象
  const originalInstructions = new WeakMap<AgentState, string>();

  return {
    name: 'todolist',

    async beforeStep(ctx) {
      const list = getList();
      if (!list || list.items.length === 0) return;

      const formatted = formatTodoForContext(list);
      if (!formatted) return;

      // 获取原始 instructions：第一次注入时保存，后续使用保存的原始值
      let original = originalInstructions.get(ctx.state);
      if (!original) {
        original = stripPreviousInjection(ctx.state.config.instructions);
        originalInstructions.set(ctx.state, original);
      } else {
        // state 可能被其他 middleware 替换，更新引用
        original = stripPreviousInjection(ctx.state.config.instructions);
        originalInstructions.set(ctx.state, original);
      }

      const newInstructions = original + '\n\n' + formatted;
      const newState = updateState(ctx.state, (draft) => {
        draft.config.instructions = newInstructions;
      });

      return { state: newState };
    },
  };
}

/** 移除之前的 todolist 注入，恢复原始 instructions */
function stripPreviousInjection(instructions: string): string {
  const idx = instructions.indexOf('\n\n' + MARKER_START);
  if (idx === -1) return instructions;
  return instructions.slice(0, idx);
}
