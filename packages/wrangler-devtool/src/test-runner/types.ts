// packages/wrangler-devtool/src/test-runner/types.ts
// Test framework type definitions

export interface TestInput {
  message?: string;
  history?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

export interface FileFixture {
  source: string;
  target: string;
}

export interface TestContext {
  files?: FileFixture[];
  env?: Record<string, string>;
}

export interface ToolMock {
  response?: unknown;
  error?: string;
}

export interface TestTools {
  available?: string[];
  mock?: Record<string, ToolMock>;
}

export type AssertionType =
  | 'output_contains'
  | 'output_not_contains'
  | 'output_matches'
  | 'tool_called'
  | 'tool_not_called'
  | 'tool_called_with'
  | 'file_exists'
  | 'file_not_exists'
  | 'exit_code';

export interface HardAssertion {
  type: AssertionType;
  value?: string;
  pattern?: string;
  tool?: string;
  withArgs?: Record<string, unknown>;
  path?: string;
  contentContains?: string;
}

export interface SoftEvaluation {
  name: string;
  criteria: string;
  rubric: Array<{ score: number; description: string }>;
  minScore: number;
}

export interface TestCase {
  name: string;
  description?: string;
  input: TestInput;
  context?: TestContext;
  tools?: TestTools;
  expected: {
    hard?: HardAssertion[];
    soft?: SoftEvaluation[];
  };
  sourceFile: string;
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
}

export interface AgentRunOutput {
  answer: string;
  toolCalls: ToolCallRecord[];
  resultType: 'success' | 'max_steps' | 'error';
  totalSteps: number;
  error?: Error;
}

export interface AssertionResult {
  passed: boolean;
  message: string;
}

export interface TestCaseResult {
  case: TestCase;
  passed: boolean;
  duration: number;
  hardResults: AssertionResult[];
  softResults?: unknown[]; // Phase 4
  error?: string;
  output?: AgentRunOutput;
}

export interface TestSuite {
  file: string;
  cases: TestCaseResult[];
  passed: boolean;
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  duration: number;
  hardPassed: number;
  hardFailed: number;
}

export interface TestReport {
  suites: TestSuite[];
  summary: TestSummary;
}

export interface TestCliOptions {
  hardOnly?: boolean;
  case?: string;
  reporter?: 'console' | 'json';
  timeout?: number;
}

export interface RunTestsDeps {
  llmClient?: unknown;
  runnerFactory?: unknown;
  workspacePath?: string;
}
