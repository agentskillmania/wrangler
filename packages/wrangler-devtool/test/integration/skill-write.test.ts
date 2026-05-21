import { describe, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSkillDesigner } from '../../src/agents/skill-designer.js';
import { testConfig, itif } from './config.js';

describe('US7: Generate a skill with AI', () => {
  itif(testConfig.enabled)('AC7.1-AC7.2: skill write generates valid skill file', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));

    const result = await runSkillDesigner(
      '创建一个skill，用于处理用户的问候语，要友好热情',
      undefined,
      { cwd: tempDir }
    );

    expect(result.changes.length).toBeGreaterThan(0);
    const change = result.changes[0];
    expect(change.file).toMatch(/skills\/.*\.md$/);
    expect(change.new).toContain('name:');
    // Description may be in frontmatter or body, just verify it's a valid markdown file
    expect(change.new).toContain('---');
  }, 30000);
});
