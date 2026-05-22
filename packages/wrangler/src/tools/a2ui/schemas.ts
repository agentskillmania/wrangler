/**
 * @fileoverview Zod schemas for A2UI tools
 */

import { z } from 'zod';

export const CreateSurfaceSchema = z.object({
  surfaceId: z.string().describe('Unique surface identifier'),
  layout: z.enum(['vertical', 'horizontal', 'grid']).optional(),
  metadata: z.record(z.unknown()).optional().describe('Surface metadata (title, icon, etc.)'),
});

export const ComponentNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  properties: z.record(z.unknown()).optional(),
  styles: z.record(z.unknown()).optional(),
});

export const ComponentOperationSchema = z.union([
  z.object({
    op: z.literal('insert'),
    parentId: z.string(),
    afterId: z.string().nullable().optional(),
    component: ComponentNodeSchema,
  }),
  z.object({
    op: z.literal('update'),
    componentId: z.string(),
    properties: z.record(z.unknown()).optional(),
    styles: z.record(z.unknown()).optional(),
  }),
  z.object({
    op: z.literal('delete'),
    componentId: z.string(),
  }),
  z.object({
    op: z.literal('replace'),
    parentId: z.string(),
    afterId: z.string().nullable().optional(),
    component: ComponentNodeSchema,
  }),
]);

export const UpdateComponentsSchema = z.object({
  surfaceId: z.string(),
  operations: z.array(ComponentOperationSchema).min(1),
});

export const UpdateDataModelSchema = z.object({
  surfaceId: z.string(),
  updates: z
    .array(
      z.object({
        path: z.string().describe('JSON Pointer path, e.g. "/form/name"'),
        value: z.unknown(),
      })
    )
    .min(1),
});

export const DeleteSurfaceSchema = z.object({
  surfaceId: z.string(),
});

export const A2UIWaitSchema = z.object({
  surfaceId: z.string().describe('The surface to wait for user interaction on'),
});
