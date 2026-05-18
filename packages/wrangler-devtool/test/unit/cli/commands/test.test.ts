import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { testCommand } from '../../../../src/cli/commands/test.js';
import * as runnerModule from '../../../../src/test-runner/runner.js';
import { ExitCode } from '../../../../src/cli/options.js';

describe('testCommand', () => {
  let runTestsSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runTestsSpy = vi.spyOn(runnerModule, 'runTests').mockResolvedValue({
      suites: [],
      summary: { total: 0, passed: 0, failed: 0, duration: 0, hardPassed: 0, hardFailed: 0 },
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    runTestsSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('should require path argument', async () => {
    await expect(testCommand.handler!([], {})).rejects.toThrow('Test target path is required');
  });

  it('should reject invalid reporter', async () => {
    await expect(testCommand.handler!(['./my-agent'], { reporter: 'xml' })).rejects.toThrow(
      'Invalid reporter'
    );
  });

  it('should accept console reporter and pass options', async () => {
    const exitCode = await testCommand.handler!(['./my-agent'], {
      hardOnly: true,
      case: 'MyCase',
      reporter: 'console',
      timeout: 30000,
    });

    expect(runTestsSpy).toHaveBeenCalledWith(
      './my-agent',
      expect.objectContaining({
        hardOnly: true,
        case: 'MyCase',
        reporter: 'console',
        timeout: 30000,
      })
    );
    expect(exitCode).toBe(ExitCode.Success);
  });

  it('should return exit code 0 when all tests pass', async () => {
    runTestsSpy.mockResolvedValue({
      suites: [
        {
          file: './my-agent',
          cases: [],
          passed: true,
        },
      ],
      summary: { total: 1, passed: 1, failed: 0, duration: 100, hardPassed: 1, hardFailed: 0 },
    });

    const exitCode = await testCommand.handler!(['./my-agent'], { reporter: 'console' });
    expect(exitCode).toBe(ExitCode.Success);
  });

  it('should return exit code 3 when any test fails', async () => {
    runTestsSpy.mockResolvedValue({
      suites: [
        {
          file: './my-agent',
          cases: [],
          passed: false,
        },
      ],
      summary: { total: 1, passed: 0, failed: 1, duration: 100, hardPassed: 0, hardFailed: 1 },
    });

    const exitCode = await testCommand.handler!(['./my-agent'], { reporter: 'console' });
    expect(exitCode).toBe(ExitCode.TestFailure);
  });

  it('should output JSON when reporter is json', async () => {
    const report = {
      suites: [],
      summary: { total: 0, passed: 0, failed: 0, duration: 0, hardPassed: 0, hardFailed: 0 },
    };
    runTestsSpy.mockResolvedValue(report);

    await testCommand.handler!(['./my-agent'], { reporter: 'json' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"summary"'));
  });
});
