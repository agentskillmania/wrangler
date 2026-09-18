/**
 * @fileoverview Factory for 4 A2UI display-only tools
 *
 * All tools return success descriptions and never block. HITL 入口唯一化
 * （D4，对齐 Rust 02b1bc6）："要人给东西"只有 ask_human 一个入口，a2ui
 * 只负责展示——工具参数/结果经 runner 既有事件系统（tool:start 携带
 * action、tool:end 携带 result）到达前端渲染。
 */

import type { Tool } from '@agentskillmania/colts';
import { z } from 'zod';

import {
  CreateSurfaceSchema,
  UpdateComponentsSchema,
  UpdateDataModelSchema,
  DeleteSurfaceSchema,
} from './schemas.js';

export function createA2UITools(): Tool<z.ZodTypeAny>[] {
  return [
    {
      name: 'a2ui_create_surface',
      description: 'Create a new UI surface (page/dialog). Use this before adding components.',
      parameters: CreateSurfaceSchema,
      async execute(args: z.infer<typeof CreateSurfaceSchema>) {
        return `Surface created: "${args.surfaceId}"${args.layout ? ` (${args.layout})` : ''}`;
      },
    },
    {
      name: 'a2ui_update_components',
      description:
        'Update the component tree on a surface. PREFERRED: send the FULL tree in one operation — ' +
        '{ "op": "replace", "path": "/components", "value": [ ...all components, genui shape { id, component, ...flat props } ] }. ' +
        'Also supports addressed insert/update/delete/replace operations on single components.',
      parameters: UpdateComponentsSchema,
      async execute(args: z.infer<typeof UpdateComponentsSchema>) {
        return `Components updated on surface "${args.surfaceId}" (${args.operations.length} operation${args.operations.length > 1 ? 's' : ''})`;
      },
    },
    {
      name: 'a2ui_update_data_model',
      description:
        'Update the data model for a surface (used for form field bindings via JSON Pointer).',
      parameters: UpdateDataModelSchema,
      async execute(args: z.infer<typeof UpdateDataModelSchema>) {
        return `Data model updated on surface "${args.surfaceId}" (${args.updates.length} update${args.updates.length > 1 ? 's' : ''})`;
      },
    },
    {
      name: 'a2ui_delete_surface',
      description: 'Delete a UI surface and all its components.',
      parameters: DeleteSurfaceSchema,
      async execute(args: z.infer<typeof DeleteSurfaceSchema>) {
        return `Surface deleted: "${args.surfaceId}"`;
      },
    },
  ];
}
