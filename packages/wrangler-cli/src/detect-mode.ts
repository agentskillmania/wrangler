import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DetectedMode } from './types.js';

/**
 * Detects the working mode from directory contents.
 * Priority: AGENT.md > crew.yaml/CREW.md > bare.
 *
 * @param dir - Directory path to inspect
 * @returns Detected mode with relevant directory path
 */
export async function detectMode(dir: string): Promise<DetectedMode> {
  if (existsSync(join(dir, 'AGENT.md'))) {
    return { mode: 'agent', agentDir: dir };
  }
  if (existsSync(join(dir, 'crew.yaml')) || existsSync(join(dir, 'CREW.md'))) {
    return { mode: 'crew', crewDir: dir };
  }
  return { mode: 'bare', dir };
}
