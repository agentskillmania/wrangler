// packages/wrangler-devtool/src/test-runner/soft-evaluator.ts
// LLM-based soft evaluation for test cases

import { resolveDefaultModel } from '@agentskillmania/wrangler';

import type { SoftEvaluation, AgentRunOutput } from './types.js';
import type { LLMConfig } from './config.js';
import { createLLMClient } from './config.js';

export interface SoftEvaluationResult {
  name: string;
  score: number;
  reasoning: string;
  passed: boolean;
}

interface EvalResponse {
  score: number;
  reasoning: string;
}

function buildPrompt(evaluation: SoftEvaluation, output: AgentRunOutput): string {
  let rubricText = '';
  if (evaluation.rubric && evaluation.rubric.length > 0) {
    rubricText =
      '\nScoring rubric:\n' +
      evaluation.rubric.map((r) => `  ${r.score}: ${r.description}`).join('\n');
  }

  return `You are a test evaluation judge. Evaluate the following agent output against the given criteria.

Evaluation criteria:
${evaluation.criteria}${rubricText}

Min passing score: ${evaluation.minScore}

Agent output to evaluate:
${output.answer}

Respond with a JSON object containing exactly these fields:
{
  "score": <number 1-5>,
  "reasoning": "<brief explanation of the score>"
}`;
}

export async function evaluateSoft(
  evaluation: SoftEvaluation,
  output: AgentRunOutput,
  config: LLMConfig
): Promise<SoftEvaluationResult> {
  const client = createLLMClient(config);
  const model = resolveDefaultModel(config.providers);
  const prompt = buildPrompt(evaluation, output);

  try {
    const response = await client.call({
      model,
      messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
    });

    const content = response.content ?? '';
    let parsed: EvalResponse;

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]) as EvalResponse;
      } else {
        throw new Error('No JSON found in response');
      }
    } catch {
      // Fallback: extract score from text
      const scoreMatch = content.match(/score[:\s]+(\d)/i);
      const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 1;
      parsed = { score, reasoning: content.slice(0, 200) };
    }

    const score = Math.max(1, Math.min(5, parsed.score ?? 1));

    return {
      name: evaluation.name,
      score,
      reasoning: parsed.reasoning ?? 'No reasoning provided',
      passed: score >= evaluation.minScore,
    };
  } catch (error) {
    return {
      name: evaluation.name,
      score: 0,
      reasoning: `Evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
      passed: false,
    };
  }
}
