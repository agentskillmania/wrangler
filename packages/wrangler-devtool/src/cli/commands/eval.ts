// packages/wrangler-devtool/src/cli/commands/eval.ts
// wrangler-devtool eval <suite.yaml> [options]

import { resolve, dirname } from 'node:path';

import { loadSuite } from '../../eval/loader.js';
import { runEval } from '../../eval/runner.js';
import { printReport } from '../../eval/reporters/console.js';
import { formatJsonReport } from '../../eval/reporters/json.js';
import { defineCommand } from '../framework.js';
import { CliError, ExitCode } from '../options.js';

export const evalCommand = defineCommand({
  name: 'eval',
  description: 'Run an evaluation suite against an agent or skill',
  args: '<suite.yaml>',
  options: {
    runs: {
      type: 'number',
      description: 'Override sampling.runs',
    },
    output: {
      type: 'string',
      description: 'Output directory (default: .eval/runs/<runId>)',
    },
    reporter: {
      type: 'string',
      default: 'console',
      description: 'Reporter: console or json',
    },
    'keep-traces': {
      type: 'boolean',
      default: false,
      description: 'Keep temporary workspaces after run',
    },
  },
  handler: async (args, options) => {
    const suitePath = args[0];
    if (!suitePath) {
      throw new CliError(
        'Suite YAML path is required',
        'MISSING_SUITE',
        ExitCode.ValidationFailure
      );
    }

    if (options.reporter !== 'console' && options.reporter !== 'json') {
      throw new CliError(
        `Invalid reporter: ${options.reporter}. Must be: console, json`,
        'INVALID_REPORTER',
        ExitCode.ValidationFailure
      );
    }

    const resolvedPath = resolve(suitePath);
    const projectDir = dirname(resolvedPath);

    const suite = await loadSuite(resolvedPath);

    const { report, outputDir } = await runEval(suite, {
      runs: options.runs as number | undefined,
      outputDir: options.output ? resolve(options.output as string) : undefined,
      projectDir,
      keepTraces: options['keep-traces'] as boolean,
    });

    if (options.reporter === 'json') {
      console.log(formatJsonReport(report));
    } else {
      printReport(report);
    }

    console.log(`\nOutput: ${outputDir}`);

    // Non-zero exit if any case failed (useful for CI)
    if (report.failed > 0) {
      return ExitCode.TestFailure;
    }

    return ExitCode.Success;
  },
});
