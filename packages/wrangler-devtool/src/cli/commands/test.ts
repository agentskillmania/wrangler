// packages/wrangler-devtool/src/cli/commands/test.ts
// wrangler-devtool test <path> [options]

import { printReport } from '../../test-runner/reporters/console.js';
import { formatJsonReport } from '../../test-runner/reporters/json.js';
import { runTests } from '../../test-runner/runner.js';
import { defineCommand } from '../framework.js';
import { CliError, ExitCode } from '../options.js';

export const testCommand = defineCommand({
  name: 'test',
  description: 'Run YAML-based test cases against an agent/crew/skill',
  args: '<path>',
  options: {
    hardOnly: {
      type: 'boolean',
      default: false,
      description: 'Skip soft evaluations',
    },
    case: {
      type: 'string',
      description: 'Run a single test case by name',
    },
    reporter: {
      type: 'string',
      default: 'console',
      description: 'Reporter type: console or json',
    },
    timeout: {
      type: 'number',
      default: 120000,
      description: 'Test case timeout in milliseconds',
    },
    updateSnapshot: {
      type: 'boolean',
      default: false,
      description: 'Update expected outputs in test cases',
    },
    debug: {
      type: 'boolean',
      default: false,
      description: 'Enable debug output for test execution',
    },
  },
  handler: async (args, options) => {
    const targetPath = args[0];
    if (!targetPath) {
      throw new CliError(
        'Test target path is required',
        'MISSING_PATH',
        ExitCode.ValidationFailure
      );
    }

    if (options.reporter !== 'console' && options.reporter !== 'json') {
      throw new CliError(
        `Invalid reporter: ${options.reporter}. Must be one of: console, json`,
        'INVALID_REPORTER',
        ExitCode.ValidationFailure
      );
    }

    const report = await runTests(targetPath, {
      hardOnly: options.hardOnly as boolean,
      case: options.case as string | undefined,
      reporter: options.reporter as 'console' | 'json',
      timeout: options.timeout as number,
      updateSnapshot: options.updateSnapshot as boolean,
      debug: options.debug as boolean,
    });

    if (options.reporter === 'json') {
      console.log(formatJsonReport(report));
    } else {
      printReport(report);
    }

    if (report.summary.failed > 0) {
      return ExitCode.TestFailure;
    }

    return ExitCode.Success;
  },
});
