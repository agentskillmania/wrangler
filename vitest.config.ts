import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';

// 从根目录 .env 文件加载环境变量
dotenv.config({ path: '.env' });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/*.d.ts', 'packages/*/src/**/index.ts'],
    },
  },
});
