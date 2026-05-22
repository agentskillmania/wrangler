/**
 * @fileoverview A2UI protocol type definitions
 *
 * A2UI (Agent-to-UI) v0.9 protocol types for wrangler integration.
 */

/** A2UI protocol operations */
export type A2UIOperation =
  | 'createSurface'
  | 'updateComponents'
  | 'updateDataModel'
  | 'deleteSurface';

/** Event emitted by A2UI tools during execution */
export interface A2UIEvent {
  type: 'a2ui';
  operation: A2UIOperation;
  payload: Record<string, unknown>;
  surfaceId: string;
  timestamp: number;
}

/** Component node in adjacency list model */
export interface ComponentNode {
  id: string;
  type: string;
  properties?: Record<string, unknown>;
  styles?: Record<string, unknown>;
}

/** Component operation types */
export type ComponentOperation =
  | { op: 'insert'; parentId: string; afterId?: string | null; component: ComponentNode }
  | {
      op: 'update';
      componentId: string;
      properties?: Record<string, unknown>;
      styles?: Record<string, unknown>;
    }
  | { op: 'delete'; componentId: string }
  | { op: 'replace'; parentId: string; afterId?: string | null; component: ComponentNode };

/** A2UI user response sent back from renderer */
export interface A2UIUserResponse {
  type: 'a2ui-response';
  surfaceId: string;
  dataModel: Record<string, unknown>;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
}
