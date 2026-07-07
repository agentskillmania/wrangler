/**
 * @fileoverview Configuration management — reads/writes CLI config using settings-yaml
 *
 * Config file search order: ./wrangler.yaml → ~/.agentskillmania/wrangler/config.yaml
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { LLMQuickInit } from '@agentskillmania/colts';
import { Settings } from '@agentskillmania/settings-yaml';

/** Default configuration directory */
const CONFIG_DIR = path.join(os.homedir(), '.agentskillmania', 'wrangler');
const CONFIG_FILE = 'config.yaml';

/**
 * wrangler.yaml configuration structure
 */
export interface WranglerConfig extends Record<string, unknown> {
  /** LLM provider list (one apiKey per provider) */
  llm?: LLMQuickInit;
  /** Maximum number of agent steps per run */
  maxSteps?: number;
  /** Request timeout in milliseconds */
  requestTimeout?: number;
}

/**
 * Application configuration (validated structure)
 */
export interface AppConfig {
  /** Whether the configuration is valid (provider + apiKey) */
  hasValidConfig: boolean;
  /** Configuration file path */
  configPath?: string;
  /**
   * Error message when config loading/parsing failed (ERR7).
   * Distinguishes "config file is corrupted" (loadError set) from
   * "no config yet" (loadError undefined, hasValidConfig false).
   * Callers should check this before showing a setup wizard.
   */
  loadError?: string;
  /** LLM configuration */
  llm?: LLMQuickInit;
  /** Maximum number of agent steps per run */
  maxSteps?: number;
  /** Request timeout in milliseconds */
  requestTimeout?: number;
}

/** Default configuration YAML */
const DEFAULT_CONFIG_YAML = `llm:
  providers:
    - name: openai
      apiKey: ''
      models:
        - modelId: gpt-4o

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
export function getGlobalConfigPath(globalDir?: string): string {
  return path.join(globalDir ?? CONFIG_DIR, CONFIG_FILE);
}

/**
 * Check if configuration contains required LLM settings
 *
 * @param config - Raw configuration object
 * @returns True if both provider and apiKey are present
 */
function isValidConfig(config: WranglerConfig): boolean {
  const first = config.llm?.providers?.[0];
  return !!(first?.name && first?.apiKey && first?.models && first.models.length > 0);
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
      llm: config.llm,
      maxSteps: config.maxSteps,
      requestTimeout: config.requestTimeout ?? 1800000,
    };
  } catch (err) {
    // ERR7: distinguish "config file is corrupted" from "no config yet".
    // A parse/IO error means the user HAS a config but it's broken — surfacing
    // the error lets the caller show a repair message instead of the setup
    // wizard (which would confusingly ask them to configure from scratch).
    return {
      hasValidConfig: false,
      configPath,
      loadError: err instanceof Error ? err.message : String(err),
    };
  }
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
  setup: { provider: string; apiKey: string; model: string; baseUrl?: string },
  options?: { globalDir?: string }
): Promise<void> {
  const configPath = getGlobalConfigPath(options?.globalDir);
  await fs.mkdir(path.dirname(configPath), { recursive: true });

  const settings = new Settings<WranglerConfig>(configPath);
  await settings.initialize({ defaultYaml: DEFAULT_CONFIG_YAML });
  settings.set('llm', {
    providers: [
      {
        name: setup.provider,
        apiKey: setup.apiKey,
        baseUrl: setup.baseUrl,
        models: [{ modelId: setup.model }],
      },
    ],
  });
  await settings.save();
}
