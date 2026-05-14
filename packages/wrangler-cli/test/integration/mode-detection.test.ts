/**
 * US1: Mode detection from directory
 *
 * As a developer, I use detectMode(dir) to auto-detect whether a directory
 * contains an agent (AGENT.md), a crew (crew.yaml / CREW.md), or neither (bare).
 *
 * These are pure filesystem tests — no LLM calls needed, always run.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectMode } from '../../src/detect-mode.js';

describe('US1: Mode detection from directory', () => {
  let testBaseDir: string;

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `wrangler-cli-intg-mode-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true });
  });

  it('returns bare mode for empty directory', async () => {
    const result = await detectMode(testBaseDir);
    expect(result.mode).toBe('bare');
    if (result.mode === 'bare') {
      expect(result.dir).toBe(testBaseDir);
    }
  });

  it('returns agent mode when AGENT.md exists', async () => {
    await writeFile(join(testBaseDir, 'AGENT.md'), '---\nname: test\n---\nDo things.');
    const result = await detectMode(testBaseDir);
    expect(result.mode).toBe('agent');
    if (result.mode === 'agent') {
      expect(result.agentDir).toBe(testBaseDir);
    }
  });

  it('returns crew mode when crew.yaml exists', async () => {
    await writeFile(join(testBaseDir, 'crew.yaml'), 'name: my-crew\nagents: []');
    const result = await detectMode(testBaseDir);
    expect(result.mode).toBe('crew');
    if (result.mode === 'crew') {
      expect(result.crewDir).toBe(testBaseDir);
    }
  });

  it('returns crew mode when CREW.md exists', async () => {
    await writeFile(join(testBaseDir, 'CREW.md'), '# Crew doc');
    const result = await detectMode(testBaseDir);
    expect(result.mode).toBe('crew');
    if (result.mode === 'crew') {
      expect(result.crewDir).toBe(testBaseDir);
    }
  });

  it('returns agent mode when both AGENT.md and crew.yaml exist (agent priority)', async () => {
    await writeFile(join(testBaseDir, 'AGENT.md'), '---\nname: test\n---\nDo things.');
    await writeFile(join(testBaseDir, 'crew.yaml'), 'name: my-crew\nagents: []');
    const result = await detectMode(testBaseDir);
    expect(result.mode).toBe('agent');
    if (result.mode === 'agent') {
      expect(result.agentDir).toBe(testBaseDir);
    }
  });

  it('returns bare mode for directory with unrelated files', async () => {
    await writeFile(join(testBaseDir, 'README.md'), '# Readme');
    await writeFile(join(testBaseDir, 'package.json'), '{}');
    const result = await detectMode(testBaseDir);
    expect(result.mode).toBe('bare');
  });
});
