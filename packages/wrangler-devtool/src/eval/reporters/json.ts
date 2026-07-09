/**
 * @fileoverview JSON reporter — structured output for programmatic consumption.
 */

import type { EvalReport } from '../types.js';

/**
 * Serialize an eval report as a JSON string.
 */
export function formatJsonReport(report: EvalReport): string {
  return JSON.stringify(report, null, 2);
}
