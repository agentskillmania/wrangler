import { homedir } from 'node:os';
import { join } from 'node:path';

/** Base directory for all skill-studio application data */
export const APP_DIR = join(homedir(), '.agentskillmania', 'skill-studio');

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

/** PID file for CLI daemon management */
export const PID_PATH = join(APP_DIR, 'daemon.pid');
