// packages/wrangler-devtool/src/agents/types.ts
// Shared types for built-in agents

import type { FileChange } from '../utils/file-change.js';

export interface AgentOutput {
  changes: FileChange[];
  summary: string;
}

export interface ReviewDimension {
  score: number;
  reasoning: string;
}

export interface ReviewIssue {
  severity: 'minor' | 'major' | 'critical';
  location: string;
  description: string;
  suggestion: string;
}

export interface ReviewReport {
  overallScore: number;
  dimensions: {
    clarity: ReviewDimension;
    completeness: ReviewDimension;
    focus: ReviewDimension;
    safety: ReviewDimension;
    efficiency: ReviewDimension;
  };
  issues: ReviewIssue[];
  summary: string;
}

export interface AgentOptions {
  model?: string;
  timeout?: number;
}

/** Options for run* agent methods (with iterative loop control) */
export interface AgentRunOptions {
  model?: string;
  timeout?: number;
  /** Max iterative rounds (generation → review → refine). Default: 3 */
  maxRounds?: number;
  /** Per-dimension minimum score to pass review. Default: 4 */
  scoreThreshold?: number;
}

export interface SessionSummary {
  title: string;
  description: string;
}
