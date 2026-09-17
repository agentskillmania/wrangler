import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';

// Load env vars from monorepo root .env (integration tests need API keys)
dotenv.config({ path: '../../.env' });

export default defineConfig({
  resolve: {
    alias: {},
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 120000,
    fileParallelism: false,
    // sogou live 测试已恢复（R2P-243 provider 链回退落地）：文件本身是双模式
    // 断言——canary 探针判风控，被拦时断言 bing 回退真结果，不再是环境红。
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
