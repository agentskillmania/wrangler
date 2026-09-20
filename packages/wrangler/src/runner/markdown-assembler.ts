/**
 * @fileoverview Markdown-structured Message Assembler
 *
 * Produces a well-structured markdown document as the system prompt,
 * with proper heading hierarchy. Replaces the flat-text output of
 * colts' DefaultMessageAssembler.
 *
 * Prefix-cache design (R2P-101w, aligned with Rust 5120a3e/5e238bc/1f08b1f):
 * - Static prefix: optional system prompt + instructions + skill catalog +
 *   sub-agents + thinking — NO timestamp. A minute-level time line in the
 *   header invalidated the provider prefix cache on every >1min request gap.
 * - Dynamic content (time line + todolist) is computed fresh per build and
 *   appended as a STANDALONE trailing user message wrapped in
 *   `<system-reminder>`. It is the only non-replayed content per turn, so it
 *   only costs its own few dozen tokens; suffixing it into the last persisted
 *   user message was a breakpoint (that message is replayed verbatim next
 *   turn).
 * - Legacy `system-reminder` rows (persisted by the old daemon between Rust
 *   5120a3e and 1f08b1f; no longer written) merge byte-stably into the
 *   preceding user message's `<system-reminder>` tail so old-session prefixes
 *   keep hitting the cache. Persisted originals are never mutated.
 * - Skill instructions persist in history via load_skill tool results, so they
 *   are NOT re-injected as a dynamic reminder.
 * - Same-turn thoughts (after last user message) included; cross-turn skipped.
 */

import {
  compareByCodeUnit,
  type AgentState,
  type BuildMessagesOptions,
  type IMessageAssembler,
} from '@agentskillmania/colts';
import { contentToPlainText } from '@agentskillmania/llm-client';
import type { Message as PiAIMessage, TextContent, ToolCall } from '@mariozechner/pi-ai';

import { shiftHeadings } from './shift-headings.js';
import { buildTimeLine } from './system-prompt.js';
import type { SubAgentConfig } from '../subagent/types.js';

/** Status-to-checkbox mapping for todolist display */
const STATUS_CHECK: Record<string, string> = {
  pending: '[ ]',
  in_progress: '[~]',
  completed: '[x]',
};

