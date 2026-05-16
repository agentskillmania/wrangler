// packages/wrangler-devtool/src/cli/options.ts
// CLI 共享类型与常量

/**
 * 标准退出码
 */
export const ExitCode = {
  Success: 0,
  GeneralError: 1,
  ConfigError: 2,
  TestFailure: 3,
  ValidationFailure: 4,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * 结构化错误 JSON
 */
export interface CliErrorJson {
  error: true;
  command: string;
  message: string;
  code: string;
}

/**
 * CLI 运行时错误
 */
export class CliError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly exitCode: ExitCode = ExitCode.GeneralError
  ) {
    super(message);
  }

  toJSON(command: string): CliErrorJson {
    return {
      error: true,
      command,
      message: this.message,
      code: this.code,
    };
  }
}
