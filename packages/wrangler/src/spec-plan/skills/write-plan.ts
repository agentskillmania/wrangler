import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const WRITE_PLAN_CONTENT = readFileSync(join(__dirname, 'write-plan', 'SKILL.md'), 'utf-8');
