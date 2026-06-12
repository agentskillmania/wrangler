import { describe, it, expect } from 'vitest';
import {
  InteractionContext,
  createInteractionCallbacks,
} from '../../src/context/interaction-context.js';

describe('InteractionContext', () => {
  it('exports context with null default', () => {
    expect(InteractionContext).toHaveProperty('Provider');
    // React context Provider is a stable symbol-keyed object; verify it has the expected shape.
    expect(InteractionContext.Provider).toHaveProperty('$$typeof');
    expect(InteractionContext._currentValue).toBeNull();
  });

  it('createInteractionCallbacks returns askHuman and confirm', () => {
    const callbacks = createInteractionCallbacks();
    expect(typeof callbacks.askHuman).toBe('function');
    expect(typeof callbacks.confirm).toBe('function');
  });

  it('askHuman stub returns empty object', async () => {
    const callbacks = createInteractionCallbacks();
    const result = await callbacks.askHuman({ questions: [] });
    expect(result).toEqual({});
  });

  it('confirm stub returns true', async () => {
    const callbacks = createInteractionCallbacks();
    const result = await callbacks.confirm('test-tool', {});
    expect(result).toBe(true);
  });
});
