/**
 * Verify the 5 built-in SKILL.md files exist and have valid frontmatter.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const skillsDir = join(srcDir, 'skills');

const EXPECTED_SKILLS = [
  'agent-architect',
  'skill-designer',
  'crew-composer',
  'definition-reviewer',
  'session-curator',
];

function readSkillBody(skillName: string): string {
  const path = join(skillsDir, skillName, 'SKILL.md');
  return readFileSync(path, 'utf-8');
}

/** Parse YAML frontmatter (simple — just extracts name and description). */
function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  const result: { name?: string; description?: string } = {};
  const nameMatch = yaml.match(/^name:\s*(.+)/m);
  if (nameMatch) result.name = nameMatch[1].trim();
  // description may span multiple lines with >- or > prefix
  const descMatch = yaml.match(/^description:\s*>-?\s*\n((?:\s+.+\n?)+)/m);
  if (descMatch) {
    result.description = descMatch[1].trim().replace(/^\s+/gm, '');
  } else {
    const descSingle = yaml.match(/^description:\s*(.+)/m);
    if (descSingle) result.description = descSingle[1].trim();
  }
  return result;
}

describe('Built-in skills', () => {
  it('skills directory exists', () => {
    expect(existsSync(skillsDir)).toBe(true);
  });

  it('has exactly 5 skill subdirectories', () => {
    const dirs = readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(dirs).toEqual([...EXPECTED_SKILLS].sort());
  });

  for (const skillName of EXPECTED_SKILLS) {
    describe(`skill: ${skillName}`, () => {
      it('has SKILL.md file', () => {
        const path = join(skillsDir, skillName, 'SKILL.md');
        expect(existsSync(path)).toBe(true);
      });

      it('has valid frontmatter with name and description', () => {
        const content = readSkillBody(skillName);
        const fm = parseFrontmatter(content);
        expect(fm.name).toBe(skillName);
        expect(fm.description).toBeDefined();
        expect(fm.description!.length).toBeGreaterThan(10);
      });

      it('has non-empty body after frontmatter', () => {
        const content = readSkillBody(skillName);
        const bodyStart = content.indexOf('---', 3);
        const body = content.slice(bodyStart + 3).trim();
        expect(body.length).toBeGreaterThan(100);
      });
    });
  }

  it('generation skills reference definition-reviewer', () => {
    // The three generation skills should instruct the agent to load
    // definition-reviewer for self-review after generation.
    const generationSkills = ['agent-architect', 'skill-designer', 'crew-composer'];
    for (const name of generationSkills) {
      const content = readSkillBody(name);
      expect(content).toContain('definition-reviewer');
      expect(content).toContain('load_skill');
    }
  });
});
