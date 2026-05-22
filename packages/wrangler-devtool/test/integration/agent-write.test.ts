import { describe, expect } from 'vitest';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgentArchitect } from '../../src/agents/architect.js';
import { testConfig, itif } from './config.js';

describe('US2: Generate an agent with AI', () => {
  itif(testConfig.enabled)(
    'AC2.1: agent write generates complete AGENT.md',
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));

      const result = await runAgentArchitect(
        '你是一个简单的echo agent，只重复用户说的话',
        undefined,
        { cwd: tempDir }
      );

      expect(result.changes.length).toBeGreaterThan(0);
      expect(result.changes[0].file).toBe('AGENT.md');
      expect(result.changes[0].type).toBe('create');
      expect(result.changes[0].new).toContain('name:');
    },
    30000
  );

  itif(testConfig.enabled)(
    'AC2.4: agent write updates existing file with edit type',
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));

      // First create an agent
      const firstResult = await runAgentArchitect('你是一个简单的echo agent', undefined, {
        cwd: tempDir,
      });

      // Apply the change
      const { applyChanges } = await import('../../src/utils/file-change.js');
      await applyChanges(firstResult.changes, { cwd: tempDir });

      // Then update it
      const existing = await readFile(join(tempDir, 'AGENT.md'), 'utf-8');
      const secondResult = await runAgentArchitect('增加一个要求：回答要加上emoji', existing, {
        cwd: tempDir,
      });

      expect(secondResult.changes[0].type).toBe('edit');
      expect(secondResult.changes[0].old).toBeTruthy();
    },
    30000
  );
});
