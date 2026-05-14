import { describe, it, expect } from 'vitest';
import { InteractionContext, createInteractionCallbacks } from '../../src/context/interaction-context.js';

describe('InteractionContext', () => {
  it('exports context with null default', () => {
    expect(InteractionContext).toBeDefined();
    expect(InteractionContext.Provider).toBeDefined();
    expect(InteractionContext._currentValue).toBeNull();
  });

  it('createInteractionCallbacks returns askHuman and confirm', () => {
    const callbacks = createInteractionCallbacks();
    expect(typeof callbacks.askHuman).toBe('function');
    expect(typeof callbacks.confirm).toBe('function');
  });

  it('askHuman stub returns empty string', async () => {
    const callbacks = createInteractionCallbacks();
    const result = await callbacks.askHuman({ question: 'test' });
    expect(result).toBe('');
  });

  it('confirm stub returns true', async () => {
    const callbacks = createInteractionCallbacks();
    const result = await callbacks.confirm('test-tool', {});
    expect(result).toBe(true);
  });
});
