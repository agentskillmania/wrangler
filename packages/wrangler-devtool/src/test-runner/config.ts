/**
 * @fileoverview Minimal config/LLM helpers for the test-runner module.
 *
 * These were previously in the top-level src/config.ts and src/llm.ts,
 * which were removed during the devtool refactoring (devtool no longer
 * executes AI logic). The test-runner still needs them for soft evaluation.
 * This file will be replaced when the test-runner is refactored into an
 * evaluation framework (phase 2).
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

import { createLLMClient as createWranglerLLMClient } from '@agentskillmania/wrangler';
import type { LLMClient } from '@agentskillmania/llm-client';
import type { LLMQuickInit } from '@agentskillmania/colts';

export type LLMConfig = LLMQuickInit;

export interface DevToolConfig {
  llm: LLMConfig;
  maxSteps?: number;
  requestTimeout?: number;
}

/**
 * Minimal YAML config loader — searches for wrangler.yaml in the current
 * directory and the global config directory.
 */
export async function loadConfig(options?: { skipGlobal?: boolean }): Promise<DevToolConfig | null> {
  const searchPaths = [
    resolve(process.cwd(), 'wrangler.yaml'),
  ];
  if (!options?.skipGlobal) {
    searchPaths.push(join(homedir(), '.agentskillmania', 'wrangler', 'config.yaml'));
  }

  for (const path of searchPaths) {
    if (!existsSync(path)) continue;
    try {
      // Use js-yaml to parse (already a dependency of test-runner)
      const yaml = (await import('js-yaml')).default;
      const raw = yaml.load(readFileSync(path, 'utf-8'));
      if (raw && typeof raw === 'object' && 'llm' in raw) {
        const config = raw as Record<string, unknown>;
        const llmRaw = config.llm;
        if (isValidLLMConfig(llmRaw)) {
          return { llm: llmRaw } as DevToolConfig;
        }
      }
    } catch {
      // skip invalid files
    }
  }

  return null;
}

function isValidLLMConfig(llm: unknown): llm is LLMQuickInit {
  if (!llm || typeof llm !== 'object') return false;
  const obj = llm as Record<string, unknown>;
  const providers = obj.providers;
  if (!Array.isArray(providers) || providers.length === 0) return false;
  const first = providers[0] as Record<string, unknown>;
  return !!(first?.name && first?.apiKey && Array.isArray(first?.models) && first.models.length > 0);
}

export function createLLMClient(config: LLMConfig): LLMClient {
  return createWranglerLLMClient(config.providers);
}
