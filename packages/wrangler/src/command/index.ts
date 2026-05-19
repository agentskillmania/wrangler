/**
 * Command system for wrangler.
 *
 * Provides command parsing, type definitions, and handler interfaces
 * for implementing slash commands like /clear, /skills, /skill:name, etc.
 */

export type { CommandContext, CommandHandler, CommandResult, ParsedCommand } from './types.js';
export { parseCommand } from './parser.js';
export { CommandRegistry } from './registry.js';
export { createCommandMiddleware } from './command-middleware.js';
export { createClearHandler } from './handlers/clear.js';
export { createCompactHandler } from './handlers/compact.js';
export { createSkillsHandler } from './handlers/skills.js';
export { createSkillHandler } from './handlers/skill.js';
