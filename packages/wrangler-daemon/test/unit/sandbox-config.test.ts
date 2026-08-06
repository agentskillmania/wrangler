import { describe, it, expect } from 'vitest';
import { mergeSandboxConfig } from '../../src/core/agent-session.js';

describe('mergeSandboxConfig — daemon config.yaml defaults ← request body', () => {
  it('defaults to enabled=true with no sources', () => {
    const cfg = mergeSandboxConfig(undefined, undefined);
    expect(cfg.enabled).toBe(true);
  });

  it('request top-level boolean overrides daemon config.yaml', () => {
    const cfg = mergeSandboxConfig({ enabled: true }, false);
    expect(cfg.enabled).toBe(false);
  });

  it('request object fields merge over daemon defaults field-by-field', () => {
    const cfg = mergeSandboxConfig(
      { enabled: true, timeout: 600_000, allowNetwork: false },
      { timeout: 30_000 }
    );
    expect(cfg.timeout).toBe(30_000);
    expect(cfg.allowNetwork).toBe(false); // unset request field falls back
    expect(cfg.enabled).toBe(true);
  });

  it('request object enabled overrides daemon config.yaml', () => {
    const cfg = mergeSandboxConfig({ enabled: true }, { enabled: false });
    expect(cfg.enabled).toBe(false);
  });

  it('request boolean override is honored over request object absence', () => {
    const cfg = mergeSandboxConfig({ timeout: 1000 }, true);
    expect(cfg.enabled).toBe(true);
    expect(cfg.timeout).toBe(1000);
  });
});
