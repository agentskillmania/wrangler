import yaml from 'js-yaml';

export interface ParsedAgent {
  name: string;
  description?: string;
  instructions: string;
  model?: string;
  thinking?: { enabled?: boolean };
  sandbox?: boolean;
}

export function parseAgentMd(content: string, fallbackName?: string): ParsedAgent {
  const trimmed = content.trim();

  if (!trimmed.startsWith('---')) {
    return {
      name: fallbackName ?? 'unknown',
      instructions: trimmed,
    };
  }

  // BUG7 fix: find the closing '---' delimiter on its OWN LINE (not embedded
  // in body text). The old code used indexOf('---', 4) which matched any '---'
  // in the body — a markdown horizontal rule (---) would truncate the
  // instructions. Use a regex anchored to line start with optional trailing
  // whitespace.
  const closeMatch = /^---\s*$/m.exec(trimmed.slice(4));
  if (!closeMatch) {
    return {
      name: fallbackName ?? 'unknown',
      instructions: trimmed,
    };
  }

  // secondDash is the index in the FULL trimmed string
  const secondDash = 4 + closeMatch.index;
  const yamlStr = trimmed.slice(4, secondDash);
  const body = trimmed.slice(secondDash + closeMatch[0].length).trim();

  try {
    const raw = yaml.load(yamlStr, { schema: yaml.DEFAULT_SCHEMA }) as Record<string, unknown>;
    return {
      name: (raw.name as string) ?? fallbackName ?? 'unknown',
      description: raw.description as string | undefined,
      instructions: body,
      model: raw.model as string | undefined,
      thinking: raw.thinking as { enabled?: boolean } | undefined,
      sandbox: raw.sandbox as boolean | undefined,
    };
  } catch {
    return {
      name: fallbackName ?? 'unknown',
      instructions: body,
    };
  }
}
