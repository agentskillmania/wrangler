/**
 * @fileoverview Markdown-structured Message Assembler
 *
 * Produces a well-structured markdown document as the system prompt,
 * with proper heading hierarchy. Replaces the flat-text output of
 * colts' DefaultMessageAssembler.
 *
 * Heading structure:
 * - YAML frontmatter at position 0 (from wrangler's buildTimeContext)
 * - ## Instructions — agent instructions (headings shifted down 2 levels)
 * - ## Available Skills — skill catalog
 * - ## Active Skill — loaded skill content + SKILL MODE guide
 * - ## Sub-Agents — sub-agent catalog
 * - ## Thinking — prompt-level thinking guidance
 */

import type { Message as PiAIMessage, TextContent } from '@mariozechner/pi-ai';
import type { AgentState, SkillState } from '@agentskillmania/colts';
import type { BuildMessagesOptions, IMessageAssembler } from '@agentskillmania/colts';
import { shiftHeadings } from './shift-headings.js';

/**
 * Build skill mode guide based on current skill state
 *
 * Tells the agent how to behave while a skill is active.
 */
function buildSkillGuide(skillState: SkillState | undefined): string | null {
  if (!skillState || !skillState.current) return null;

  return `You are currently executing the '${skillState.current}' skill.

You may switch to another skill at any time using the \`load_skill\` tool.
When you COMPLETE your task, you MUST call the \`return_skill\` tool:
{
  "result": "Your final answer here (be detailed)",
  "status": "success"
}

Rules:
- ALWAYS use return_skill when done — do NOT just respond with text
- You may call load_skill to delegate sub-tasks to specialized skills`;
}

/**
 * MarkdownMessageAssembler — structured markdown system prompt
 *
 * Implements IMessageAssembler from colts. Produces the same LLM message
 * array format as DefaultMessageAssembler, but the system prompt section
 * is a properly structured markdown document with heading hierarchy.
 */
export class MarkdownMessageAssembler implements IMessageAssembler {
  build(state: AgentState, opts: BuildMessagesOptions): PiAIMessage[] {
    const messages: PiAIMessage[] = [];
    const now = Date.now();

    // Build structured markdown system prompt
    const systemDoc = this.buildSystemDocument(state, opts);

    if (systemDoc) {
      messages.push({
        role: 'user',
        content: systemDoc,
        timestamp: now,
      });

      // Fake assistant acknowledgment to maintain conversation flow
      messages.push({
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Understood. I will follow these instructions.',
          },
        ],
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
        stopReason: 'stop',
        timestamp: now,
      });
    }

    // Add conversation history (respecting compression boundary)
    const compression = state.context.compression;
    const startIdx = compression ? compression.anchor : 0;

    // If compressed, inject summary as a system-like user message
    if (compression && compression.summary) {
      messages.push({
        role: 'user',
        content: `[Conversation History Summary]\n${compression.summary}`,
        timestamp: now,
      });
      messages.push({
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Understood. I have the context from our previous conversation.',
          },
        ],
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
        stopReason: 'stop',
        timestamp: now,
      });
    }

    for (let i = startIdx; i < state.context.messages.length; i++) {
      const msg = state.context.messages[i];
      switch (msg.role) {
        case 'user':
          messages.push({
            role: 'user',
            content: msg.content,
            timestamp: msg.timestamp ?? Date.now(),
          });
          break;

        case 'assistant': {
          const content: (TextContent | import('@mariozechner/pi-ai').ToolCall)[] = [
            { type: 'text', text: msg.content },
          ];
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
            isError: false,
            timestamp: msg.timestamp ?? Date.now(),
          });
          break;
      }
    }

    return messages;
  }

  /**
   * Build the structured markdown system document
   *
   * Sections appear only when their content exists.
   * YAML frontmatter is at position 0 (no prefix before it).
   */
  private buildSystemDocument(state: AgentState, opts: BuildMessagesOptions): string | null {
    const sections: string[] = [];

    // Start with system prompt (YAML frontmatter from buildTimeContext)
    if (opts.systemPrompt) {
      sections.push(opts.systemPrompt);
    }

    // Instructions section — headings shifted down 2 levels
    if (state.config.instructions) {
      sections.push(`## Instructions\n\n${shiftHeadings(state.config.instructions, 2)}`);
    }

    // Current Task List section — read directly from state
    const todoList = state.context.todoList;
    if (todoList && todoList.items.length > 0) {
      const statusCheck: Record<string, string> = {
        pending: '[ ]',
        in_progress: '[~]',
        completed: '[x]',
      };
      const lines = todoList.items.map(
        (item) => `- ${statusCheck[item.status] ?? '[ ]'} ${item.id}. ${item.subject}`
      );
      sections.push(
        '## Current Task List\n\n' +
          lines.join('\n') +
          '\n\nWhen you complete a task, use the todolist tool to mark it completed.\n' +
          'If you identify new sub-tasks, add them to the list.'
      );
    }

    // Available Skills section
    if (opts.skillProvider) {
      const skills = opts.skillProvider.listSkills();
      if (skills.length > 0) {
        const skillLines = skills.map((s: { name: string; description: string }) => `- ${s.name}: ${s.description}`).join('\n');
        sections.push(
          `## Available Skills\n\n${skillLines}\n\nUse the load_skill tool to load detailed instructions when needed.`
        );
      }
    }

    // Active Skill section
    const skillState = state.context.skillState;
    if (skillState?.current) {
      const parts: string[] = [];

      if (skillState.loadedInstructions) {
        parts.push(shiftHeadings(skillState.loadedInstructions, 2));
      }

      const guide = buildSkillGuide(skillState);
      if (guide) {
        parts.push(guide);
      }

      if (parts.length > 0) {
        sections.push(`## Active Skill\n\n${parts.join('\n\n')}`);
      }
    }

    // Sub-Agents section
    if (opts.subAgentConfigs && opts.subAgentConfigs.size > 0) {
      const subAgentLines = Array.from(opts.subAgentConfigs.values())
        .map((sa: { name: string; description: string }) => `- ${sa.name}: ${sa.description}`)
        .join('\n');
      sections.push(
        `## Sub-Agents\n\n${subAgentLines}\n\nUse the delegate tool to delegate tasks to specialized sub-agents.`
      );
    }

    // Thinking section
    if (opts.enablePromptThinking) {
      sections.push(
        `## Thinking\n\nBefore answering or using tools, please think step by step inside <thinkki>...</thinkki> tags. After the closing </thinkki> tag, provide your final response or tool calls.`
      );
    }

    if (sections.length === 0) return null;
    return sections.join('\n\n');
  }
}
