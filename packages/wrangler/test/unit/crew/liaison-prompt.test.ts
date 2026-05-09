import { describe, it, expect } from 'vitest';
import { buildLiaisonPrompt } from '../../../src/crew/liaison-prompt.js';

describe('buildLiaisonPrompt', () => {
  it('includes worker type in prompt', () => {
    const prompt = buildLiaisonPrompt({ workerType: 'searcher', memory: 'test memory' });
    expect(prompt).toContain('searcher');
    expect(prompt).toContain('test memory');
  });

  it('includes crew memory', () => {
    const prompt = buildLiaisonPrompt({ workerType: 'dev', memory: 'use strict mode' });
    expect(prompt).toContain('use strict mode');
  });

  it('mentions relay_to_primary tool', () => {
    const prompt = buildLiaisonPrompt({ workerType: 'searcher', memory: '' });
    expect(prompt).toContain('relay_to_primary');
  });

  it('mentions filtering guidance', () => {
    const prompt = buildLiaisonPrompt({ workerType: 'searcher', memory: '' });
    expect(prompt).toContain('relay');
    expect(prompt).toContain('重要');
  });
});
