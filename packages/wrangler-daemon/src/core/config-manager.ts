import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Settings } from '@agentskillmania/settings-yaml';
import type { LLMProviderEntry } from '@agentskillmania/wrangler';
import { parse as parseYaml } from 'yaml';

import type { DaemonConfig } from '../types.js';

/**
 * config.yaml model entry (mirrors Rust `ModelYaml`, config.rs).
 *
 * Structurally identical to the llm-client `ModelEntry` the daemon forwards;
 * declared here so the config → registration mapping is explicit and
 * documented rather than relying on the index signature. `input` is the
 * multimodal declaration (e.g. `['text', 'image']`), keyed to match
 * llm-client's `ModelMeta.input`.
 */
export interface ModelYaml {
  modelId: string;
  maxConcurrency?: number;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  /**
   * Supported input modalities (e.g. `[text, image]`); absent = text-only
   * model (the multimodal gate rejects image requests).
   */
  input?: string[];
}

/**
 * Map daemon config → runner provider entries (mirrors Rust
 * `providers_for_runner`, config.rs).
 *
 * Model metadata is forwarded verbatim into the registration constraint —
 * notably `input`: before Rust 9abd9d2 the daemon hard-coded `input: None`,
 * so config.yaml could not declare a multimodal model and the gate rejected
 * image requests even for vision models. The TS config type already carries
 * the field through, but this explicit seam pins the pass-through (and its
 * absence semantics) under test: an undeclared `input` stays `undefined`
 * (the adapter then defaults to `['text']`) — never a hard-coded value.
 */
export function providersForRunner(cfg: DaemonConfig): LLMProviderEntry[] {
  return cfg.llm.providers.map((provider) => ({
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    maxConcurrency: provider.maxConcurrency,
    models: provider.models.map((model: ModelYaml) => ({
      modelId: model.modelId,
      maxConcurrency: model.maxConcurrency,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      reasoning: model.reasoning,
      input: model.input,
    })),
  }));
}

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
