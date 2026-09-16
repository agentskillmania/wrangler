/**
 * read_skill_resource — failure self-heal + guard wording.
 * On a bad resource path the error message must list the skill's ACTUAL
 * resource inventory so the model can self-correct in one shot; the tool
 * description must tell the model to use exact inventory paths and not
 * construct its own. (R2P-114w, aligned with Rust c78cfcc.)
 */
import { describe, it, expect, vi } from 'vitest';
import type { ZodObject, ZodRawShape } from 'zod';

import { createReadResourceTool } from '../../../../src/tools/skill/read-resource.js';
import type { ISkillProvider } from '@agentskillmania/colts';

function makeProvider(manifest: Record<string, unknown> | null): ISkillProvider {
  return {
    getManifest: vi.fn().mockResolvedValue(manifest),
    loadInstructions: vi.fn().mockResolvedValue('body'),
    loadResource: vi.fn(),
    listSkills: vi.fn().mockResolvedValue([
      { name: 'demo', description: 'Demo', source: '/skills/demo' },
      { name: 'other', description: 'Other', source: '/skills/other' },
    ]),
    refresh: vi.fn().mockResolvedValue(undefined),
  } as unknown as ISkillProvider;
}

describe('createReadResourceTool', () => {
  it('has the inventory guard wording in its description and parameter', () => {
    const tool = createReadResourceTool(makeProvider(null));
    expect(tool.description).toContain('exact relative path from the file inventory');
    expect(tool.description).toContain('Do not construct or guess paths');
    expect(tool.description).toContain('the error lists what is actually available');
    const schema = tool.parameters as unknown as ZodObject<ZodRawShape>;
    expect(String(schema.shape.resource_path?.description)).toContain(
      "skill's file inventory (returned by load_skill)"
    );
    expect(String(schema.shape.resource_path?.description)).toContain('Do not guess');
  });

  it('returns the resource content on success', async () => {
    const provider = makeProvider({
      name: 'demo',
      description: 'Demo',
      source: '/skills/demo',
      resources: ['reference/catalog.md'],
      scripts: ['run.js'],
    });
    (provider.loadResource as ReturnType<typeof vi.fn>).mockResolvedValue('catalog content');
    const tool = createReadResourceTool(provider);
    await expect(
      tool.execute({ skill_name: 'demo', resource_path: 'reference/catalog.md' })
    ).resolves.toBe('catalog content');
  });

  it('lists available skills when the skill is unknown', async () => {
    const tool = createReadResourceTool(makeProvider(null));
    const result = await tool.execute({ skill_name: 'nope', resource_path: 'x.md' });
    expect(result).toBe("Skill 'nope' not found. Available: demo, other");
  });

  it('appends the actual resource inventory to the error on a failed read (self-heal)', async () => {
    const provider = makeProvider({
      name: 'demo',
      description: 'Demo',
      source: '/skills/demo',
      resources: ['reference/catalog.md', 'reference/deep/data.json'],
      scripts: ['run.js'],
    });
    (provider.loadResource as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Resource not found: demo/reference.md')
    );
    const tool = createReadResourceTool(provider);
    const result = await tool.execute({ skill_name: 'demo', resource_path: 'reference.md' });
    expect(result).toBe(
      "Resource not found: demo/reference.md. Available resources in skill 'demo': " +
        'reference/catalog.md, reference/deep/data.json'
    );
  });

  it('rethrows the original error when the skill has no resource inventory', async () => {
    const provider = makeProvider({
      name: 'demo',
      description: 'Demo',
      source: '/skills/demo',
    });
    (provider.loadResource as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Failed to load resource for skill: demo')
    );
    const tool = createReadResourceTool(provider);
    await expect(tool.execute({ skill_name: 'demo', resource_path: 'x.md' })).rejects.toThrow(
      'Failed to load resource for skill: demo'
    );
  });
});
