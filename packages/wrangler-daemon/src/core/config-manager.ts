import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type { LLMProviderEntry, LLMQuickInit } from '@agentskillmania/colts';
import { Settings } from '@agentskillmania/settings-yaml';

import type { DaemonConfig } from '../types.js';

/** Default config as YAML string for settings-yaml initialization */
const DEFAULT_YAML = `llm:
  providers:
    - name: openai
      apiKey: ''
      models:
        - modelId: deepseek-chat
server:
  port: 3100
  host: localhost
`;

function pickOptionalNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const val = obj[key];
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Convert legacy flat LLM config to the new multi-provider shape.
 *
 * Legacy shape:
 *   llm:
 *     baseUrl: ...
 *     apiKey: sk-xxx
 *     model: deepseek-chat
 *     contextWindow: 128000
 *     maxTokens: 4096
 *     reasoning: true
 */
function normalizeLlmConfig(llm: unknown): LLMQuickInit | undefined {
  if (!llm || typeof llm !== 'object') return undefined;

  const flat = llm as Record<string, unknown>;

  // Legacy flat config (apiKey at top level) takes precedence. This handles
  // settings-yaml deep-merging a default `providers` array on top of an old
  // config that only had `apiKey`/`model` keys.
  if (typeof flat.apiKey === 'string') {
    const provider = {
      name: 'openai',
      apiKey: flat.apiKey,
    } as LLMProviderEntry;

    if (typeof flat.baseUrl === 'string' && flat.baseUrl.length > 0) {
      provider.baseUrl = flat.baseUrl;
    }

    const modelId =
      typeof flat.model === 'string' && flat.model.length > 0 ? flat.model : 'deepseek-chat';
    const model: LLMProviderEntry['models'][number] = { modelId };

    const maxConcurrency = pickOptionalNumber(flat, 'maxConcurrency');
    if (maxConcurrency !== undefined) {
      provider.maxConcurrency = maxConcurrency;
      model.maxConcurrency = maxConcurrency;
    }
    const contextWindow = pickOptionalNumber(flat, 'contextWindow');
    if (contextWindow !== undefined) {
      model.contextWindow = contextWindow;
    }
    const maxTokens = pickOptionalNumber(flat, 'maxTokens');
    if (maxTokens !== undefined) {
      model.maxTokens = maxTokens;
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
 * Manages daemon configuration via settings-yaml.
 *
 * Config file is created with defaults on first init. Subsequent loads
 * deep-merge user values over defaults.
 */
export class ConfigManager {
  private settings: Settings<DaemonConfig> | null = null;
  private readonly configPath: string;

  constructor(configPath: string) {
    this.configPath = resolve(configPath);
  }

  /** Load or create config file with defaults */
  async init(): Promise<void> {
    this.settings = new Settings<DaemonConfig>(this.configPath);
    await this.settings.initialize({ defaultYaml: DEFAULT_YAML });
  }

  /** Get current config values (frozen object) */
  get(): DaemonConfig {
    if (!this.settings) throw new Error('ConfigManager not initialized');
    const values = this.settings.getValues();
    const llm = normalizeLlmConfig(values.llm) ?? values.llm;
    return { ...values, llm } as DaemonConfig;
  }

  /** Update partial config and persist to disk */
  async update(partial: Partial<DaemonConfig>): Promise<void> {
    if (!this.settings) throw new Error('ConfigManager not initialized');

    for (const [key, value] of Object.entries(partial)) {
      if (typeof value === 'object' && value !== null) {
        for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
          this.settings.set(`${key}.${subKey}`, subValue);
        }
      } else {
        this.settings.set(key, value);
      }
    }
    await this.settings.save();
  }

  /** Read arbitrary config file content */
  async getConfigFile(path: string): Promise<string> {
    return readFile(resolve(path), 'utf-8');
  }

  /** Write content to arbitrary config file */
  async setConfigFile(path: string, content: string): Promise<void> {
    const resolved = resolve(path);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, content, 'utf-8');
  }
}
