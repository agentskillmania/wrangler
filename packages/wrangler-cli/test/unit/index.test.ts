import { describe, it, expect } from 'vitest';
import { App } from '../../src/components/app.js';
import { detectMode } from '../../src/detect-mode.js';

describe('@agentskillmania/wrangler-cli', () => {
  it('should export App component', () => {
    expect(App).toBeDefined();
    expect(typeof App).toBe('function');
  });

  it('should export detectMode', () => {
    expect(detectMode).toBeDefined();
    expect(typeof detectMode).toBe('function');
  });
});
