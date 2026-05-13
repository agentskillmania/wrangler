import yaml from 'js-yaml';
import type { AgentDefinition, AgentMeta } from './types.js';

/**
 * Parse an agent .md file into AgentDefinition.
 * Layer 6's CrewLoader reuses this to parse agents/*.md files.
 */
export function parseAgentMd(content: string, fallbackName?: string): AgentDefinition {
  const trimmed = content.trim();

  if (!trimmed.startsWith('---')) {
    return {
      meta: { name: fallbackName ?? 'unknown' },
      instructions: trimmed,
    };
  }

  const secondDash = trimmed.indexOf('---', 4);
  if (secondDash === -1) {
    return {
      meta: { name: fallbackName ?? 'unknown' },
      instructions: trimmed,
    };
  }

  const yamlStr = trimmed.slice(4, secondDash);
  const body = trimmed.slice(secondDash + 3).trim();

  try {
    const meta = yaml.load(yamlStr, { schema: yaml.DEFAULT_SCHEMA }) as AgentMeta;
    if (!meta.name) {
      meta.name = fallbackName ?? 'unknown';
    }
    return { meta, instructions: body };
  } catch {
    return {
      meta: { name: fallbackName ?? 'unknown' },
      instructions: body,
    };
  }
}
