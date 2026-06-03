// packages/wrangler-devtool/src/agents/orchestrator.ts
// Agent orchestration layer — uses EnhancedRunner from wrangler to execute agents

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAgentState, addUserMessage, addAssistantMessage } from '@agentskillmania/colts';
import type { AgentState, ILLMProvider } from '@agentskillmania/colts';
import { EnhancedRunner } from '@agentskillmania/wrangler';

import type { AgentOutput, ReviewReport, SessionSummary, AgentRunOptions } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load a prompt template from the bundled prompts directory.
 */
export async function loadPromptTemplate(name: string): Promise<string> {
  const filePath = join(__dirname, 'prompts', `${name}.md`);
  return readFile(filePath, 'utf-8');
}

/**
 * Extract the outermost JSON object from a text string.
 */
function extractJsonObject(text: string): string {
  const startIdx = text.indexOf('{');
  if (startIdx === -1) return '';

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIdx; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
    } else {
      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          return text.slice(startIdx, i + 1);
        }
      }
    }
  }

  return '';
}

/**
 * Parse JSON from LLM response text.
 */
function parseJsonFromResponse(raw: string): unknown {
  const trimmed = raw.trim();
  const firstBacktick = trimmed.indexOf('```');
  const lastBacktick = trimmed.lastIndexOf('```');
  let jsonText = trimmed;

  if (firstBacktick !== -1 && lastBacktick !== -1 && lastBacktick > firstBacktick) {
    let content = trimmed.slice(firstBacktick + 3, lastBacktick);
    content = content.replace(/^json\s*\n?/, '').trim();
    jsonText = content;
  }

  const jsonStr = extractJsonObject(jsonText);
  if (!jsonStr) throw new Error('No JSON object found in LLM response');
  return JSON.parse(jsonStr);
}

/**
 * Parse an AgentOutput from LLM response.
 */
export function parseAgentOutput(raw: string): AgentOutput {
  const parsed = parseJsonFromResponse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid JSON in LLM response');
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.changes)) {
    throw new Error('Missing or invalid "changes" array');
  }
  if (typeof obj.summary !== 'string') {
    throw new Error('Missing or invalid "summary" string');
  }
  return { changes: obj.changes, summary: obj.summary };
}

/**
 * Parse a ReviewReport from LLM response.
 */
export function parseReviewReport(raw: string): ReviewReport {
  const parsed = parseJsonFromResponse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid JSON in LLM response');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.overallScore !== 'number') {
    throw new Error('Missing or invalid "overallScore"');
  }
  if (!obj.dimensions || typeof obj.dimensions !== 'object') {
    throw new Error('Missing or invalid "dimensions"');
  }
  if (!Array.isArray(obj.issues)) {
    throw new Error('Missing or invalid "issues" array');
  }
  if (typeof obj.summary !== 'string') {
    throw new Error('Missing or invalid "summary"');
  }
  return parsed as ReviewReport;
}

/**
 * Parse a SessionSummary from LLM response.
 */
export function parseSessionSummary(raw: string): SessionSummary {
  const parsed = parseJsonFromResponse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid JSON in LLM response');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.title !== 'string' || obj.title.length === 0) {
    throw new Error('Missing or invalid "title"');
  }
  if (typeof obj.description !== 'string' || obj.description.length === 0) {
    throw new Error('Missing or invalid "description"');
  }
  return { title: obj.title, description: obj.description };
}

// ── Runner config ──────────────────────────────────────────

export interface RunnerConfig {
  llmClient: ILLMProvider;
  workspacePath: string;
  model?: string;
}

// ── Factory functions ──────────────────────────────────────

/**
 * Create an EnhancedRunner for generation agents (architect, skill-designer, crew-composer).
 * These agents need file tools to read/write workspace files.
 */
export async function createGenerationRunner(
  promptName: string,
  runnerConfig: RunnerConfig
): Promise<{ runner: EnhancedRunner; state: AgentState }> {
  const template = await loadPromptTemplate(promptName);
  const runner = await EnhancedRunner.create({
    llmClient: runnerConfig.llmClient,
    model: runnerConfig.model,
    workspacePath: runnerConfig.workspacePath,
    builtinTools: {
      fileRead: true,
      fileWrite: true,
      fileEdit: true,
      glob: true,
      grep: true,
    },
    enableSession: false,
    enableTodolist: false,
    enableCommands: false,
    mcpConfigPaths: [],
    skillDirs: [],
  });

  const state = createAgentState({
    name: promptName,
    instructions: template,
    tools: [],
  });

  return { runner, state };
}

/**
 * Create an EnhancedRunner for the reviewer agent.
 * No builtin tools needed — only evaluates text content.
 */
export async function createReviewRunner(
  runnerConfig: RunnerConfig
): Promise<{ runner: EnhancedRunner; state: AgentState }> {
  const template = await loadPromptTemplate('reviewer');
  const runner = await EnhancedRunner.create({
    llmClient: runnerConfig.llmClient,
    model: runnerConfig.model,
    workspacePath: runnerConfig.workspacePath,
    builtinTools: {},
    enableSession: false,
    enableTodolist: false,
    enableCommands: false,
    mcpConfigPaths: [],
    skillDirs: [],
  });

  const state = createAgentState({
    name: 'reviewer',
    instructions: template,
    tools: [],
  });

  return { runner, state };
}

/**
 * Create an EnhancedRunner for the session curator agent.
 */
