import yaml from 'js-yaml';

export interface ParsedAgent {
  name: string;
  description?: string;
  instructions: string;
  model?: string;
  thinking?: { enabled?: boolean };
}

export function parseAgentMd(content: string, fallbackName?: string): ParsedAgent {
  const trimmed = content.trim();

  if (!trimmed.startsWith('---')) {
    return {
      name: fallbackName ?? 'unknown',
      instructions: trimmed,
    };
  }

  const secondDash = trimmed.indexOf('---', 4);
  if (secondDash === -1) {
    return {
      name: fallbackName ?? 'unknown',
      instructions: trimmed,
    };
  }

  const yamlStr = trimmed.slice(4, secondDash);
  const body = trimmed.slice(secondDash + 3).trim();

  try {
    const raw = yaml.load(yamlStr, { schema: yaml.DEFAULT_SCHEMA }) as Record<string, unknown>;
    return {
      name: (raw.name as string) ?? fallbackName ?? 'unknown',
      description: raw.description as string | undefined,
      instructions: body,
      model: raw.model as string | undefined,
      thinking: raw.thinking as { enabled?: boolean } | undefined,
    };
  } catch {
    return {
      name: fallbackName ?? 'unknown',
      instructions: body,
    };
  }
}
