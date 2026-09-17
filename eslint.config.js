import eslint from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    files: ['packages/*/src/**/*.ts'],
    plugins: {
      import: importPlugin,
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: './packages/*/tsconfig.json',
        },
      },
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './packages/*/tsconfig.json',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],
    },
  },
  // ─── 边界执法（R2P-201，对齐 Rust check.sh 边界门第 1 条 / c410f79）─────
  // daemon 生产代码（src/）零 colts/llm-client 直驱：内核词汇经
  // @agentskillmania/wrangler 定向再导出门面触达——「wrangler 是 harness、
  // colts 是 agent」。test/ 不在本 files 范围（`pnpm lint` 只扫
  // packages/*/src）：测试经 devDependencies 构造内核事件钉「翻译+映射」
  // 双层契约不算违例（对齐 Rust dev-dependencies 豁免）。
  {
    files: ['packages/wrangler-daemon/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@agentskillmania/colts', '@agentskillmania/colts/*'],
              message:
                'daemon 生产代码不得直驱 @agentskillmania/colts：内核词汇（AgentState/HITL/runner 事件等）经 @agentskillmania/wrangler 定向再导出取用（R2P-201，对齐 Rust c410f79 边界门）。',
            },
            {
              group: ['@agentskillmania/llm-client', '@agentskillmania/llm-client/*'],
              message:
                'daemon 生产代码不得直驱 @agentskillmania/llm-client：LLM 装配经 @agentskillmania/wrangler 的 createLLMClient（R2P-201，对齐 Rust c410f79 边界门）。',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ['**/dist/', '**/node_modules/', '**/coverage/', '**/static/vendor/', '**/static/js/'],
  }
);
