/**
 * @fileoverview Markdown-structured Message Assembler
 *
 * Produces a well-structured markdown document as the system prompt,
 * with proper heading hierarchy. Replaces the flat-text output of
 * colts' DefaultMessageAssembler.
 *
 * KV-cache design:
 * - Static prefix: YAML frontmatter + instructions + skill catalog + sub-agents + thinking
 * - Dynamic content (todolist): injected as <system-reminder>
 *   into the last user message, keeping the static prefix stable for caching
 * - Skill instructions persist in history via load_skill tool results, so they
 *   are NOT re-injected as a dynamic reminder
 * - Same-turn thoughts (after last user message) included; cross-turn skipped
 */

import type {
  AgentState,
  BuildMessagesOptions,
  IMessageAssembler,
} from '@agentskillmania/colts';
import type { Message as PiAIMessage, TextContent, ToolCall } from '@mariozechner/pi-ai';

import { shiftHeadings } from './shift-headings.js';
import type { SubAgentConfig } from '../subagent/types.js';

/** Status-to-checkbox mapping for todolist display */
const STATUS_CHECK: Record<string, string> = {
  pending: '[ ]',
  in_progress: '[~]',
  completed: '[x]',
};

/**
 * MarkdownMessageAssembler -- structured markdown system prompt
 *
 * Implements IMessageAssembler from colts. Produces the same LLM message
 * array format as DefaultMessageAssembler, but the system prompt section
 * is a properly structured markdown document with heading hierarchy.
 */
export class MarkdownMessageAssembler implements IMessageAssembler {
  /** Sub-agent configs injected into the static system document (constructor-scoped) */
  private subAgentConfigs?: ReadonlyMap<string, SubAgentConfig>;

  /**
   * @param subAgentConfigs - Optional sub-agent config map. When provided,
   *   the sub-agent list is injected into the static system document.
   *   This is constructor-scoped (not per-build) because sub-agents don't
   *   change within a session, keeping the static prefix cache-friendly.
   */
  constructor(subAgentConfigs?: ReadonlyMap<string, SubAgentConfig>) {
    this.subAgentConfigs = subAgentConfigs;
  }

  async build(state: AgentState, opts: BuildMessagesOptions): Promise<PiAIMessage[]> {
    const messages: PiAIMessage[] = [];
    const now = Date.now();

    // -- Static prefix --
    const systemDoc = await this.buildSystemDocument(state, opts);

    if (systemDoc) {
      messages.push({
        role: 'user',
        content: systemDoc,
        timestamp: now,
      });

      messages.push(this.createFakeAck(opts.model, now));
    }

    // -- Compression summary --
    const compression = state.context.compression;
    const startIdx = compression ? compression.anchor : 0;

    if (compression && compression.summary) {
      messages.push({
        role: 'user',
        content: `[Conversation History Summary]\n${compression.summary}`,
        timestamp: now,
      });
      messages.push(this.createFakeAck(opts.model, now));
    }

    // -- Turn boundary scan --
    // Find the last user message index for same-turn thought handling.
    // Thoughts after this index are same-turn (include); at or before are cross-turn (skip).
    let lastUserMsgIdx = -1;
    for (let i = startIdx; i < state.context.messages.length; i++) {
      if (state.context.messages[i].role === 'user') {
        lastUserMsgIdx = i;
      }
    }

    // -- Conversation history --
    for (let i = startIdx; i < state.context.messages.length; i++) {
      const msg = state.context.messages[i];

      // Skip cross-turn thought messages -- old reasoning is irrelevant and wastes tokens.
      // Same-turn thoughts (after last user message) fall through to the assistant handler
      // so the LLM retains its own reasoning context during tool chains.
      if (msg.role === 'assistant' && msg.type === 'thought') {
        if (i <= lastUserMsgIdx) {
          continue; // Cross-turn: skip
        }
        // Same-turn: fall through to normal assistant message conversion
      }

      switch (msg.role) {
        case 'user':
          messages.push({
            role: 'user',
            content: msg.content,
            timestamp: msg.timestamp ?? Date.now(),
          });
          break;

        case 'assistant': {
          const content: (TextContent | ToolCall)[] = [{ type: 'text', text: msg.content }];
          if (msg.toolCalls && msg.toolCalls.length > 0) {
            for (const tc of msg.toolCalls) {
              content.push({
                type: 'toolCall',
                id: tc.id,
                name: tc.name,
                arguments: tc.arguments,
              });
            }
          }
          messages.push({
            role: 'assistant',
            content,
            api: 'openai-completions',
            provider: 'openai',
            model: opts.model,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
            stopReason: msg.toolCalls && msg.toolCalls.length > 0 ? 'toolUse' : 'stop',
            timestamp: msg.timestamp ?? Date.now(),
          });
          break;
        }

        case 'tool':
          messages.push({
            role: 'toolResult',
            toolCallId: msg.toolCallId ?? 'unknown',
            toolName: msg.toolName ?? 'unknown',
            content: [{ type: 'text', text: msg.content }],
            isError: msg.content.startsWith('Error:'),
            timestamp: msg.timestamp ?? Date.now(),
          });
          break;
      }
    }

    // -- Dynamic context injection --
    const reminder = this.buildDynamicReminder(state);
    if (reminder && messages.length > 0) {
      const lastIdx = messages.length - 1;
      const last = messages[lastIdx];
      if (last.role === 'user') {
        if (typeof last.content === 'string') {
          messages[lastIdx] = {
            ...last,
            content:
              last.content + '\n\n---\n<system-reminder>\n' + reminder + '\n</system-reminder>',
          };
        } else {
          messages[lastIdx] = {
            ...last,
            content: [
              ...last.content,
              {
                type: 'text' as const,
                text: '\n\n---\n<system-reminder>\n' + reminder + '\n</system-reminder>',
              },
            ],
          };
        }
      } else {
        messages.push({
          role: 'user',
          content: '<system-reminder>\n' + reminder + '\n</system-reminder>',
          timestamp: now,
        });
      }
    }

    return messages;
  }

