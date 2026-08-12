/**
 * @fileoverview wrangler-daemon core layer — transport-agnostic session management.
 *
 * Zero Fastify dependency. Safe to import from browser extensions or any non-HTTP
 * host. The Fastify HTTP layer lives in ../daemon.ts and ../routes/*.ts.
 *
 * Usage (extension / non-HTTP host):
 * ```ts
 * import { AgentSession, type DaemonConfig } from '@agentskillmania/wrangler-daemon/core';
 * const session = await AgentSession.create(opts, config);
 * for await (const sse of session.handleMessage(msg)) { ... }
 * ```
 */

export { AgentSession, mergeSandboxConfig } from './agent-session.js';
export type {
  AgentSessionOptions,
  AgentSessionResumeOptions,
} from './agent-session.js';

export type { DaemonConfig, SSEEvent } from '../types.js';
export { DEFAULT_CONFIG } from '../types.js';