// compareByCodeUnit now comes from colts' barrel (0.5.0-alpha.2): the
// sub-agent catalog feeds the provider prefix cache, and `localeCompare`
// collation is host/locale-dependent — two machines could enumerate the same
// set differently and invalidate the cache wholesale. The engine comparator is
// host-independent code-unit order. (R2P-101w / E-表 barrel 补口.)

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
            // R2P-107：多模态 parts 原样透传（file: 引用形态也放行——
            // calling-llm 发 LLM 前才物化为内联 base64）。pi-ai 的类型
            // 不建模 ref 形态，这里是刻意的边界 cast：物化器保证 ref
            // 不会真的到达 wire。
            content: msg.content as Extract<PiAIMessage, { role: 'user' }>['content'],
            timestamp: msg.timestamp ?? Date.now(),
          });
          break;

        case 'assistant': {
          // 多模态 parts 按降级纯文本（assistant 行实际恒为 string——防御性）
          const content: (TextContent | ToolCall)[] = [
            { type: 'text', text: contentToPlainText(msg.content) },
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
            content: [{ type: 'text', text: contentToPlainText(msg.content) }],
            isError: contentToPlainText(msg.content).startsWith('Error:'),
            timestamp: msg.timestamp ?? Date.now(),
          });
          break;

        case 'system': {
          if (msg.type === 'system-reminder') {
            // 存量兼容(legacy):旧版 daemon 每轮落盘的时间上下文行,daemon 已
            // 停写 —— 此分支仅服务已有落盘行的旧会话,按原样合并进前一条
            // user 消息的 <system-reminder> 尾巴(位置与内容逐字节稳定,旧
            // 前缀缓存照常命中)。落盘原文不动——合并只发生在请求构建物上。
            const wrapped = '\n\n---\n<system-reminder>\n' + msg.content + '\n</system-reminder>';
            const lastIdx = messages.length - 1;
            const last = messages[lastIdx];
            if (last && last.role === 'user') {
              if (typeof last.content === 'string') {
                messages[lastIdx] = { ...last, content: last.content + wrapped };
              } else {
                messages[lastIdx] = {
                  ...last,
                  content: [...last.content, { type: 'text' as const, text: wrapped }],
                };
              }
            } else {
              // 防御:reminder 行不在 user 消息之后(异常历史)——独立成一条
              // user 消息,不并入无关消息。
              messages.push({
                role: 'user',
                content: wrapped.replace(/^\n\n---\n/, ''),
                timestamp: msg.timestamp ?? Date.now(),
              });
            }
          }
          // 普通 System 标记行(压缩/换模型)已折进系统文档,跳过。
          break;
        }
      }
    }

    // -- Dynamic context injection --
    // 动态提醒(时间 + todo list)一律独立成尾部的 user 消息(恒有)。
    // 曾经的实现把 reminder suffix 进最后一条 user 消息的正文 —— 那条消息
    // 落盘是原文,下一轮请求时前缀就在它身上断掉。独立尾部消息只损耗提醒
    // 块自身的几十 token(它是每轮唯一非回放内容),轮内的工具调用/结果段
    // 全部保住。时间行位于此(缓存断点之后),分钟级变化同样无害。
    const reminder = this.buildDynamicReminder(state);
    messages.push({
      role: 'user',
      content: '<system-reminder>\n' + reminder + '\n</system-reminder>',
      timestamp: now,
    });

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

    // Start with the system prompt (runner-provided static prefix — the header
    // carries NO time context; time lives in the tail dynamic reminder)
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
    // 枚举序是前缀缓存的结构属性:Map 迭代序跟随插入序,两次构建/两个进程
    // 可能不同。按 name 的 UTF-16 code unit 排序(跨构建跨实例确定性,
    // 对齐 Rust 5e238bc 的目录排序)。
    if (this.subAgentConfigs && this.subAgentConfigs.size > 0) {
      const subAgentLines = Array.from(this.subAgentConfigs.values())
        .sort((a, b) => compareByCodeUnit(a.name, b.name))
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
   * Build `<system-reminder>` content from dynamic state: the current time is
   * always the first line, the todolist follows as a `## Task List` section.
   *
   * The time line is carried unconditionally (time awareness does not depend
   * on the todolist feature being enabled); with todo disabled
   * (`todoList` undefined on the context) only the time line is returned.
   * When the list exists but is empty, a one-line usage nudge is injected —
   * an empty list would otherwise leave the model unaware the task system
   * exists ("never calls it → list stays empty" deadlock); the real list
   * renders again after the first successful write.
   *
   * The active skill is intentionally NOT injected here. Skill instructions
   * persist in conversation history as load_skill tool results, so a dynamic
   * reminder would only duplicate them and waste tokens.
   *
   * (Byte-aligned with Rust `build_dynamic_reminder`.)
   */
  private buildDynamicReminder(state: AgentState): string {
    const sections: string[] = [`Time: ${buildTimeLine()}`];

    const todoList = (state.context as unknown as Record<string, unknown>).todoList as
      | { items: Array<{ id: number; subject: string; status: string }> }
      | undefined;
    if (todoList) {
      if (!todoList.items || todoList.items.length === 0) {
        // 与 Rust 冰破行同构;工具名按 TS 侧实际注册名(rust 侧是
        // todolist_write)——指向不存在的工具名会让引导失效。
        sections.push(
          '## Task List\n(no tasks yet — for multi-step work, create tasks with the todolist tool)'
        );
      } else {
        const lines = todoList.items.map(
          (i) => `- ${STATUS_CHECK[i.status] ?? '[ ]'} ${i.id}. ${i.subject}`
        );
        sections.push('## Task List\n' + lines.join('\n'));
      }
    }

    return sections.join('\n\n');
  }
}
