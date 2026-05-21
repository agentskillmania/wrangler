import { describe, it, expect } from 'vitest';
import { App } from '../../src/components/app.js';
import { detectMode } from '../../src/detect-mode.js';

describe('@agentskillmania/wrangler-cli exports', () => {
  it('App is a valid React component function', () => {
    expect(typeof App).toBe('function');
    // React components accept props object
    expect(App.length).toBe(1);
  });

  it('detectMode detects agent mode from AGENT.md', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const dir = mkdtempSync(join(tmpdir(), 'detect-mode-test-'));
    writeFileSync(join(dir, 'AGENT.md'), '---\nname: test\n---\n');

    const mode = await detectMode(dir);
    expect(mode.mode).toBe('agent');
    expect(mode.agentDir).toBe(dir);

    rmSync(dir, { recursive: true, force: true });
  });

  it('detectMode detects crew mode from CREW.md', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const dir = mkdtempSync(join(tmpdir(), 'detect-mode-test-'));
    writeFileSync(join(dir, 'CREW.md'), '---\nname: crew\n---\n');

    const mode = await detectMode(dir);
    expect(mode.mode).toBe('crew');

    rmSync(dir, { recursive: true, force: true });
  });
});
