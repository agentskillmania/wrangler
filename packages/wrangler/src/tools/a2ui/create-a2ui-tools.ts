/**
 * @fileoverview Factory for 5 A2UI tools
 *
 * 4 rendering tools (return success descriptions) + 1 wait tool (intercepted by middleware).
 * No side effects — tool arguments/results are visible through the runner's existing event system
 * (tool:start and tool:end events carry the action and result data).
 */

import { z } from 'zod';
import type { Tool } from '@agentskillmania/colts';
import {
  CreateSurfaceSchema,
  UpdateComponentsSchema,
  UpdateDataModelSchema,
  DeleteSurfaceSchema,
  A2UIWaitSchema,
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
        'Update component tree on a surface. Supports insert, update, delete, and replace operations.',
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
    {
      name: 'a2ui_wait',
      description:
        'Signal that the UI is ready and wait for user interaction on the specified surface. ' +
        'The agent will pause until the user responds (e.g., submits a form, clicks a button).',
      parameters: A2UIWaitSchema,
      async execute(_args: z.infer<typeof A2UIWaitSchema>) {
        // This tool is intercepted by A2UIMiddleware at beforeAdvance.
        // If somehow execute() is called directly, return a message.
        return 'Waiting for user interaction (this should be intercepted by middleware)';
      },
    },
  ];
}
