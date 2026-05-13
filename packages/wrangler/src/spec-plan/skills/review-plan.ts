import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const REVIEW_PLAN_CONTENT = readFileSync(join(__dirname, 'review-plan.md'), 'utf-8');
