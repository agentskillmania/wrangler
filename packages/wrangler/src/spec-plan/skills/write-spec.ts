import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const WRITE_SPEC_CONTENT = readFileSync(join(__dirname, 'write-spec', 'SKILL.md'), 'utf-8');
