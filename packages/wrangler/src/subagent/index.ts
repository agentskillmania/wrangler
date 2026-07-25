/**
 * @fileoverview Sub-agent module
 *
 * Exports sub-agent type definitions and the delegate tool factory.
 * Sub-agent delegation is a wrangler concern: the delegate tool creates
 * fresh SubAgentRunner instances (trimmed EnhancedRunner) per delegation.
 */

export type { SubAgentConfig, DelegateResult } from './types.js';
export { DEFAULT_SUBAGENT_MAX_STEPS } from './types.js';
export { createDelegateTool } from './delegate-tool.js';
export type { DelegateToolDeps } from './delegate-tool.js';
