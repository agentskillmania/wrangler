import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Base directory for all skill-studio application data.
 *
 * Overridable via the `AGENTSKILLMANIA_APP_DIR` environment variable (used by
 * tests and portable deployments); defaults to `~/.agentskillmania/skill-studio`.
 */
export const APP_DIR = process.env.AGENTSKILLMANIA_APP_DIR
  ? join(process.env.AGENTSKILLMANIA_APP_DIR)
  : join(homedir(), '.agentskillmania', 'skill-studio');

/** Path to the daemon config file */
export const CONFIG_PATH = join(APP_DIR, 'config.yaml');

/** Directory for user-defined agents */
export const AGENTS_DIR = join(APP_DIR, 'agents');

/** Directory for user-defined skills */
export const SKILLS_DIR = join(APP_DIR, 'skills');

/** Directory for user-defined crews */
export const CREWS_DIR = join(APP_DIR, 'crews');

/** Directory for session persistence */
export const SESSIONS_DIR = join(APP_DIR, 'sessions');

/** Directory for spec/plan documents ({root}/spec-plan/specs + /plans) */
export const SPEC_PLAN_DIR = join(APP_DIR, 'spec-plan');

/** PID file for CLI daemon management */
export const PID_PATH = join(APP_DIR, 'daemon.pid');
