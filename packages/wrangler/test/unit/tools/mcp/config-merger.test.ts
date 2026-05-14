import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { discoverGlobalConfigPath } from '../../../../src/tools/mcp/config-merger.js';

describe('config-merger', () => {
  describe('discoverGlobalConfigPath', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      originalEnv = process.env;
      process.env = {};
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('returns explicit path if provided', () => {
      const explicitPath = '/custom/path/config.json';
      const result = discoverGlobalConfigPath(explicitPath);
      expect(result).toBe(explicitPath);
    });

    it('returns path from MCPORTER_CONFIG env var if no explicit path', () => {
      process.env.MCPORTER_CONFIG = '/env/config/path.json';
      const result = discoverGlobalConfigPath();
      expect(result).toBe('/env/config/path.json');
    });

    it('explicit path takes precedence over env var', () => {
      process.env.MCPORTER_CONFIG = '/env/config/path.json';
      const explicitPath = '/explicit/path/config.json';
      const result = discoverGlobalConfigPath(explicitPath);
      expect(result).toBe(explicitPath);
    });

    it('returns default path when no explicit path or env var', () => {
      const result = discoverGlobalConfigPath();
      expect(result).toBe(join(homedir(), '.mcporter', 'mcporter.json'));
    });

    it('handles empty MCPORTER_CONFIG env var', () => {
      process.env.MCPORTER_CONFIG = '';
      const result = discoverGlobalConfigPath();
      expect(result).toBe(join(homedir(), '.mcporter', 'mcporter.json'));
    });

    it('handles whitespace-only MCPORTER_CONFIG env var', () => {
      process.env.MCPORTER_CONFIG = '   ';
      const result = discoverGlobalConfigPath();
      expect(result).toBe(join(homedir(), '.mcporter', 'mcporter.json'));
    });
  });
});
