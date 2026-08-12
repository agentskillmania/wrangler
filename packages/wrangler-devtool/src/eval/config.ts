/**
 * @fileoverview LLM configuration for eval — both the agent being evaluated
 * and the judge evaluator.
 *
 * Search order (first with llm.providers wins):
 *   1. projectDir/eval-config.yaml   — eval-specific override (can set judge model)
 *   2. projectDir/wrangler.yaml      — project config
 *   3. {appDir}/config.yaml          — global config (AGENTSKILLMANIA_APP_DIR ?? ~/.agentskillmania/skill-studio)
 *   4. Environment variables         — CI fallback (OPENAI_API_KEY etc.)
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { LLMQuickInit } from '@agentskillmania/colts';
import { NodeHostEnv } from '@agentskillmania/wrangler/host-env/node-host-env';

/** Result of loading LLM config. */
export interface EvalLlmConfig {
  /** LLM provider config (same shape as wrangler's llm field). */
  llm: LLMQuickInit;
  /** Model for the judge evaluator (defaults to first model if not specified). */
  judgeModel?: string;
}

export interface LoadEvalLlmConfigOptions {
  /** Project directory to search for YAML configs. */
  projectDir?: string;
  /** Override global config directory (testing). */
  globalDir?: string;
}

/**
 * Load LLM config for eval.
 *
 * @param projectDirOrOptions - project dir string or options object
 * @returns LLM config + optional judge model
 */
export async function loadEvalLlmConfig(
  projectDirOrOptions?: string | LoadEvalLlmConfigOptions
): Promise<EvalLlmConfig> {
  const opts =
    typeof projectDirOrOptions === 'string'
      ? { projectDir: projectDirOrOptions }
      : (projectDirOrOptions ?? {});

  // 1-3. YAML files
  const searchPaths: string[] = [];
  if (opts.projectDir) {
    searchPaths.push(join(opts.projectDir, 'eval-config.yaml'));
    searchPaths.push(join(opts.projectDir, 'wrangler.yaml'));
  }
  const globalDir = opts.globalDir ?? new NodeHostEnv().env.appDataDir();
  searchPaths.push(join(globalDir, 'config.yaml'));

  const yaml = await import('js-yaml');
  for (const p of searchPaths) {
    try {
      const raw = await readFile(p, 'utf-8');
      const parsed = yaml.load(raw) as Record<string, unknown> | undefined;
      const llm = parsed?.llm as LLMQuickInit | undefined;
      if (llm?.providers?.length) {
        // eval-config.yaml may specify a separate judge model
        const judgeSection = parsed?.judge as { model?: string } | undefined;
        return { llm, judgeModel: judgeSection?.model };
      }
    } catch {
      // File doesn't exist or isn't readable — try next.
    }
  }

  // 4. Environment variables (CI fallback)
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

  throw new Error(
    'No LLM config found. Create wrangler.yaml or eval-config.yaml with llm.providers, or set OPENAI_API_KEY env var.'
  );
}
