import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const WRITING_PLAN_CONTENT = readFileSync(join(__dirname, 'writing-plan.md'), 'utf-8');
