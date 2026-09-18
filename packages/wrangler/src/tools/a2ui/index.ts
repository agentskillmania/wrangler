/**
 * @fileoverview A2UI module — agent-driven UI rendering support
 *
 * 纯展示工具面（D4，对齐 Rust 02b1bc6）：四把工具非阻塞，需用户输入时
 * 模型走 ask_human。曾有的 a2ui_wait 阻塞工具与 A2UIMiddleware 拦截、
 * a2ui_respond 载荷死线已随 HITL 入口唯一化移除。
 */

export type { A2UIOperation, A2UIEvent, ComponentNode, ComponentOperation } from './types.js';
export { createA2UITools } from './create-a2ui-tools.js';
export {
  CreateSurfaceSchema,
  UpdateComponentsSchema,
  UpdateDataModelSchema,
  DeleteSurfaceSchema,
} from './schemas.js';
