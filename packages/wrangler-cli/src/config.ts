/**
 * @fileoverview Configuration management — reads/writes CLI config using settings-yaml
 *
 * Config file search order: ./wrangler.yaml → ~/.agentskillmania/wrangler/config.yaml
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Settings } from '@agentskillmania/settings-yaml';

/** Default configuration directory */
const CONFIG_DIR = path.join(os.homedir(), '.agentskillmania', 'wrangler');
const CONFIG_FILE = 'config.yaml';

/**
 * wrangler.yaml configuration structure
 */
export interface WranglerConfig extends Record<string, unknown> {
  /** LLM provider settings */
  llm?: {
    /** Provider name (e.g., openai) */
    provider?: string;
    /** API key for the provider */
    apiKey?: string;
    /** Model identifier */
    model?: string;
    /** Custom base URL for the provider API */
    baseUrl?: string;
  };
}

/**
 * Application configuration (validated structure)
 */
export interface AppConfig {
  /** Whether the configuration is valid (provider + apiKey) */
  hasValidConfig: boolean;
  /** Configuration file path */
  configPath?: string;
  /** LLM configuration */
  llm?: {
    provider: string;
    apiKey: string;
    model: string;
    baseUrl?: string;
  };
}

/** Default configuration YAML */
const DEFAULT_CONFIG_YAML = `llm:
  provider: openai
  model: gpt-4o

`;

/**
 * Configuration loading options
 */
export interface LoadConfigOptions {
  /** Override global config directory (for testing) */
  globalDir?: string;
}

/**
 * Find configuration file path
 *
 * Search order: ./wrangler.yaml -> {globalDir}/config.yaml
 *
 * @param globalDir - Global config directory
 * @returns Config file path, or null if not found
 */
async function findConfigPath(globalDir?: string): Promise<string | null> {
  const localPath = path.resolve('wrangler.yaml');
  try {
    await fs.access(localPath);
    return localPath;
  } catch {
    // Local config does not exist
  }

  const dir = globalDir ?? CONFIG_DIR;
  const globalPath = path.join(dir, CONFIG_FILE);
  try {
    await fs.access(globalPath);
    return globalPath;
  } catch {
    // Global config does not exist
  }

  return null;
}

/**
 * Get global config file path
 *
 * @param globalDir - Optional override for the global config directory
 * @returns Absolute path to the global config file
 */
function getGlobalConfigPath(globalDir?: string): string {
  return path.join(globalDir ?? CONFIG_DIR, CONFIG_FILE);
}

/**
 * Check if configuration contains required LLM settings
 *
 * @param config - Raw configuration object
 * @returns True if both provider and apiKey are present
 */
function isValidConfig(config: WranglerConfig): boolean {
  return !!(config.llm?.apiKey && config.llm?.provider);
}

/**
 * Load configuration
 *
 * Search order: ./wrangler.yaml -> {globalDir}/config.yaml
 * If neither is found, creates a default config via Settings.initialize().
 *
 * @param options - Loading options
 */
export async function loadConfig(options?: LoadConfigOptions): Promise<AppConfig> {
  let configPath = await findConfigPath(options?.globalDir);
  if (!configPath) {
    configPath = getGlobalConfigPath(options?.globalDir);
  }

  try {
    const settings = new Settings<WranglerConfig>(configPath);
    await settings.initialize({ defaultYaml: DEFAULT_CONFIG_YAML });
    const config = settings.getValues();

    if (!isValidConfig(config)) {
      return { hasValidConfig: false, configPath };
    }

    return {
      hasValidConfig: true,
      configPath,
      llm: {
        provider: config.llm!.provider!,
        apiKey: config.llm!.apiKey!,
        model: config.llm!.model ?? 'gpt-4o',
        baseUrl: config.llm!.baseUrl,
      },
    };
  } catch {
    return { hasValidConfig: false, configPath };
  }
}

/**
 * Save a configuration value
 *
 * Uses the Settings class to read/write config. Auto-creates the config file.
 *
 * @param keyPath - Dot-separated config key path (e.g. "llm.provider")
 * @param value - Configuration value
 * @param options - Save options
 */
export async function saveConfig(
  keyPath: string,
  value: string,
  options?: { globalDir?: string }
): Promise<void> {
  const configPath = getGlobalConfigPath(options?.globalDir);
  const settings = new Settings<WranglerConfig>(configPath);
  await settings.initialize({ defaultYaml: DEFAULT_CONFIG_YAML });
  settings.set(keyPath, value);
  await settings.save();
}

/**
 * First-time configuration wizard save
 *
 * Writes provider, apiKey, and model to the config file.
 *
 * @param setup - Configuration collected by the wizard
 * @param options - Save options
 */
export async function saveSetup(
  setup: { provider: string; apiKey: string; model: string },
  options?: { globalDir?: string }
): Promise<void> {
  const configPath = getGlobalConfigPath(options?.globalDir);
  await fs.mkdir(path.dirname(configPath), { recursive: true });

  const settings = new Settings<WranglerConfig>(configPath);
  await settings.initialize({ defaultYaml: DEFAULT_CONFIG_YAML });
  settings.set('llm.provider', setup.provider);
  settings.set('llm.apiKey', setup.apiKey);
  settings.set('llm.model', setup.model);
  await settings.save();
}

/**
 * Set a nested value via a dot-separated path
 *
 * @param obj - Target object
 * @param keyPath - Dot-separated key path
 * @param value - Value to set
 */
export function setNestedValue(obj: Record<string, unknown>, keyPath: string, value: string): void {
  const keys = keyPath.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  current[keys[keys.length - 1]] = value;
}
