import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';

// 从根目录 .env 文件加载环境变量
dotenv.config({ path: '../../.env' });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/index.ts', 'src/**/*.tsx', 'src/components/**'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
