import type { AgentState } from '@agentskillmania/colts';
import type { RunStreamEvent } from '@agentskillmania/colts';
import { addUserMessage, addAssistantMessage } from '@agentskillmania/colts';
import type { EnhancedRunner } from '@agentskillmania/wrangler';
import { DevTool, parseAgentOutput, parseReviewReport } from '@agentskillmania/wrangler-devtool';
import type { AgentOutput, ReviewReport } from '@agentskillmania/wrangler-devtool';
import type { FastifyInstance, FastifyReply } from 'fastify';

import type { ConfigManager } from '../core/config-manager.js';
import type { DecoratedFastifyInstance, SSEEvent } from '../types.js';

/**
 * Map a colts RunStreamEvent to a devtool SSE event.
 * Returns null for events that don't map to devtool stream.
 */
export function mapDevtoolStreamEvent(event: RunStreamEvent): SSEEvent | null {
  switch (event.type) {
    case 'token':
      return { event: 'devtool:token', data: { delta: event.token } };
    case 'thinking':
      return { event: 'devtool:thinking', data: { content: event.content } };
    case 'tool:start':
      return {
        event: 'devtool:tool-start',
        data: { id: event.action.id, name: event.action.tool, args: event.action.arguments },
      };
    case 'tool:end':
      return {
        event: 'devtool:tool-end',
        data: {
          callId: event.callId,
          result:
            typeof event.result === 'object'
              ? JSON.stringify(event.result, null, 2)
              : String(event.result),
        },
      };
    case 'error':
      return { event: 'devtool:error', data: { message: event.error.message } };
    default:
      return null;
  }
}

function writeSSE(reply: FastifyReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function getLastAssistantContent(state: AgentState): string {
  const messages = state.context.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      return messages[i].content;
    }
  }
  return '';
}

function createDevTool(configManager: ConfigManager): DevTool {
  const config = configManager.get();
  return new DevTool({
    llm: {
      provider: 'openai',
      apiKey: config.llm.apiKey,
      model: config.llm.model,
      baseUrl: config.llm.baseUrl || undefined,
    },
  });
}

interface StreamGenerateBody {
  prompt?: string;
  existingContent?: string;
  model?: string;
  maxRounds?: number;
  scoreThreshold?: number;
}

/**
 * Run a single generation pass with streaming.
 * Returns the final AgentState after the runner completes.
 */
async function streamRunner(
  reply: FastifyReply,
  runner: EnhancedRunner,
  initialState: AgentState
): Promise<AgentState | undefined> {
  const stream = runner.runStream(initialState);
  const iterator = stream[Symbol.asyncIterator]();
  let iterResult = await iterator.next();
  let finalState: AgentState | undefined;

  while (!iterResult.done) {
    const mapped = mapDevtoolStreamEvent(iterResult.value as RunStreamEvent);
    if (mapped) writeSSE(reply, mapped.event, mapped.data);
    iterResult = await iterator.next();
  }

  // AsyncGenerator final return value: { state, result }
  if (iterResult.value && typeof iterResult.value === 'object' && 'state' in iterResult.value) {
    finalState = iterResult.value.state as AgentState;
  }

  return finalState;
}

/**
 * SSE streaming devtool routes.
 *
 * Each route creates a DevTool runner, streams events via SSE, and
 * sends a final devtool:complete event with parsed output.
 */
export async function devtoolStreamRoutes(fastify: FastifyInstance): Promise<void> {
  const decorated = fastify as unknown as DecoratedFastifyInstance;
  const getConfig = () => decorated.configManager;

  fastify.post('/api/devtool/agent/generate/stream', async (request, reply) => {
    await handleStreamGeneration(
      reply,
      getConfig(),
      'architect',
      request.body as StreamGenerateBody
    );
  });

  fastify.post('/api/devtool/skill/generate/stream', async (request, reply) => {
    await handleStreamGeneration(
      reply,
      getConfig(),
      'skill-designer',
      request.body as StreamGenerateBody
    );
  });

  fastify.post('/api/devtool/crew/generate/stream', async (request, reply) => {
    await handleStreamGeneration(
      reply,
      getConfig(),
      'crew-composer',
      request.body as StreamGenerateBody
    );
  });

  fastify.post('/api/devtool/review/stream', async (request, reply) => {
    const body = request.body as { content?: string; model?: string };
    if (!body.content) {
      reply.code(400).send({ error: 'content is required' });
      return;
    }
    await handleStreamReview(reply, getConfig(), body.content);
  });
}

