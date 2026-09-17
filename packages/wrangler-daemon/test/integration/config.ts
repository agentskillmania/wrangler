/**
 * Integration test configuration for wrangler-daemon.
 *
 * Reads environment variables from root .env file (loaded by vitest.config.ts).
 * Tests are gated by ENABLE_INTEGRATION_TESTS=true.
 */

import { ensureNodeSkillFsOps } from '@agentskillmania/wrangler/bootstrap';

// Tests boot bare fastify apps (routes only, not the daemon CLI entry), so the
// host-side SkillFsOps registration that daemon.ts does at startup must be
// mirrored here — otherwise skill-dependent routes (crew chat, per-request
// sessions) 500 with "Default SkillFsOps not registered".
// R2P-201：注册必须走 wrangler 门面（ensureNodeSkillFsOps）——生产代码的
// FilesystemSkillProvider 经 wrangler 再导出消费的是 wrangler 依赖侧的
// colts 实例（pnpm peer 变体会拆出两个 .pnpm 实例），直接 import colts
// 注册会落在另一个实例的全局槽上、路由侧读不到。
ensureNodeSkillFsOps();

export interface TestConfig {
  apiKey: string;
  baseUrl?: string;
  provider: string;
  testModel: string;
  enabled: boolean;
}

function loadConfig(): TestConfig {
  const enabled = process.env.ENABLE_INTEGRATION_TESTS === 'true' && !!process.env.OPENAI_API_KEY;

  if (process.env.ENABLE_INTEGRATION_TESTS === 'true' && !process.env.OPENAI_API_KEY) {
    console.warn(
      '[wrangler-daemon Integration Tests] ENABLE_INTEGRATION_TESTS is true but OPENAI_API_KEY is not set; skipping LLM integration tests.'
    );
  }

  return {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: process.env.OPENAI_BASE_URL,
    provider: process.env.PROVIDER || 'openai',
    testModel: process.env.MODEL || 'gpt-3.5-turbo',
    enabled,
  };
}

export const testConfig: TestConfig = loadConfig();

/** Conditionally run tests based on a condition */
export const itif = (condition: boolean) => (condition ? it : it.skip);
