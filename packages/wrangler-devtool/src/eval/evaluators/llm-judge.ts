/**
 * @fileoverview LLM-as-Judge evaluator.
 *
 * Sends the full EvalTrace (answer + tool calls) to a judge LLM with the
 * rubric from the YAML spec. The judge returns a numeric score and reasoning;
 * the evaluator compares against minScore to decide pass/fail.
 *
 * Judge always uses temperature: 0 for determinism.
 */

import type { LLMQuickInit, LLMProviderEntry } from '@agentskillmania/colts';
import { LLMClient } from '@agentskillmania/llm-client';
import type { LLMResponse } from '@agentskillmania/llm-client';

import type { EvalLlmConfig } from '../config.js';
import type { Evaluator, EvalTrace, EvaluatorSpec, EvalResult } from '../types.js';

/** Constructor options — either provide a ready config or a raw LLMQuickInit. */
export interface LlmJudgeOptions {
  /** Pre-loaded config (preferred when loading via loadEvalLlmConfig). */
  config?: EvalLlmConfig;
  /** Inline LLM quick-init (convenient for tests). */
  llm?: LLMQuickInit;
  /** Override the model used for judging. */
  model?: string;
}

/**
 * LLM-as-Judge evaluator. One instance per eval run; the LLM client is
 * created once and reused across all cases.
 */
export class LlmJudgeEvaluator implements Evaluator {
  readonly type = 'llm-judge';

  private client: LLMClient;
  private model: string;

  constructor(options: LlmJudgeOptions) {
    const llm = options.config?.llm ?? options.llm;
    if (!llm) {
      throw new Error('LlmJudgeEvaluator requires either config or llm option');
    }
    this.client = createClientFromProviders(llm.providers);
    this.model = options.model ?? llm.providers[0]?.models?.[0]?.modelId ?? 'gpt-4o';
  }

  async evaluate(trace: EvalTrace, spec: EvaluatorSpec): Promise<EvalResult> {
    if (spec.type !== 'llm-judge') {
      return {
        name: spec.type,
        passed: false,
        message: `LlmJudgeEvaluator received non-llm-judge spec: ${spec.type}`,
      };
    }

    const prompt = this.buildPrompt(trace, spec);
    const response: LLMResponse = await this.client.call({
      model: this.model,
      // System prompt is prepended to the user message because pi-ai's Message
      // type has no 'system' role — systemPrompt goes through Context, which
      // llm-client's buildContext() doesn't expose. Inline is equivalent for
      // judge use (single-turn, no conversation history).
      messages: [
        {
          role: 'user',
          content: `${JUDGE_SYSTEM_PROMPT}\n\n${prompt}`,
          timestamp: Date.now(),
        },
      ],
      temperature: 0,
    });

    const parsed = this.parseJudgeResponse(response.content);
    if (parsed === null) {
      return {
        name: spec.name,
        passed: false,
        message: `Could not parse judge response: ${response.content.slice(0, 200)}`,
      };
    }

    const { score, reasoning } = parsed;
    const passed = score >= spec.minScore;
    return {
      name: spec.name,
      passed,
      score,
      message: reasoning,
    };
  }

  private buildPrompt(
    trace: EvalTrace,
    spec: Extract<EvaluatorSpec, { type: 'llm-judge' }>
  ): string {
    const rubricText = spec.rubric.map((r) => `  ${r.score}: ${r.description}`).join('\n');

    const toolCallSummary = trace.toolCalls.length
      ? trace.toolCalls.map((tc) => `  - ${tc.name}(${JSON.stringify(tc.arguments)})`).join('\n')
      : '  (none)';

    const parts = [
      `Criteria: ${spec.criteria}`,
      '',
      `Rubric:`,
      rubricText,
      '',
      `Agent's answer:`,
      trace.answer,
      '',
      `Tools used:`,
      toolCallSummary,
    ];

    if (spec.reference) {
      parts.push('', `Reference answer (gold standard):`, spec.reference);
    }

    parts.push(
      '',
      `Based on the criteria and rubric, assign a score and explain your reasoning.`,
      'Respond in exactly this format:',
      'SCORE: <number>',
      'REASONING: <your explanation>'
    );

    return parts.join('\n');
  }

  /**
   * Parse "SCORE: 4\nREASONING: ..." from judge output.
   * Returns null if the format doesn't match.
   */
  private parseJudgeResponse(content: string): { score: number; reasoning: string } | null {
    const scoreMatch = content.match(/SCORE:\s*(\d+(?:\.\d+)?)/i);
    const reasoningMatch = content.match(/REASONING:\s*([\s\S]+)/i);
    if (!scoreMatch) return null;
    const score = Number.parseFloat(scoreMatch[1]);
    if (Number.isNaN(score)) return null;
    const reasoning = reasoningMatch?.[1]?.trim() ?? '';
    return { score, reasoning };
  }
}

const JUDGE_SYSTEM_PROMPT = `You are an evaluation judge. You assess agent outputs against specific criteria and rubrics. Be objective, thorough, and consistent. Always respond in the exact format requested.`;

/**
 * Build an LLMClient from provider entries (mirrors wrangler's createLLMClient).
 * Used because LLMClient constructor doesn't accept LLMQuickInit directly.
 */
function createClientFromProviders(providers: LLMProviderEntry[]): LLMClient {
  const client = new LLMClient();
  for (const provider of providers) {
    const concurrency = provider.maxConcurrency ?? 10;
    client.registerProvider({
      name: provider.name,
      baseUrl: provider.baseUrl,
      maxConcurrency: concurrency,
    });
    client.registerApiKey({
      key: provider.apiKey,
      provider: provider.name,
      maxConcurrency: concurrency,
      models: provider.models.map((m) => ({
        modelId: m.modelId,
        maxConcurrency: m.maxConcurrency ?? 3,
        contextWindow: m.contextWindow,
        maxTokens: m.maxTokens,
        reasoning: m.reasoning,
        input: m.input,
      })),
    });
  }
  return client;
}
