import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Discovers the global mcporter config path.
 * Priority: explicitPath > MCPORTER_CONFIG env var > default path
 *
 * @param explicitPath - Explicitly provided config path (optional)
 * @returns Absolute path to the global mcporter config file
 */
export function discoverGlobalConfigPath(explicitPath?: string): string {
  if (explicitPath) {
    return explicitPath;
  }

  const envPath = process.env.MCPORTER_CONFIG;
  if (envPath && envPath.trim() !== '') {
    return envPath;
  }

  // Default path: ~/.mcporter/mcporter.json
  return join(homedir(), '.mcporter', 'mcporter.json');
}
