import { describe, it, expect } from 'vitest';
import { z } from 'zod';

describe('A2UI Schemas', () => {
  it('should validate create_surface args', async () => {
    const { CreateSurfaceSchema } = await import('../../../../src/tools/a2ui/schemas.js');

    // Valid minimal
    const result1 = CreateSurfaceSchema.safeParse({ surfaceId: 'main' });
    expect(result1.success).toBe(true);
    if (result1.success) {
      expect(result1.data.surfaceId).toBe('main');
    }

    // Valid with options
    const result2 = CreateSurfaceSchema.safeParse({
      surfaceId: 'form',
      layout: 'vertical',
      metadata: { title: 'Test' },
    });
    expect(result2.success).toBe(true);

    // Invalid: missing surfaceId
    const result3 = CreateSurfaceSchema.safeParse({});
    expect(result3.success).toBe(false);
  });

  it('should validate update_components args', async () => {
    const { UpdateComponentsSchema } = await import('../../../../src/tools/a2ui/schemas.js');

    // Valid: insert operation
    const result1 = UpdateComponentsSchema.safeParse({
      surfaceId: 'main',
      operations: [
        {
          op: 'insert',
          parentId: 'root',
          component: { id: 'title', type: 'Text', properties: { text: 'Hello' } },
        },
      ],
    });
    expect(result1.success).toBe(true);

    // Valid: update operation
    const result2 = UpdateComponentsSchema.safeParse({
      surfaceId: 'main',
      operations: [{ op: 'update', componentId: 'title', properties: { text: 'Updated' } }],
    });
    expect(result2.success).toBe(true);

    // Valid: delete operation
    const result3 = UpdateComponentsSchema.safeParse({
      surfaceId: 'main',
      operations: [{ op: 'delete', componentId: 'title' }],
    });
    expect(result3.success).toBe(true);

    // Invalid: unknown op
    const result4 = UpdateComponentsSchema.safeParse({
      surfaceId: 'main',
      operations: [{ op: 'explode', componentId: 'title' }],
    });
    expect(result4.success).toBe(false);

    // Invalid: empty operations
    const result5 = UpdateComponentsSchema.safeParse({
      surfaceId: 'main',
      operations: [],
    });
    expect(result5.success).toBe(false);
  });

  it('should validate update_data_model args', async () => {
    const { UpdateDataModelSchema } = await import('../../../../src/tools/a2ui/schemas.js');

    // Valid
    const result1 = UpdateDataModelSchema.safeParse({
      surfaceId: 'form',
      updates: [
        { path: '/form/name', value: 'Alice' },
        { path: '/form/email', value: '' },
      ],
    });
    expect(result1.success).toBe(true);

    // Invalid: empty updates
    const result2 = UpdateDataModelSchema.safeParse({
      surfaceId: 'form',
      updates: [],
    });
    expect(result2.success).toBe(false);

    // Invalid: missing path
    const result3 = UpdateDataModelSchema.safeParse({
      surfaceId: 'form',
      updates: [{ value: 'x' }],
    });
    expect(result3.success).toBe(false);
  });

  it('should validate delete_surface args', async () => {
    const { DeleteSurfaceSchema } = await import('../../../../src/tools/a2ui/schemas.js');

    // Valid
    const result1 = DeleteSurfaceSchema.safeParse({ surfaceId: 'main' });
    expect(result1.success).toBe(true);

    // Invalid: missing surfaceId
    const result2 = DeleteSurfaceSchema.safeParse({});
    expect(result2.success).toBe(false);
  });

  it('should validate a2ui_wait args', async () => {
    const { A2UIWaitSchema } = await import('../../../../src/tools/a2ui/schemas.js');

    // Valid
    const result1 = A2UIWaitSchema.safeParse({ surfaceId: 'form' });
    expect(result1.success).toBe(true);

    // Invalid: missing surfaceId
    const result2 = A2UIWaitSchema.safeParse({});
    expect(result2.success).toBe(false);
  });
});
