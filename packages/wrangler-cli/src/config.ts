/**
 * @fileoverview Configuration management — reads/writes CLI config using settings-yaml
 *
 * Config file search order: ./wrangler.yaml → ~/.agentskillmania/wrangler/config.yaml
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { LLMProviderEntry, LLMQuickInit } from '@agentskillmania/colts';
import { Settings } from '@agentskillmania/settings-yaml';

/** Default configuration directory */
const CONFIG_DIR = path.join(os.homedir(), '.agentskillmania', 'wrangler');
const CONFIG_FILE = 'config.yaml';

const DEFAULT_MODEL = 'gpt-4o';

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
 * Convert legacy flat LLM config to the new multi-provider shape.
 *
 * Supports old files that used:
 *   llm:
 *     provider: openai
 *     apiKey: sk-xxx
 *     model: gpt-4o
 *     baseUrl: ...
 *     maxConcurrency: 5
 *     contextWindow: 128000
 *     maxTokens: 4096
 *     reasoning: true
 */
function normalizeLlmConfig(llm: unknown): LLMQuickInit | undefined {
  if (!llm || typeof llm !== 'object') return undefined;

  const flat = llm as Record<string, unknown>;

  // Legacy flat config always takes precedence. This also handles the case
  // where settings-yaml deep-merged a default `providers` array into an old
  // flat config that only had `provider`/`apiKey` keys.
  if (
    typeof flat.provider === 'string' &&
    flat.provider.length > 0 &&
    typeof flat.apiKey === 'string'
  ) {
    const provider = {
      name: flat.provider,
      apiKey: flat.apiKey,
    } as LLMProviderEntry;

    if (typeof flat.baseUrl === 'string' && flat.baseUrl.length > 0) {
      provider.baseUrl = flat.baseUrl;
    }
    if (typeof flat.maxConcurrency === 'number') {
      provider.maxConcurrency = flat.maxConcurrency;
    }

    const modelId =
      typeof flat.model === 'string' && flat.model.length > 0 ? flat.model : DEFAULT_MODEL;
    const model: LLMProviderEntry['models'][number] = { modelId };

    if (typeof flat.maxConcurrency === 'number') {
      model.maxConcurrency = flat.maxConcurrency;
    }
    if (typeof flat.contextWindow === 'number') {
      model.contextWindow = flat.contextWindow;
    }
    if (typeof flat.maxTokens === 'number') {
      model.maxTokens = flat.maxTokens;
    }
    if (typeof flat.reasoning === 'boolean') {
      model.reasoning = flat.reasoning;
    }

    provider.models = [model];
    return { providers: [provider] };
  }

  const quick = llm as LLMQuickInit;
  if (Array.isArray(quick.providers) && quick.providers.length > 0) {
    return quick;
  }

  return undefined;
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

    const llm = normalizeLlmConfig(config.llm) ?? config.llm;
    if (!isValidConfig({ ...config, llm })) {
      return { hasValidConfig: false, configPath };
    }

    return {
      hasValidConfig: true,
      configPath,
      llm,
      maxSteps: config.maxSteps,
      requestTimeout: config.requestTimeout ?? 1800000,
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
