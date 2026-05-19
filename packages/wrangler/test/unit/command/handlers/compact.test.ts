import { describe, it, expect, vi } from 'vitest';
import { createCompactHandler } from '../../../../src/command/handlers/compact.js';
import { createAgentState } from '@agentskillmania/colts';
import type { RunnerOptions, IContextCompressor, CompressResult } from '@agentskillmania/colts';

const mockRunnerOptions: Readonly<RunnerOptions> = {
  model: 'GLM-4.7',
  maxSteps: 10,
};

/**
 * Create a mock compressor for testing.
 *
 * @param overrides - Override the default compress behavior
 */
function createMockCompressor(overrides?: Partial<IContextCompressor>): IContextCompressor {
  return {
    shouldCompress: vi.fn().mockReturnValue(true),
    compress: vi.fn().mockResolvedValue({
      summary: 'Mock summary',
      anchor: 5,
      removedTokenCount: 100,
      compressedAt: 1234567890,
    } as CompressResult),
    ...overrides,
  };
}

describe('createCompactHandler', () => {
  it('should have name "compact"', () => {
    const handler = createCompactHandler();
    expect(handler.name).toBe('compact');
  });

  it('should have description', () => {
    const handler = createCompactHandler();
    expect(handler.description).toBe('Compress conversation context');
  });

  describe('handle', () => {
    it('should return error when no compressor available', async () => {
      const handler = createCompactHandler();
      const state = createAgentState({
        name: 'test',
        instructions: 'test instructions',
        tools: [],
      });
      const ctx = {
        command: { name: 'compact', body: '' },
        state,
        runnerOptions: mockRunnerOptions,
      };
      const result = await handler.handle(ctx);

      expect(result.handled).toBe(true);
      expect(result.response).toBe('No compressor available.');
      expect(result.state).toBeUndefined();
    });

    it('should call compressor.compress() and return state with compression metadata', async () => {
      const compressor = createMockCompressor();
      const handler = createCompactHandler();
      const state = createAgentState({
        name: 'test',
        instructions: 'test instructions',
        tools: [],
      });
      const ctx = {
        command: { name: 'compact', body: '' },
        state,
        runnerOptions: mockRunnerOptions,
        compressor,
      };
      const result = await handler.handle(ctx);

      expect(compressor.compress).toHaveBeenCalledWith(state);
      expect(result.handled).toBe(true);
      expect(result.state).toBeDefined();
      expect(result.state!.context.compression).toEqual({
        summary: 'Mock summary',
        anchor: 5,
        removedTokenCount: 100,
        compressedAt: 1234567890,
      });
      expect(result.response).toContain('compressed');
      expect(result.response).toContain('Summary generated');
    });

    it('should return "already compact" when anchor does not advance', async () => {
      // State already has anchor at 5, compressor returns anchor 5 → no progress
      const state = createAgentState({
        name: 'test',
        instructions: 'test instructions',
        tools: [],
      });
      const stateWithCompression = {
        ...state,
        context: {
          ...state.context,
          compression: { summary: 'existing', anchor: 5 },
        },
      };
      const compressor = createMockCompressor({
        compress: vi.fn().mockResolvedValue({
          summary: 'existing',
          anchor: 5,
        } as CompressResult),
      });
      const handler = createCompactHandler();
      const ctx = {
        command: { name: 'compact', body: '' },
        state: stateWithCompression,
        runnerOptions: mockRunnerOptions,
        compressor,
      };
      const result = await handler.handle(ctx);

      expect(result.handled).toBe(true);
      expect(result.response).toBe('Context is already compact.');
      expect(result.state).toBeUndefined();
    });

    it('should not mention summary when compressor returns empty summary', async () => {
      const compressor = createMockCompressor({
        compress: vi.fn().mockResolvedValue({
          summary: '',
          anchor: 3,
          removedTokenCount: 50,
          compressedAt: 1234567890,
        } as CompressResult),
      });
      const handler = createCompactHandler();
      const state = createAgentState({
        name: 'test',
        instructions: 'test instructions',
        tools: [],
      });
      const ctx = {
        command: { name: 'compact', body: '' },
        state,
        runnerOptions: mockRunnerOptions,
        compressor,
      };
      const result = await handler.handle(ctx);

      expect(result.response).not.toContain('Summary generated');
    });

    it('should report correct removed count based on anchor diff', async () => {
      const state = createAgentState({
        name: 'test',
        instructions: 'test instructions',
        tools: [],
      });
      // State has existing anchor at 2
      const stateWithCompression = {
        ...state,
        context: {
          ...state.context,
          compression: { summary: 'old', anchor: 2 },
        },
      };
      const compressor = createMockCompressor({
        compress: vi.fn().mockResolvedValue({
          summary: 'new summary',
          anchor: 8,
          summaryTokenCount: 20,
          removedTokenCount: 200,
          compressedAt: 1234567890,
        } as CompressResult),
      });
      const handler = createCompactHandler();
      const ctx = {
        command: { name: 'compact', body: '' },
        state: stateWithCompression,
        runnerOptions: mockRunnerOptions,
        compressor,
      };
      const result = await handler.handle(ctx);

      // 8 - 2 = 6 messages compressed
      expect(result.response).toContain('6 messages compressed');
    });

    it('should preserve state ID and other state fields', async () => {
      const compressor = createMockCompressor();
      const handler = createCompactHandler();
      const state = createAgentState({
        name: 'test-agent',
        instructions: 'original instructions',
        tools: [],
      });
      const originalId = state.id;
      const ctx = {
        command: { name: 'compact', body: '' },
        state,
        runnerOptions: mockRunnerOptions,
        compressor,
      };
      const result = await handler.handle(ctx);

      expect(result.state!.id).toBe(originalId);
      expect(result.state!.config.name).toBe('test-agent');
      expect(result.state!.config.instructions).toBe('original instructions');
    });
  });
});