export async function createCuratorRunner(
  runnerConfig: RunnerConfig
): Promise<{ runner: EnhancedRunner; state: AgentState }> {
  const template = await loadPromptTemplate('session-curator');
  const runner = await EnhancedRunner.create({
    llmClient: runnerConfig.llmClient,
    model: runnerConfig.model,
    workspacePath: runnerConfig.workspacePath,
    builtinTools: {},
    enableSession: false,
    enableTodolist: false,
    enableCommands: false,
    mcpConfigPaths: [],
    skillDirs: [],
  });

  const state = createAgentState({
    name: 'session-curator',
    instructions: template,
    tools: [],
  });

  return { runner, state };
}

// ── Helpers ────────────────────────────────────────────────

/**
 * Get the last assistant message content from a state.
 */
function getLastAssistantContent(state: AgentState): string {
  const messages = state.context.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      return messages[i].content;
    }
  }
  return '';
}

/**
 * Check if a review report passes the score threshold on all dimensions.
 */
function reviewPasses(report: ReviewReport, threshold: number): boolean {
  const dims = report.dimensions;
  return (
    dims.clarity.score >= threshold &&
    dims.completeness.score >= threshold &&
    dims.focus.score >= threshold &&
    dims.safety.score >= threshold &&
    dims.efficiency.score >= threshold
  );
}

/**
 * Build review feedback text for the next generation round.
 */
function buildReviewFeedback(report: ReviewReport): string {
  const lines = [
    '## Review Feedback (previous round did not pass)\n',
    `Overall score: ${report.overallScore}/5\n`,
    'Dimension scores:',
  ];
  for (const [name, dim] of Object.entries(report.dimensions)) {
    lines.push(`- ${name}: ${dim.score}/5 — ${dim.reasoning}`);
  }
  if (report.issues.length > 0) {
    lines.push('\nIssues to address:');
    for (const issue of report.issues) {
      lines.push(`- [${issue.severity}] ${issue.location}: ${issue.description}`);
      lines.push(`  Suggestion: ${issue.suggestion}`);
    }
  }
  return lines.join('\n');
}

// ── Execution functions ────────────────────────────────────

/**
 * Run a generation agent with the iterative review loop.
 *
 * Each round: generation → review → threshold check.
 * If review passes, return immediately. If not, inject feedback and iterate.
 */
export async function runGenerationWithLoop(
  promptName: string,
  userPrompt: string,
  runnerConfig: RunnerConfig,
  existingContent?: string,
  options?: AgentRunOptions
): Promise<{ output: AgentOutput; review?: ReviewReport }> {
  const maxRounds = options?.maxRounds ?? 3;
  const threshold = options?.scoreThreshold ?? 4;

  let userMessage = userPrompt;
  if (existingContent) {
    userMessage += `\n\n## Existing Content\n\n\`\`\`markdown\n${existingContent}\n\`\`\``;
  }

  let lastOutput: AgentOutput | undefined;
  let lastReview: ReviewReport | undefined;

  for (let round = 0; round < maxRounds; round++) {
    const { runner, state: initialState } = await createGenerationRunner(promptName, runnerConfig);

    let state = addUserMessage(initialState, userMessage);

    // Inject previous round's output and review feedback for refinement
    if (round > 0 && lastOutput && lastReview) {
      state = addAssistantMessage(state, JSON.stringify(lastOutput));
      state = addUserMessage(state, buildReviewFeedback(lastReview));
    }

    const { state: genState } = await runner.run(state);
    const genRaw = getLastAssistantContent(genState);

    try {
      lastOutput = parseAgentOutput(genRaw);
    } catch {
      lastOutput = { changes: [], summary: genRaw };
    }

    // Skip review on single-round mode or on the final round
    if (maxRounds <= 1 || round === maxRounds - 1) {
      return { output: lastOutput, review: lastReview };
    }

    // Run reviewer on the generated output
    const { runner: reviewRunner, state: reviewInitialState } =
      await createReviewRunner(runnerConfig);
    const reviewContent = `Review the following generated content:\n\n${JSON.stringify(lastOutput, null, 2)}`;
    const reviewState = addUserMessage(reviewInitialState, reviewContent);
    const { state: afterReview } = await reviewRunner.run(reviewState);
    const reviewRaw = getLastAssistantContent(afterReview);

    try {
      lastReview = parseReviewReport(reviewRaw);
    } catch {
      // If review parsing fails, assume pass to avoid infinite loop
      return { output: lastOutput, review: undefined };
    }

    if (reviewPasses(lastReview, threshold)) {
      return { output: lastOutput, review: lastReview };
    }
  }

  return { output: lastOutput!, review: lastReview };
}

/**
 * Run the reviewer on content (no loop).
 */
export async function runReview(
  content: string,
  runnerConfig: RunnerConfig
): Promise<ReviewReport> {
  const { runner, state: initialState } = await createReviewRunner(runnerConfig);
  const state = addUserMessage(initialState, content);
  const { state: afterRun } = await runner.run(state);
  const raw = getLastAssistantContent(afterRun);
  return parseReviewReport(raw);
}

/**
 * Run the session curator on text (no loop).
 */
export async function runCurator(
  text: string,
  runnerConfig: RunnerConfig
): Promise<SessionSummary> {
  const { runner, state: initialState } = await createCuratorRunner(runnerConfig);
  const state = addUserMessage(initialState, text);
  const { state: afterRun } = await runner.run(state);
  const raw = getLastAssistantContent(afterRun);
  return parseSessionSummary(raw);
}
