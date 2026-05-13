import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const EXECUTE_PLAN_CONTENT = readFileSync(join(__dirname, 'execute-plan.md'), 'utf-8');
