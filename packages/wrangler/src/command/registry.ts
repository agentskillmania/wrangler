import type { CommandHandler } from './types.js';

/**
 * Registry for command handlers with case-insensitive lookup.
 *
 * Provides registration and resolution of command handlers by name.
 * Command names are stored in lowercase for case-insensitive matching.
 * Later registrations with the same name override earlier ones,
 * allowing custom commands to override built-in commands.
 */
export class CommandRegistry {
  private handlers = new Map<string, CommandHandler>();

  /**
   * Register a command handler.
   * @param handler - The command handler to register
   */
  register(handler: CommandHandler): void {
    this.handlers.set(handler.name.toLowerCase(), handler);
  }

  /**
   * Resolve a command handler by name (case-insensitive).
   * @param name - The command name to resolve
   * @returns The matching handler, or undefined if not found
   */
  resolve(name: string): CommandHandler | undefined {
    return this.handlers.get(name.toLowerCase());
  }

  /**
   * Get all registered command handlers.
   * @returns Array of all registered handlers
   */
  list(): CommandHandler[] {
    return [...this.handlers.values()];
  }
}
