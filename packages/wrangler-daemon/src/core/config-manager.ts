import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Settings } from '@agentskillmania/settings-yaml';
import type { DaemonConfig } from '../types.js';

/** Default config as YAML string for settings-yaml initialization */
const DEFAULT_YAML = `llm:
  baseUrl: ''
  apiKey: ''
  model: deepseek-chat
server:
  port: 3100
  host: localhost
`;

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
    return this.settings.getValues();
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
