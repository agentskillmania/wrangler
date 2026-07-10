/**
 * @fileoverview LLM configuration for eval — both the agent being evaluated
 * and the judge evaluator.
 *
 * Loads from the same environment variables as colts/wrangler integration tests:
 *   OPENAI_API_KEY, OPENAI_BASE_URL, PROVIDER (default 'openai'), MODEL
 * Falls back to wrangler.yaml / eval-config.yaml / global config if env not set.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

import type { LLMQuickInit } from '@agentskillmania/colts';

/** Result of loading LLM config. */
export interface EvalLlmConfig {
  /** LLM provider config (same shape as wrangler's llm field). */
  llm: LLMQuickInit;
}

export interface LoadEvalLlmConfigOptions {
  /** Project directory to search for YAML configs. */
  projectDir?: string;
  /** Override global config directory (testing). If omitted, uses ~/.agentskillmania/wrangler */
  globalDir?: string;
}

/**
 * Load LLM config from environment variables first (OPENAI_API_KEY etc.),
 * then fall back to YAML files.
 *
 * Search order:
 *   0. Environment variables (OPENAI_API_KEY + optional OPENAI_BASE_URL/PROVIDER/MODEL)
 *   1. projectDir/wrangler.yaml
 *   2. projectDir/eval-config.yaml
 *   3. globalDir/config.yaml (default: ~/.agentskillmania/wrangler/)
 */
export async function loadEvalLlmConfig(
  projectDirOrOptions?: string | LoadEvalLlmConfigOptions
): Promise<EvalLlmConfig> {
  const opts = typeof projectDirOrOptions === 'string'
    ? { projectDir: projectDirOrOptions }
    : projectDirOrOptions ?? {};

  // 0. Environment variables (same convention as colts/wrangler integration tests)
  if (process.env.OPENAI_API_KEY) {
    const provider = process.env.PROVIDER ?? 'openai';
    const model = process.env.MODEL ?? 'gpt-4o';
    const baseUrl = process.env.OPENAI_BASE_URL;
    return {
      llm: {
        providers: [
          {
            name: provider,
            apiKey: process.env.OPENAI_API_KEY,
            ...(baseUrl ? { baseUrl } : {}),
            models: [{ modelId: model }],
          },
        ],
      },
    };
  }

  // 1-3. YAML fallback
  const searchPaths: string[] = [];
  if (opts.projectDir) {
    searchPaths.push(join(opts.projectDir, 'wrangler.yaml'));
    searchPaths.push(join(opts.projectDir, 'eval-config.yaml'));
  }
  const globalDir = opts.globalDir ?? join(homedir(), '.agentskillmania', 'wrangler');
  searchPaths.push(join(globalDir, 'config.yaml'));

  const yaml = await import('js-yaml');
  for (const p of searchPaths) {
    try {
      const raw = await readFile(p, 'utf-8');
      const parsed = yaml.load(raw) as Record<string, unknown> | undefined;
      const llm = parsed?.llm as LLMQuickInit | undefined;
      if (llm?.providers?.length) {
        return { llm };
      }
    } catch {
      // File doesn't exist or isn't readable — try next.
    }
  }

  throw new Error(
    'No LLM config found. Set OPENAI_API_KEY env var or create wrangler.yaml with llm.providers.'
  );
}