  /**
   * Create a fake assistant acknowledgment
   */
  private createFakeAck(model: string, timestamp: number): PiAIMessage {
    return {
      role: 'assistant',
      content: [{ type: 'text', text: 'Understood. I will follow these instructions.' }],
      api: 'openai-completions',
      provider: 'openai',
      model,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: 'stop',
      timestamp,
    };
  }

  /**
   * Build the structured markdown system document
   *
   * Contains ONLY static content for KV-cache friendliness.
   * Dynamic content (todolist) is in buildDynamicReminder().
   */
  private async buildSystemDocument(
    state: AgentState,
    opts: BuildMessagesOptions
  ): Promise<string | null> {
    const sections: string[] = [];

    // Start with system prompt (YAML frontmatter from buildTimeContext)
    if (opts.systemPrompt) {
      sections.push(opts.systemPrompt);
    }

    // Instructions section -- headings shifted down 2 levels
    if (state.config.instructions) {
      sections.push(`## Instructions\n\n${shiftHeadings(state.config.instructions, 2)}`);
    }

    // Available Skills section
    if (opts.skillProvider) {
      const skills = await opts.skillProvider.listSkills();
      if (skills.length > 0) {
        const skillLines = skills
          .map((s: { name: string; description: string }) => `- ${s.name}: ${s.description}`)
          .join('\n');
        sections.push(
          `## Available Skills\n\n${skillLines}\n\nUse the load_skill tool to load detailed instructions when needed.`
        );
      }
    }

    // Sub-Agents section
    if (this.subAgentConfigs && this.subAgentConfigs.size > 0) {
      const subAgentLines = Array.from(this.subAgentConfigs.values())
        .map((sa) => `- ${sa.name}: ${sa.description}`)
        .join('\n');
      sections.push(
        `## Sub-Agents\n\n${subAgentLines}\n\nUse the delegate tool to delegate tasks to specialized sub-agents.`
      );
    }

    // Thinking section
    if (opts.enablePromptThinking) {
      sections.push(
        `## Thinking\n\nBefore answering or using tools, please think step by step inside <think>...</think> tags. After the closing </think> tag, provide your final response or tool calls.`
      );
    }

    if (sections.length === 0) return null;
    return sections.join('\n\n');
  }

  /**
   * Build <system-reminder> content from dynamic state
   *
   * @returns Formatted reminder text, or null if no dynamic content exists
   */
  private buildDynamicReminder(state: AgentState): string | null {
    const parts: string[] = [];

    const todoList = (state.context as unknown as Record<string, unknown>).todoList as
      | { items: Array<{ id: number; subject: string; status: string }> }
      | undefined;
    if (todoList?.items?.length) {
      const lines = todoList.items.map(
        (i) => `- ${STATUS_CHECK[i.status] ?? '[ ]'} ${i.id}. ${i.subject}`
      );
      parts.push('## Task List\n' + lines.join('\n'));
    }

    // Active skill is intentionally NOT injected here. Skill instructions now
    // persist in conversation history as load_skill tool results, so a dynamic
    // reminder would only duplicate them and waste tokens.

    return parts.length > 0 ? parts.join('\n\n') : null;
  }
}
