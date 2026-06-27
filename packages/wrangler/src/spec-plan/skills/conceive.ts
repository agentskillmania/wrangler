import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const CONCEIVE_CONTENT = readFileSync(join(__dirname, 'conceive', 'SKILL.md'), 'utf-8');
