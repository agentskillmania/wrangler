import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { App } from '../../src/components/app.js';
import { detectMode } from '../../src/detect-mode.js';

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useApp: () => ({ exit: vi.fn() }),
  };
});

vi.mock('../../src/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config.js')>();
  return {
    ...actual,
    saveSetup: vi.fn().mockResolvedValue(undefined),
    loadConfig: vi.fn().mockResolvedValue({ hasValidConfig: false }),
  };
});

describe('@agentskillmania/wrangler-cli exports', () => {
  it('App renders setup wizard when config is invalid', () => {
    const { lastFrame } = render(
      React.createElement(App, {
        config: { hasValidConfig: false },
        mode: { mode: 'bare', dir: '/tmp' },
        dir: '/tmp',
      })
    );
    expect(lastFrame()).toContain('wrangler Setup');
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
