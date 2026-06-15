// packages/wrangler-devtool/src/config.ts
// Configuration loader — reads wrangler.yaml or ~/.agentskillmania/wrangler/config.yaml

import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type { LLMQuickInit, LLMProviderEntry } from '@agentskillmania/colts';
import yaml from 'js-yaml';

export type LLMConfig = LLMQuickInit;

export interface DevToolConfig {
  llm?: LLMConfig;
  maxSteps?: number;
  requestTimeout?: number;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
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

/**
 * Convert legacy flat LLM config to the new multi-provider shape.
 *
 * Legacy shape:
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
function normalizeLegacyLlmConfig(llm: unknown): LLMConfig | undefined {
  if (!llm || typeof llm !== 'object') return undefined;

  const quick = llm as LLMConfig;
  if (Array.isArray(quick.providers) && quick.providers.length > 0) {
    return quick;
  }

  const flat = llm as Record<string, unknown>;
  if (
    typeof flat.provider !== 'string' ||
    flat.provider.length === 0 ||
    typeof flat.apiKey !== 'string'
  ) {
    return undefined;
  }

  const provider = {
    name: flat.provider,
    apiKey: flat.apiKey,
  } as LLMProviderEntry;

  if (typeof flat.baseUrl === 'string' && flat.baseUrl.length > 0) {
    provider.baseUrl = flat.baseUrl;
  }

  const maxConcurrency = pickOptionalNumber(flat, 'maxConcurrency');
  if (maxConcurrency !== undefined) {
    provider.maxConcurrency = maxConcurrency;
  }

  const modelId = typeof flat.model === 'string' && flat.model.length > 0 ? flat.model : 'gpt-4o';
  const model: LLMProviderEntry['models'][number] = { modelId };

  if (maxConcurrency !== undefined) {
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
      const llmRaw = normalizeLegacyLlmConfig(config.llm);
      if (llmRaw && isValidLLMConfig(llmRaw)) {
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
