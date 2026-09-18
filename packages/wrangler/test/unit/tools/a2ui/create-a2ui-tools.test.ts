import { describe, it, expect } from 'vitest';

describe('createA2UITools', () => {
  // ─── 工具面契约(HITL 入口唯一化)─────────────────────────────────────────

  /**
   * a2ui 的工具面是**纯展示**的四把工具。"要人给东西"只有一个入口:
   * ask_human。不存在阻塞式的 a2ui_wait(它是"展示"与"要输入"两个概念的
   * 混合体,已移除——D4,对齐 Rust 02b1bc6)。
   */
  it('registered a2ui tools are display-only (no blocking wait)', async () => {
    const { createA2UITools } = await import('../../../../src/tools/a2ui/create-a2ui-tools.js');

    const tools = createA2UITools();

    expect(tools.map((t) => t.name).sort()).toEqual([
      'a2ui_create_surface',
      'a2ui_delete_surface',
      'a2ui_update_components',
      'a2ui_update_data_model',
    ]);
    expect(tools.map((t) => t.name)).not.toContain('a2ui_wait');
  });

  it('a2ui_create_surface should return success message with layout', async () => {
    const { createA2UITools } = await import('../../../../src/tools/a2ui/create-a2ui-tools.js');

    const tools = createA2UITools();
    const tool = tools.find((t) => t.name === 'a2ui_create_surface')!;
    const result = await tool.execute({ surfaceId: 'main', layout: 'vertical' });

    expect(result).toContain('main');
    expect(result).toContain('vertical');
  });

  it('a2ui_create_surface should work without layout', async () => {
    const { createA2UITools } = await import('../../../../src/tools/a2ui/create-a2ui-tools.js');

    const tools = createA2UITools();
    const tool = tools.find((t) => t.name === 'a2ui_create_surface')!;
    const result = await tool.execute({ surfaceId: 'bare' });

    expect(result).toBe('Surface created: "bare"');
  });

  it('a2ui_update_components should return plural for multiple operations', async () => {
    const { createA2UITools } = await import('../../../../src/tools/a2ui/create-a2ui-tools.js');

    const tools = createA2UITools();
    const tool = tools.find((t) => t.name === 'a2ui_update_components')!;
    const args = {
      surfaceId: 'main',
      operations: [
        {
          op: 'insert' as const,
          parentId: 'root',
          component: { id: 'title', type: 'Text', properties: { text: 'Hello' } },
        },
        {
          op: 'insert' as const,
          parentId: 'root',
          component: { id: 'desc', type: 'Text', properties: { text: 'World' } },
        },
      ],
    };
    const result = await tool.execute(args);

    expect(result).toContain('main');
    expect(result).toContain('2 operations');
  });

  it('a2ui_update_components should return singular for single operation', async () => {
    const { createA2UITools } = await import('../../../../src/tools/a2ui/create-a2ui-tools.js');

    const tools = createA2UITools();
    const tool = tools.find((t) => t.name === 'a2ui_update_components')!;
    const result = await tool.execute({
      surfaceId: 'main',
      operations: [
        {
          op: 'insert' as const,
          parentId: 'root',
          component: { id: 'title', type: 'Text', properties: { text: 'Hello' } },
        },
      ],
    });

    expect(result).toContain('1 operation');
    expect(result).not.toContain('1 operations');
  });

  it('a2ui_update_data_model should return plural for multiple updates', async () => {
    const { createA2UITools } = await import('../../../../src/tools/a2ui/create-a2ui-tools.js');

    const tools = createA2UITools();
    const tool = tools.find((t) => t.name === 'a2ui_update_data_model')!;
    const result = await tool.execute({
      surfaceId: 'form',
      updates: [
        { path: '/form/name', value: '' },
        { path: '/form/email', value: '' },
      ],
    });

    expect(result).toContain('form');
    expect(result).toContain('2 updates');
  });

  it('a2ui_update_data_model should return singular for single update', async () => {
    const { createA2UITools } = await import('../../../../src/tools/a2ui/create-a2ui-tools.js');

    const tools = createA2UITools();
    const tool = tools.find((t) => t.name === 'a2ui_update_data_model')!;
    const result = await tool.execute({
      surfaceId: 'form',
      updates: [{ path: '/form/name', value: '' }],
    });

    expect(result).toContain('1 update');
    expect(result).not.toContain('1 updates');
  });

  it('a2ui_delete_surface should return success', async () => {
    const { createA2UITools } = await import('../../../../src/tools/a2ui/create-a2ui-tools.js');

    const tools = createA2UITools();
    const tool = tools.find((t) => t.name === 'a2ui_delete_surface')!;
    const result = await tool.execute({ surfaceId: 'main' });

    expect(result).toContain('main');
  });

  it('each tool should have name, description, and parameters', async () => {
    const { createA2UITools } = await import('../../../../src/tools/a2ui/create-a2ui-tools.js');

    const tools = createA2UITools();
    for (const tool of tools) {
      expect(tool.name).toEqual(expect.any(String));
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.parameters).toBeDefined();
    }
  });
});
