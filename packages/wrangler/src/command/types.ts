import type { AgentState, RunnerOptions } from '@agentskillmania/colts';

/** Parsed command structure */
export interface ParsedCommand {
  /** Command name without slash, e.g. "skill" */
  name: string;
  /** Target after colon, e.g. "code-review" from "/skill:code-review" */
  target?: string;
  /** Message body after command */
  body: string;
}

/** Context passed to command handlers */
export interface CommandContext {
  command: ParsedCommand;
  state: AgentState;
  runnerOptions: RunnerOptions;
}

/** Result returned by command handlers */
export interface CommandResult {
  /** true = command fully handled, stop execution */
  handled: boolean;
  /** Modified state (optional) */
  state?: AgentState;
  /** Response text shown to user (optional, used when handled=true) */
  response?: string;
}

/** A command handler definition */
export interface CommandHandler {
  /** Command name to match, e.g. "skill" */
  name: string;
  /** One-line description for help listing */
  description: string;
  /** Handle the command */
  handle(ctx: CommandContext): Promise<CommandResult>;
}
