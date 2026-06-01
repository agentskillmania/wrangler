import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

// Load env vars from monorepo root .env (integration tests need API keys)
dotenv.config({ path: '../../.env' });

export default defineConfig({
  resolve: {
    alias: {
      // pnpm strict isolation nests llm-client under colts, but Vite's resolver
      // cannot follow that symlink chain. Expose it explicitly so integration
      // tests can `import { LLMClient } from '@agentskillmania/llm-client'`.
      '@agentskillmania/llm-client': resolve(
        __dirname,
        'node_modules/@agentskillmania/colts/node_modules/@agentskillmania/llm-client/src/index.ts'
      ),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/index.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
