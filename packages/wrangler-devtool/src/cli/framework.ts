// packages/wrangler-devtool/src/cli/framework.ts
// 轻量级命令注册与解析框架（无外部依赖）

import { CliError, ExitCode } from './options.js';

export interface CliOptionDef {
  type: 'string' | 'boolean' | 'number';
  required?: boolean;
  default?: unknown;
  description?: string;
}

export interface CliCommandDef {
  name: string;
  description: string;
  args?: string;
  options?: Record<string, CliOptionDef>;
  subcommands?: Record<string, CliCommandDef>;
  handler?: (args: string[], options: Record<string, unknown>) => Promise<number>;
}

export function defineCommand(def: CliCommandDef): CliCommandDef {
  return def;
}

interface ParseResult {
  args: string[];
  options: Record<string, unknown>;
}

function kebabToCamel(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function parseRawArgs(argv: string[]): ParseResult {
  const args: string[] = [];
  const options: Record<string, unknown> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      args.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = kebabToCamel(arg.slice(2, eqIdx));
        options[key] = arg.slice(eqIdx + 1);
      } else {
        const key = kebabToCamel(arg.slice(2));
        if (key.startsWith('no') && key.length > 2 && key[2] === key[2].toUpperCase()) {
          options[key.slice(2, 3).toLowerCase() + key.slice(3)] = false;
        } else {
          const next = argv[i + 1];
          if (next !== undefined && !next.startsWith('-')) {
            options[key] = next;
            i++;
          } else {
            options[key] = true;
          }
        }
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      const key = arg.slice(1);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        options[key] = next;
        i++;
      } else {
        options[key] = true;
      }
    } else {
      args.push(arg);
    }
  }

  return { args, options };
}

function validateOptions(
  options: Record<string, unknown>,
  defs: Record<string, CliOptionDef> = {},
  commandPath: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const [key, def] of Object.entries(defs)) {
    const value = options[key];

    if (value === undefined) {
      if (def.required) {
        errors.push(`Missing required option: --${key}`);
      } else if (def.default !== undefined) {
        result[key] = def.default;
      }
      continue;
    }

    if (def.type === 'boolean') {
      result[key] = Boolean(value);
    } else if (def.type === 'number') {
      const num = Number(value);
      if (Number.isNaN(num)) {
        errors.push(`Option --${key} must be a number, got: ${value}`);
      } else {
        result[key] = num;
      }
    } else {
      result[key] = String(value);
    }
  }

  for (const key of Object.keys(options)) {
    if (!(key in defs)) {
      errors.push(`Unknown option: --${key}`);
    }
  }

  if (errors.length > 0) {
    throw new CliError(errors.join('\n'), 'INVALID_OPTIONS', ExitCode.GeneralError);
  }

  return result;
}

function getUsage(command: CliCommandDef, path: string[]): string {
  const name = path.join(' ');
  let usage = `Usage: ${name}`;
  if (command.args) {
    usage += ` ${command.args}`;
  }
  if (command.options && Object.keys(command.options).length > 0) {
    const opts = Object.entries(command.options)
      .map(([k, v]) => {
        const req = v.required ? '' : '?';
        return `--${k} <${v.type}>${req}`;
      })
      .join(' ');
    usage += ` [${opts}]`;
  }
  return usage;
}

function getHelp(command: CliCommandDef, path: string[]): string {
  const lines: string[] = [];
  lines.push(getUsage(command, path));
  lines.push('');
  lines.push(command.description);

  if (command.options && Object.keys(command.options).length > 0) {
    lines.push('');
    lines.push('Options:');
    for (const [key, def] of Object.entries(command.options)) {
      const req = def.required ? ' (required)' : '';
      const defStr = def.default !== undefined ? ` (default: ${def.default})` : '';
      lines.push(`  --${key} <${def.type}>${req}${defStr}  ${def.description ?? ''}`);
    }
  }

  if (command.subcommands && Object.keys(command.subcommands).length > 0) {
    lines.push('');
    lines.push('Subcommands:');
    for (const [key, sub] of Object.entries(command.subcommands)) {
      lines.push(`  ${key}  ${sub.description}`);
    }
  }

  return lines.join('\n');
}

