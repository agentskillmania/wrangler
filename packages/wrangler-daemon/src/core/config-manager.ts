import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Settings } from '@agentskillmania/settings-yaml';
import { parse as parseYaml } from 'yaml';

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

/**
 * Detect deprecated flat LLM config keys.
 *
 * settings-yaml may deep-merge default `providers` over an old flat config,
 * silently hiding the legacy values. We fail fast instead.
 */
function hasLegacyFlatLlmKeys(llm: unknown): boolean {
  if (!llm || typeof llm !== 'object') return false;
  const l = llm as Record<string, unknown>;
  return (
    typeof l.provider === 'string' ||
    typeof l.apiKey === 'string' ||
    typeof l.model === 'string' ||
    typeof l.baseUrl === 'string'
  );
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
    if (hasLegacyFlatLlmKeys(values.llm)) {
      throw new Error(
        'Daemon config uses the deprecated flat LLM format. ' +
          'Migrate to llm.providers (name, apiKey, models) or recreate the config file.'
      );
    }
    return values;
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

  /**
   * Read the daemon config file raw content.
   * Always reads from the resolved configPath — never accepts an arbitrary path.
   */
  async getConfigFileRaw(): Promise<string> {
    return readFile(this.configPath, 'utf-8');
  }

  /**
   * Overwrite the daemon config file raw content.
   * Always writes to the resolved configPath — never accepts an arbitrary path.
   * Validates the content as YAML before writing to avoid corrupting the config.
   */
  async setConfigFileRaw(content: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = parseYaml(content);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Invalid YAML: ${msg}`);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(
        'Config root must be a YAML mapping (object), got ' +
          (parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed)
      );
    }
    await writeFile(this.configPath, content, 'utf-8');
  }
}
