import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  APP_DIR,
  CONFIG_PATH,
  AGENTS_DIR,
  SKILLS_DIR,
  CREWS_DIR,
  SESSIONS_DIR,
  PID_PATH,
} from '../../src/constants.js';

describe('constants', () => {
  it('exports APP_DIR as ~/.agentskillmania/skill-studio', () => {
    expect(APP_DIR).toBe(join(homedir(), '.agentskillmania', 'skill-studio'));
  });

  it('exports CONFIG_PATH under APP_DIR', () => {
    expect(CONFIG_PATH).toBe(join(APP_DIR, 'config.yaml'));
  });

  it('exports AGENTS_DIR under APP_DIR', () => {
    expect(AGENTS_DIR).toBe(join(APP_DIR, 'agents'));
  });

  it('exports SKILLS_DIR under APP_DIR', () => {
    expect(SKILLS_DIR).toBe(join(APP_DIR, 'skills'));
  });

  it('exports CREWS_DIR under APP_DIR', () => {
    expect(CREWS_DIR).toBe(join(APP_DIR, 'crews'));
  });

  it('exports SESSIONS_DIR under APP_DIR', () => {
    expect(SESSIONS_DIR).toBe(join(APP_DIR, 'sessions'));
  });

  it('exports PID_PATH under APP_DIR', () => {
    expect(PID_PATH).toBe(join(APP_DIR, 'daemon.pid'));
  });
});

it('honors AGENTSKILLMANIA_APP_DIR env override', async () => {
  vi.stubEnv('AGENTSKILLMANIA_APP_DIR', '/tmp/agentskillmania-test-root');
  vi.resetModules();
  const mod = await import('../../src/constants.js');
  expect(mod.APP_DIR).toBe('/tmp/agentskillmania-test-root');
  vi.unstubAllEnvs();
});
