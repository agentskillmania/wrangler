// packages/wrangler-devtool/src/config.ts
// Configuration loader — reads wrangler.yaml or ~/.agentskillmania/wrangler/config.yaml

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type { LLMQuickInit, LLMProviderEntry } from '@agentskillmania/colts';
import yaml from 'js-yaml';

import { fileExists } from './utils/fs.js';

export type LLMConfig = LLMQuickInit;

export interface DevToolConfig {
  llm?: LLMConfig;
  maxSteps?: number;
  requestTimeout?: number;
}

/**
 * Read and parse a YAML config file.
 */
async function readYamlConfig(filePath: string): Promise<unknown | null> {
  if (!(await fileExists(filePath))) {
    return null;
  }
  const content = await readFile(filePath, 'utf-8');
  try {
    return yaml.load(content);
  } catch {
    return null;
  }
}

function isValidProviderEntry(entry: unknown): entry is LLMProviderEntry {
  if (typeof entry !== 'object' || entry === null) return false;
  const p = entry as Record<string, unknown>;
  if (typeof p.name !== 'string' || p.name.length === 0) return false;
  if (typeof p.apiKey !== 'string') return false;
  if (!Array.isArray(p.models) || p.models.length === 0) return false;
  const firstModel = p.models[0];
  if (typeof firstModel !== 'object' || firstModel === null) return false;
  if (typeof (firstModel as Record<string, unknown>).modelId !== 'string') return false;
  return true;
}

function isValidLLMConfig(obj: unknown): obj is LLMConfig {
  if (typeof obj !== 'object' || obj === null) return false;
  const c = obj as Record<string, unknown>;
  if (!Array.isArray(c.providers) || c.providers.length === 0) return false;
  return c.providers.every(isValidProviderEntry);
}

function pickOptionalNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const val = obj[key];
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed)) return parsed;
  }
  return undefined;
}

export interface LoadConfigOptions {
  extraPaths?: string[];
  skipGlobal?: boolean;
}

/**
 * Load devtool configuration from wrangler.yaml or fallback config.
 *
 * Searches in this order:
 * 1. <cwd>/wrangler.yaml
 * 2. ~/.agentskillmania/wrangler/config.yaml (unless skipGlobal)
 * 3. extraPaths
 *
 * @param cwd - Optional working directory to search first
 * @param options - Loading options
 */
export async function loadConfig(
  cwd?: string,
  options?: LoadConfigOptions
): Promise<DevToolConfig | null> {
  const searchPaths: string[] = [];

  if (cwd) {
    searchPaths.push(resolve(cwd, 'wrangler.yaml'));
  }
  searchPaths.push(resolve(process.cwd(), 'wrangler.yaml'));

  if (!options?.skipGlobal) {
    searchPaths.push(join(homedir(), '.agentskillmania', 'wrangler', 'config.yaml'));
  }

  if (options?.extraPaths) {
    searchPaths.push(...options.extraPaths);
  }

  for (const path of searchPaths) {
    const raw = await readYamlConfig(path);
    if (raw && typeof raw === 'object' && 'llm' in raw) {
      const config = raw as Record<string, unknown>;
      const llmRaw = config.llm;
      if (isValidLLMConfig(llmRaw)) {
        const result: DevToolConfig = { llm: llmRaw };
        result.maxSteps = pickOptionalNumber(config, 'maxSteps');
        result.requestTimeout = pickOptionalNumber(config, 'requestTimeout');
        return result;
      }
    }
  }

  return null;
}

/**
 * Load LLM config or throw if missing.
 */
export async function requireLLMConfig(cwd?: string): Promise<LLMConfig> {
  const config = await loadConfig(cwd);
  if (!config?.llm) {
    throw new Error(
      'No valid LLM configuration found. Create wrangler.yaml or ~/.agentskillmania/wrangler/config.yaml with llm.providers containing name, apiKey, and models.'
    );
  }
  return config.llm;
}
