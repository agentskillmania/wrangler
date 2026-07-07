// packages/wrangler-devtool/src/cli/commands/write-command.ts
// Shared factory for the `write` subcommand used by the agent and crew commands.
//
// Both commands build an identical `write` subcommand that differs only in the
// target filename, the generation runner, the per-name prompt prefix, and the
// human-readable description. skill.ts's write handler diverges (multi-file
// skills, name inference) and intentionally stays standalone.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { resolveDefaultModel } from '@agentskillmania/wrangler';

import type { AgentOutput, AgentRunOptions } from '../../agents/types.js';
import { requireLLMConfig } from '../../config.js';
import { createLLMClient } from '../../llm.js';
import { applyChanges } from '../../utils/file-change.js';
import { fileExists } from '../../utils/fs.js';
import type { CliCommandDef } from '../framework.js';
import { ExitCode } from '../options.js';

/**
 * Signature of a generation runner (e.g. runAgentArchitect / runCrewComposer).
 */
type GenerationRunner = (
  prompt: string,
  existingContent: string | undefined,
  config: import('../../agents/orchestrator.js').RunnerConfig & AgentRunOptions
) => Promise<AgentOutput>;

/**
 * Per-command configuration that distinguishes the agent and crew write handlers.
 */
export interface WriteSubcommandConfig {
  /** Workspace-relative file the command reads/writes (e.g. "AGENT.md"). */
  targetFileName: string;
  /** One-line description shown in help output. */
  description: string;
  /** Generation runner invoked to produce the changes. */
  run: GenerationRunner;
  /**
   * Builds the prompt prefix when a name argument is supplied.
   * Receives the name and returns the prefix line (e.g. "Agent name: foo").
   */
  buildNamePrefix: (name: string) => string;
}

/**
 * Create the `write` subcommand definition shared by the agent and crew commands.
 */
export function createWriteSubcommand(config: WriteSubcommandConfig): CliCommandDef {
  return {
    name: 'write',
    description: config.description,
    args: '[name]',
    options: {
      prompt: {
        type: 'string',
        required: true,
        description: `User instruction`,
      },
      dryRun: {
        type: 'boolean',
        default: true,
        description: 'Preview changes without writing',
      },
      apply: {
        type: 'boolean',
        default: false,
        description: 'Apply changes to disk',
      },
    },
    handler: async (args, options) => {
      const name = args[0];
      const prompt = options.prompt as string;
      const apply = (options.apply as boolean) || false;
      const dryRun = !apply;
      const cwd = process.cwd();

      const targetFile = join(cwd, config.targetFileName);
      let existingContent: string | undefined;

      if (await fileExists(targetFile)) {
        existingContent = await readFile(targetFile, 'utf-8');
      }

      const fullPrompt = name ? `${config.buildNamePrefix(name)}\n${prompt}` : prompt;
      const llmConfig = await requireLLMConfig();
      const llmClient = createLLMClient(llmConfig);
      const output = await config.run(fullPrompt, existingContent, {
        llmClient,
        workspacePath: cwd,
        model: resolveDefaultModel(llmConfig.providers),
      });

      const result = await applyChanges(output.changes, { cwd, dryRun });

      console.log(
        JSON.stringify({
          success: result.applied,
          dryRun,
          summary: output.summary,
          changes: output.changes,
          error: result.error,
        })
      );

      if (!result.applied && !dryRun) {
        return ExitCode.ValidationFailure;
      }

      return ExitCode.Success;
    },
  };
}
