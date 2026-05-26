import { describe, it, expect } from 'vitest';
import { AgentSession } from '../../src/core/agent-session.js';
import type { SSEEvent } from '../../src/types.js';

describe('AgentSession', () => {
  describe('mapEvent', () => {
    it('maps token event', () => {
      const result = AgentSession.mapEvent({ type: 'token', token: 'hello' } as any);
      expect(result).toEqual({ event: 'token', data: { delta: 'hello' } });
    });

    it('maps thinking event', () => {
      const result = AgentSession.mapEvent({ type: 'thinking', content: 'hmm' } as any);
      expect(result).toEqual({ event: 'thinking', data: { content: 'hmm' } });
    });

    it('maps tool:start event', () => {
      const result = AgentSession.mapEvent({
        type: 'tool:start',
        action: { id: 'call-1', tool: 'read_file', arguments: { path: '/tmp/x' } },
      } as any);
      expect(result).toEqual({
        event: 'tool-start',
        data: { id: 'call-1', name: 'read_file', args: { path: '/tmp/x' } },
      });
    });

    it('maps tool:end event with string result', () => {
      const result = AgentSession.mapEvent({
        type: 'tool:end',
        callId: 'call-1',
        result: 'file contents',
      } as any);
      expect(result).toEqual({
        event: 'tool-end',
        data: { callId: 'call-1', result: 'file contents' },
      });
    });

    it('maps tool:end with object result as JSON', () => {
      const result = AgentSession.mapEvent({
        type: 'tool:end',
        callId: 'call-1',
        result: { error: 'not found' },
      } as any);
      expect(result!.event).toBe('tool-end');
      const data = result!.data as { callId: string; result: string };
      expect(data.result).toContain('error');
    });

    it('maps complete event', () => {
      const result = AgentSession.mapEvent({ type: 'complete' } as any);
      expect(result).toEqual({ event: 'done', data: {} });
    });

    it('maps error event', () => {
      const result = AgentSession.mapEvent({ type: 'error', error: new Error('boom') } as any);
      expect(result).toEqual({ event: 'error', data: { message: 'boom' } });
    });

    it('returns null for unknown event type', () => {
      const result = AgentSession.mapEvent({ type: 'unknown_event' } as any);
      expect(result).toBeNull();
    });

    it('maps tools:start (plural) to array of events', () => {
      const result = AgentSession.mapEvent({
        type: 'tools:start',
        actions: [
          { id: 'c1', tool: 'tool_a', arguments: {} },
          { id: 'c2', tool: 'tool_b', arguments: {} },
        ],
      } as any);
      expect(Array.isArray(result)).toBe(true);
      const events = result as SSEEvent[];
      expect(events).toHaveLength(2);
      expect(events[0].event).toBe('tool-start');
    });

    it('maps tools:end (plural) to array of events', () => {
      const result = AgentSession.mapEvent({
        type: 'tools:end',
        results: { c1: 'result-a', c2: 'result-b' },
      } as any);
      expect(Array.isArray(result)).toBe(true);
      const events = result as SSEEvent[];
      expect(events).toHaveLength(2);
      expect(events[0].event).toBe('tool-end');
    });

    it('maps skill:loading event', () => {
      const result = AgentSession.mapEvent({ type: 'skill:loading', name: 'my-skill' } as any);
      expect(result).toEqual({ event: 'skill-loading', data: { name: 'my-skill' } });
    });

    it('maps skill:loaded event', () => {
      const result = AgentSession.mapEvent({
        type: 'skill:loaded',
        name: 'my-skill',
        tokenCount: 500,
      } as any);
      expect(result).toEqual({
        event: 'skill-loaded',
        data: { name: 'my-skill', tokenCount: 500 },
      });
    });

    it('maps skill:start event', () => {
      const result = AgentSession.mapEvent({
        type: 'skill:start',
        name: 'my-skill',
        task: 'do stuff',
      } as any);
      expect(result).toEqual({
        event: 'skill-start',
        data: { name: 'my-skill', task: 'do stuff' },
      });
    });

    it('maps skill:end event', () => {
      const result = AgentSession.mapEvent({
        type: 'skill:end',
        name: 'my-skill',
        result: 'done',
      } as any);
      expect(result).toEqual({ event: 'skill-end', data: { name: 'my-skill', result: 'done' } });
    });

    it('maps subagent:start event', () => {
      const result = AgentSession.mapEvent({
        type: 'subagent:start',
        name: 'helper',
        task: 'assist',
      } as any);
      expect(result).toEqual({ event: 'subagent-start', data: { name: 'helper', task: 'assist' } });
    });

    it('maps subagent:end event', () => {
      const result = AgentSession.mapEvent({
        type: 'subagent:end',
        name: 'helper',
        result: { answer: 'ok', totalSteps: 3, finalState: null },
      } as any);
      expect(result!.event).toBe('subagent-end');
      const data = result!.data as { name: string; result: string };
      expect(data.result).toContain('answer');
    });

    it('maps subagent:end with string result', () => {
      const result = AgentSession.mapEvent({
        type: 'subagent:end',
        name: 'helper',
        result: 'done',
      } as any);
      expect(result).toEqual({ event: 'subagent-end', data: { name: 'helper', result: 'done' } });
    });

    it('maps tools:end with object result', () => {
      const result = AgentSession.mapEvent({
        type: 'tools:end',
        results: { c1: { error: 'fail' }, c2: 'ok' },
      } as any);
      const events = result as SSEEvent[];
      expect(events).toHaveLength(2);
      const objResult = events.find((e) => (e.data as { callId: string }).callId === 'c1');
      expect((objResult!.data as { result: string }).result).toContain('error');
    });
  });

  describe('AgentSessionOptions', () => {
    it('accepts new EnhancedRunner parameters', () => {
      const options: import('../../src/core/agent-session.js').AgentSessionOptions = {
        workspacePath: '/tmp/test',
        agentName: 'test',
        builtinTools: { shell: false, fileRead: true },
        enableSession: false,
        enableTodolist: false,
        enableCommands: true,
        sandbox: false,
        thinkingEnabled: false,
        a2ui: { enabled: true },
      };
      expect(options.builtinTools!.shell).toBe(false);
      expect(options.enableSession).toBe(false);
      expect(options.sandbox).toBe(false);
      expect(options.a2ui!.enabled).toBe(true);
    });
  });
});
