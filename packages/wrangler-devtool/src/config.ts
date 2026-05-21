// packages/wrangler-devtool/src/config.ts
// Configuration loader — reads wrangler.yaml or ~/.agentskillmania/wrangler/config.yaml

import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';

export interface LLMConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  thinkingEnabled?: boolean;
  enablePromptThinking?: boolean;
  maxConcurrency?: number;
}

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

function isValidLLMConfig(obj: unknown): obj is LLMConfig {
  if (typeof obj !== 'object' || obj === null) return false;
  const c = obj as Record<string, unknown>;
  return (
    typeof c.provider === 'string' &&
    c.provider.length > 0 &&
    typeof c.apiKey === 'string' &&
    c.apiKey.length > 0 &&
    typeof c.model === 'string' &&
    c.model.length > 0
  );
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

/**
 * Load devtool configuration from wrangler.yaml or fallback config.
 *
 * Searches in this order:
 * 1. <cwd>/wrangler.yaml
 * 2. ~/.agentskillmania/wrangler/config.yaml
 *
 * @param cwd - Optional working directory to search first
 * @param extraPaths - Additional paths to search (used for testing)
 */
export async function loadConfig(
  cwd?: string,
  extraPaths?: string[]
): Promise<DevToolConfig | null> {
  const searchPaths: string[] = [];

  if (cwd) {
    searchPaths.push(resolve(cwd, 'wrangler.yaml'));
  }
  searchPaths.push(resolve(process.cwd(), 'wrangler.yaml'));
  searchPaths.push(join(homedir(), '.agentskillmania', 'wrangler', 'config.yaml'));

  if (extraPaths) {
    searchPaths.push(...extraPaths);
  }

  for (const path of searchPaths) {
    const raw = await readYamlConfig(path);
    if (raw && typeof raw === 'object' && 'llm' in raw) {
      const config = raw as Record<string, unknown>;
      const llmRaw = config.llm;
      if (isValidLLMConfig(llmRaw)) {
        const result: DevToolConfig = { llm: llmRaw };
        if (typeof llmRaw.baseUrl === 'string' && llmRaw.baseUrl.length > 0) {
          result.llm!.baseUrl = llmRaw.baseUrl;
        }
        if (typeof llmRaw.thinkingEnabled === 'boolean') {
          result.llm!.thinkingEnabled = llmRaw.thinkingEnabled;
        }
        if (typeof llmRaw.enablePromptThinking === 'boolean') {
          result.llm!.enablePromptThinking = llmRaw.enablePromptThinking;
        }
        if (typeof llmRaw.maxConcurrency === 'number') {
          result.llm!.maxConcurrency = llmRaw.maxConcurrency;
        }
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
      'No valid LLM configuration found. Create wrangler.yaml or ~/.agentskillmania/wrangler/config.yaml with llm.provider, llm.apiKey, and llm.model.'
    );
  }
  return config.llm;
}