interface RouteResult {
  handler: (args: string[], options: Record<string, unknown>) => Promise<number>;
  commandPath: string[];
  remainingArgs: string[];
  commandDef: CliCommandDef;
}

function routeCommand(
  commands: Record<string, CliCommandDef>,
  args: string[]
): RouteResult | null {
  if (args.length === 0) return null;

  const rootName = args[0];
  const root = commands[rootName];
  if (!root) return null;

  let current = root;
  const path = [rootName];
  let i = 1;

  while (i < args.length && current.subcommands) {
    const subName = args[i];
    const sub = current.subcommands[subName];
    if (!sub) break;
    current = sub;
    path.push(subName);
    i++;
  }

  if (!current.handler) return null;

  return {
    handler: current.handler,
    commandPath: path,
    remainingArgs: args.slice(i),
    commandDef: current,
  };
}

function validateArgs(args: string[], def: CliCommandDef, commandPath: string[]): void {
  if (!def.args) return;

  const tokens = def.args.trim().split(/\s+/);
  const required = tokens.filter((t) => t.startsWith('<') && t.endsWith('>')).length;
  const optional = tokens.filter((t) => t.startsWith('[') && t.endsWith(']')).length;

  if (args.length < required) {
    throw new CliError(
      `Missing required arguments. ${getUsage(def, commandPath)}`,
      'MISSING_ARGS',
      ExitCode.GeneralError
    );
  }

  if (args.length > required + optional) {
    throw new CliError(
      `Too many arguments. ${getUsage(def, commandPath)}`,
      'TOO_MANY_ARGS',
      ExitCode.GeneralError
    );
  }
}

function getHelpForRoot(commands: Record<string, CliCommandDef>): string {
  const lines: string[] = ['wrangler-devtool', '', 'Commands:'];
  for (const [name, cmd] of Object.entries(commands)) {
    lines.push(`  ${name}  ${cmd.description}`);
  }
  lines.push('');
  lines.push('Use --help with any command for more information.');
  return lines.join('\n');
}

export async function runCli(
  commands: Record<string, CliCommandDef>,
  argv: string[]
): Promise<number> {
  let commandPath: string[] = [];

  try {
    if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
      console.log(getHelpForRoot(commands));
      return ExitCode.Success;
    }

    const { args: rawArgs, options: rawOptions } = parseRawArgs(argv);
    const route = routeCommand(commands, rawArgs);

    if (!route) {
      const rootName = rawArgs[0];
      const root = commands[rootName];
      if (root && !root.handler && Object.keys(root.subcommands ?? {}).length > 0) {
        console.log(getHelp(root, [rootName]));
        return ExitCode.Success;
      }
      throw new CliError(`Unknown command: ${rawArgs.join(' ')}`, 'UNKNOWN_COMMAND', ExitCode.GeneralError);
    }

    commandPath = route.commandPath;

    if (rawOptions.help === true || rawOptions.h === true) {
      console.log(getHelp(route.commandDef, route.commandPath));
      return ExitCode.Success;
    }

    const validatedOptions = validateOptions(
      rawOptions,
      route.commandDef.options,
      route.commandPath
    );
    validateArgs(route.remainingArgs, route.commandDef, route.commandPath);

    return await route.handler(route.remainingArgs, validatedOptions);
  } catch (error) {
    const cmdStr = commandPath.length > 0 ? commandPath.join(' ') : (argv[0] ?? 'unknown');
    if (error instanceof CliError) {
      console.error(JSON.stringify(error.toJSON(cmdStr)));
      return error.exitCode;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        error: true,
        command: cmdStr,
        message,
        code: 'UNEXPECTED_ERROR',
      })
    );
    return ExitCode.GeneralError;
  }
}
