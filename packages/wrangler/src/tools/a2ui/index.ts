/**
 * @fileoverview A2UI module — agent-driven UI rendering support
 */

export type {
  A2UIOperation,
  A2UIEvent,
  ComponentNode,
  ComponentOperation,
  A2UIUserResponse,
} from './types.js';
export { createA2UITools } from './create-a2ui-tools.js';
export { A2UIMiddleware } from './a2ui-middleware.js';
export { a2uiRespond } from './a2ui-respond.js';
export {
  CreateSurfaceSchema,
  UpdateComponentsSchema,
  UpdateDataModelSchema,
  DeleteSurfaceSchema,
  A2UIWaitSchema,
} from './schemas.js';