async function handleStreamGeneration(
  reply: FastifyReply,
  configManager: ConfigManager,
  promptName: string,
  body: StreamGenerateBody
): Promise<void> {
  if (!body.prompt) {
    reply.code(400).send({ error: 'prompt is required' });
    return;
  }

  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  try {
    const devtool = createDevTool(configManager);
    const maxRounds = body.maxRounds ?? 3;
    const threshold = body.scoreThreshold ?? 4;

    let lastOutput: AgentOutput | undefined;
    let lastReview: ReviewReport | undefined;

    for (let round = 0; round < maxRounds; round++) {
      writeSSE(reply, 'devtool:round-start', { round, maxRounds });

      const { runner, state: initialState } = await getRunner(devtool, promptName);

      let userMessage = body.prompt!;
      if (body.existingContent) {
        userMessage += `\n\n## Existing Content\n\n\`\`\`markdown\n${body.existingContent}\n\`\`\``;
      }
      let state = addUserMessage(initialState, userMessage);

      // Feed back previous round output + review for iterative refinement
      if (round > 0 && lastOutput && lastReview) {
        state = addAssistantMessage(state, JSON.stringify(lastOutput));
        state = addUserMessage(state, buildReviewFeedback(lastReview));
      }

      const finalState = await streamRunner(reply, runner, state);

      const raw = finalState ? getLastAssistantContent(finalState) : '';
      try {
        lastOutput = parseAgentOutput(raw);
      } catch {
        lastOutput = { changes: [], summary: raw };
      }

      writeSSE(reply, 'devtool:generation-done', { output: lastOutput });

      if (maxRounds <= 1 || round === maxRounds - 1) break;

      // Run reviewer
      writeSSE(reply, 'devtool:review-start', { round });
      const { runner: reviewRunner, state: reviewState } = await devtool.createReviewerRunner();
      const reviewPrompt = `Review the following generated content:\n\n${JSON.stringify(lastOutput, null, 2)}`;
      const reviewInitState = addUserMessage(reviewState, reviewPrompt);
      const reviewFinalState = await streamRunner(reply, reviewRunner, reviewInitState);

      const reviewRaw = reviewFinalState ? getLastAssistantContent(reviewFinalState) : '';
      let passed = false;
      try {
        lastReview = parseReviewReport(reviewRaw);
        passed = reviewPasses(lastReview, threshold);
      } catch {
        // Assume pass on parse failure to avoid infinite loop
        passed = true;
      }

      writeSSE(reply, 'devtool:review-done', { report: lastReview, passed });
      if (passed) break;
    }

    writeSSE(reply, 'devtool:complete', { output: lastOutput, review: lastReview });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    writeSSE(reply, 'devtool:error', { message });
  } finally {
    reply.raw.end();
  }
}

async function handleStreamReview(
  reply: FastifyReply,
  configManager: ConfigManager,
  content: string
): Promise<void> {
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  try {
    const devtool = createDevTool(configManager);
    const { runner, state: initialState } = await devtool.createReviewerRunner();
    const state = addUserMessage(initialState, content);
    const finalState = await streamRunner(reply, runner, state);

    const raw = finalState ? getLastAssistantContent(finalState) : '';
    let report: ReviewReport | undefined;
    try {
      report = parseReviewReport(raw);
    } catch {
      report = undefined;
    }

    writeSSE(reply, 'devtool:complete', { report });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    writeSSE(reply, 'devtool:error', { message });
  } finally {
    reply.raw.end();
  }
}

async function getRunner(
  devtool: DevTool,
  promptName: string
): Promise<{ runner: EnhancedRunner; state: AgentState }> {
  switch (promptName) {
    case 'architect':
      return devtool.createArchitectRunner();
    case 'skill-designer':
      return devtool.createSkillDesignerRunner();
    case 'crew-composer':
      return devtool.createCrewComposerRunner();
    default:
      throw new Error(`Unknown prompt: ${promptName}`);
  }
}

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
