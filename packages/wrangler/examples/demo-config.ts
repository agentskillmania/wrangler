/**
 * Demo shared configuration — loads .env and creates LLM client
 *
 * Search order for .env:
 *   1. packages/wrangler/.env
 *   2. colts/.env (sibling workspace)
 *
 * Required env vars:
 *   OPENAI_API_KEY
 * Optional:
 *   OPENAI_BASE_URL  — custom endpoint
 *   PROVIDER         — provider name (default: openai)
 *   MODEL            — model id (default: gpt-4)
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { LLMClient } from '@agentskillmania/llm-client';
import type { ILLMProvider } from '@agentskillmania/colts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from known locations
const envPaths = [
  join(__dirname, '..', '..', '..', '.env'), // wrangler/.env
];

for (const p of envPaths) {
  if (existsSync(p)) {
    dotenvConfig({ path: p });
    console.log(`[demo] 加载配置: ${p}`);
    break;
  }
}

export interface DemoConfig {
  provider: ILLMProvider;
  model: string;
}

/**
 * Create a fully initialized LLM client from environment variables.
 * Exits with helpful message if API key is missing.
 */
export function getDemoConfig(): DemoConfig {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'your_api_key_here') {
    console.error('\n缺少 OPENAI_API_KEY。请执行以下任一步骤：');
    console.error('  1. 在 colts/.env 中设置 OPENAI_API_KEY');
    console.error('  2. 在 packages/wrangler/.env 中设置 OPENAI_API_KEY');
    console.error('  3. export OPENAI_API_KEY=sk-xxx\n');
    process.exit(1);
  }

  const provider = process.env.PROVIDER || 'openai';
  const model = process.env.MODEL || 'gpt-4';

  const client = new LLMClient({
    baseUrl: process.env.OPENAI_BASE_URL,
  });

  client.registerProvider({ name: provider, maxConcurrency: 10 });
  client.registerApiKey({
    key: apiKey,
    provider,
    maxConcurrency: 5,
    models: [{ modelId: model, maxConcurrency: 3 }],
  });

  return { provider: client, model };
}
