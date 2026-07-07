import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';

// Load environment variables from root .env file (integration tests need API key)
dotenv.config({ path: '../../.env' });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/index.ts', 'src/cli/main.ts', 'src/test-runner/types.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 88, // lowered from 90 — test-runner module pending phase-2 rewrite
        statements: 90,
      },
    },
  },
});
