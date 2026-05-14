import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectMode } from '../../src/detect-mode.js';

describe('detectMode', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `wrangler-cli-detect-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('detects agent mode when AGENT.md exists', async () => {
    await writeFile(join(testDir, 'AGENT.md'), '---\nname: test\n---\nHello');
    const result = await detectMode(testDir);
    expect(result).toEqual({ mode: 'agent', agentDir: testDir });
  });

  it('detects crew mode when crew.yaml exists', async () => {
    await writeFile(join(testDir, 'crew.yaml'), 'name: test-crew');
    const result = await detectMode(testDir);
    expect(result).toEqual({ mode: 'crew', crewDir: testDir });
  });

  it('detects crew mode when CREW.md exists', async () => {
    await writeFile(join(testDir, 'CREW.md'), '# Test Crew');
    const result = await detectMode(testDir);
    expect(result).toEqual({ mode: 'crew', crewDir: testDir });
  });

  it('prefers agent mode over crew mode when both exist', async () => {
    await writeFile(join(testDir, 'AGENT.md'), '---\nname: test\n---\nHello');
    await writeFile(join(testDir, 'crew.yaml'), 'name: test-crew');
    const result = await detectMode(testDir);
    expect(result).toEqual({ mode: 'agent', agentDir: testDir });
  });

  it('returns bare mode when directory is empty', async () => {
    const result = await detectMode(testDir);
    expect(result).toEqual({ mode: 'bare', dir: testDir });
  });

  it('returns bare mode for unrecognized files', async () => {
    await writeFile(join(testDir, 'random.txt'), 'stuff');
    const result = await detectMode(testDir);
    expect(result).toEqual({ mode: 'bare', dir: testDir });
  });
});
