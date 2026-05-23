// packages/wrangler-devtool/src/agents/orchestrator.ts
// Agent orchestration layer — assembles prompts, calls LLM, parses output

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LLMClient } from '@agentskillmania/llm-client';
import type { AgentOutput, ReviewReport, SessionSummary, AgentOptions } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load a prompt template from the bundled prompts directory.
 */
export async function loadPromptTemplate(name: string): Promise<string> {
  const filePath = join(__dirname, 'prompts', `${name}.md`);
  return readFile(filePath, 'utf-8');
}

/**
 * Assemble the full prompt by injecting user content into the template.
 */
export function assemblePrompt(
  template: string,
  userPrompt: string,
  existingContent?: string
): string {
  let result = template;
  result = result.replace(/\{\{USER_PROMPT\}\}/g, userPrompt);
  if (existingContent !== undefined) {
    result = result.replace(/\{\{EXISTING_CONTENT\}\}/g, existingContent);
    result += `\n\n## Existing Content\n\nThe file currently contains:\n\n\`\`\`markdown\n${existingContent}\n\`\`\`\n`;
  }
  result += `\n\n## User Request\n\n${userPrompt}\n`;
  return result;
}

/**
 * Extract the outermost JSON object from a text string.
 * Uses brace-depth tracking to correctly handle nested objects
 * and braces inside string values.
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
 * Extract and parse JSON from an LLM response string.
 * Handles markdown code blocks and raw JSON.
 */
export function parseAgentOutput(raw: string): AgentOutput {
  const trimmed = raw.trim();

  // Try to extract JSON from markdown code block.
  const firstBacktick = trimmed.indexOf('```');
  const lastBacktick = trimmed.lastIndexOf('```');
  let jsonText = trimmed;

  if (firstBacktick !== -1 && lastBacktick !== -1 && lastBacktick > firstBacktick) {
    let content = trimmed.slice(firstBacktick + 3, lastBacktick);
    content = content.replace(/^json\s*\n?/, '').trim();
    jsonText = content;
  }

  const jsonStr = extractJsonObject(jsonText);
  if (!jsonStr) {
    throw new Error('No JSON object found in LLM response');
  }

  const parsed = JSON.parse(jsonStr);

  if (!parsed.changes || !Array.isArray(parsed.changes)) {
    throw new Error('Missing or invalid "changes" array in LLM output');
  }
  if (typeof parsed.summary !== 'string') {
    throw new Error('Missing or invalid "summary" string in LLM output');
  }

  return {
    changes: parsed.changes,
    summary: parsed.summary,
  };
}

/**
 * Parse a review report from LLM response.
 */
export function parseReviewReport(raw: string): ReviewReport {
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
  if (!jsonStr) {
    throw new Error('No JSON object found in LLM response');
  }

  const parsed = JSON.parse(jsonStr);

  if (typeof parsed.overallScore !== 'number') {
    throw new Error('Missing or invalid "overallScore" in review report');
  }
  if (!parsed.dimensions || typeof parsed.dimensions !== 'object') {
    throw new Error('Missing or invalid "dimensions" in review report');
  }
  if (!Array.isArray(parsed.issues)) {
    throw new Error('Missing or invalid "issues" array in review report');
  }
  if (typeof parsed.summary !== 'string') {
    throw new Error('Missing or invalid "summary" in review report');
  }

  return parsed as ReviewReport;
}

/**
 * Parse a session summary from LLM response.
 */
export function parseSessionSummary(raw: string): SessionSummary {
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
  if (!jsonStr) {
    throw new Error('No JSON object found in LLM response');
  }

  const parsed = JSON.parse(jsonStr);

  if (typeof parsed.title !== 'string' || parsed.title.length === 0) {
    throw new Error('Missing or invalid "title" in session summary');
  }
  if (typeof parsed.description !== 'string' || parsed.description.length === 0) {
    throw new Error('Missing or invalid "description" in session summary');
  }

  return { title: parsed.title, description: parsed.description };
}

/**
 * Call the LLM with a system prompt and user message.
 */
export async function callAgentLLM(
  client: LLMClient,
  model: string,
  systemPrompt: string,
  userMessage: string,
  options?: AgentOptions
): Promise<string> {
  const combinedContent = `<system>\n${systemPrompt}\n</system>\n\n${userMessage}`;
  const response = await client.call({
    model,
    messages: [
      {
        role: 'user',
        content: combinedContent,
        timestamp: Date.now(),
      },
    ],
    requestTimeout: options?.timeout ?? 1800000,
  });

  return response.content;
}

/**
 * Run a built-in agent that produces file changes.
 */
export async function runAgent(
  client: LLMClient,
  model: string,
  promptName: string,
  userPrompt: string,
  existingContent?: string,
  options?: AgentOptions
): Promise<AgentOutput> {
  const template = await loadPromptTemplate(promptName);
  const systemPrompt = assemblePrompt(template, userPrompt, existingContent);
  const raw = await callAgentLLM(client, model, systemPrompt, userPrompt, options);
  return parseAgentOutput(raw);
}

/**
 * Run the reviewer agent that produces a review report.
 */
export async function runReviewAgent(
  client: LLMClient,
  model: string,
  userPrompt: string,
  options?: AgentOptions
): Promise<ReviewReport> {
  const template = await loadPromptTemplate('reviewer');
  const systemPrompt = `${template}\n\n## Review Target\n\n${userPrompt}`;
  const raw = await callAgentLLM(client, model, systemPrompt, userPrompt, options);
  return parseReviewReport(raw);
}
