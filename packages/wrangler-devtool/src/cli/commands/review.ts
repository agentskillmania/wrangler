// packages/wrangler-devtool/src/cli/commands/review.ts
// wrangler-devtool review <path> [--prompt] [--deep]

import { readFile, access, readdir, stat } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { defineCommand } from '../framework.js';
import { CliError, ExitCode } from '../options.js';
import { runReviewer } from '../../agents/reviewer.js';
import { loadConfig } from '../../config.js';
import { parseAgentMd, CrewLoader } from '@agentskillmania/wrangler';

interface StaticCheckIssue {
  severity: 'minor' | 'major' | 'critical';
  location: string;
  description: string;
  suggestion: string;
}

interface StaticReviewResult {
  passed: boolean;
  issues: StaticCheckIssue[];
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}



async function runStaticChecks(targetPath: string): Promise<StaticReviewResult> {
  const issues: StaticCheckIssue[] = [];
  const resolved = resolve(targetPath);
  const stats = await stat(resolved);

  if (stats.isDirectory()) {
    // Directory review — verify the directory is readable
    await readdir(resolved);

    const hasAgentMd = await fileExists(join(resolved, 'AGENT.md'));
    const hasCrewMd = await fileExists(join(resolved, 'CREW.md'));
    const hasSkillsDir = await fileExists(join(resolved, 'skills'));
    const hasTestDir = await fileExists(join(resolved, 'test'));

    if (!hasAgentMd && !hasCrewMd) {
      issues.push({
        severity: 'critical',
        location: resolved,
        description: 'No AGENT.md or CREW.md found in workspace root',
        suggestion: 'Add an AGENT.md or CREW.md to define the agent or crew',
      });
    }

    if (hasAgentMd && hasCrewMd) {
      issues.push({
        severity: 'minor',
        location: resolved,
        description: 'Both AGENT.md and CREW.md exist in the same workspace',
        suggestion: 'Consider separating agent and crew into different workspaces',
      });
    }

    if (hasAgentMd) {
      const content = await readFile(join(resolved, 'AGENT.md'), 'utf-8');
      const parsed = parseAgentMd(content);
      if (parsed.name === 'unknown') {
        issues.push({
          severity: 'major',
          location: join(resolved, 'AGENT.md'),
          description: 'AGENT.md is missing "name" field or YAML frontmatter',
          suggestion: 'Add frontmatter with name field to the AGENT.md',
        });
      }
      if (!parsed.description) {
        issues.push({
          severity: 'minor',
          location: join(resolved, 'AGENT.md'),
          description: 'AGENT.md is missing "description" field',
          suggestion: 'Add a description field to the frontmatter',
        });
      }
    }

    if (hasCrewMd) {
      try {
        const loader = new CrewLoader(resolved);
        await loader.load();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        issues.push({
          severity: 'major',
          location: join(resolved, 'CREW.md'),
          description: `CREW.md validation failed: ${message}`,
          suggestion: 'Fix the CREW.md frontmatter or directory structure',
        });
      }
    }

    if (!hasSkillsDir) {
      issues.push({
        severity: 'minor',
        location: resolved,
        description: 'No skills/ directory found',
        suggestion: 'Create a skills/ directory for reusable capabilities',
      });
    }

    if (!hasTestDir) {
      issues.push({
        severity: 'minor',
        location: resolved,
        description: 'No test/ directory found',
        suggestion: 'Create a test/ directory for declarative test cases',
      });
    }
  } else {
    // Single file review
    const content = await readFile(resolved, 'utf-8');
    const ext = extname(resolved);

    if (ext !== '.md') {
      issues.push({
        severity: 'minor',
        location: resolved,
        description: `Review target has non-Markdown extension: ${ext}`,
        suggestion: 'Wrangler definitions should use .md files',
      });
    }

    const parsed = parseAgentMd(content);
    if (parsed.name === 'unknown') {
      issues.push({
        severity: 'major',
        location: resolved,
        description: 'File is missing "name" field or YAML frontmatter',
        suggestion: 'Add frontmatter with name field',
      });
    }
    if (!parsed.description) {
      issues.push({
        severity: 'minor',
        location: resolved,
        description: 'File is missing "description" field',
        suggestion: 'Add a description field to the frontmatter',
      });
    }

    if (content.trim().length < 100) {
      issues.push({
        severity: 'minor',
        location: resolved,
        description: 'File content is very short',
        suggestion: 'Add more detailed instructions or context',
      });
    }
  }

  return {
    passed: issues.filter((i) => i.severity === 'critical' || i.severity === 'major').length === 0,
    issues,
  };
}

export const reviewCommand = defineCommand({
  name: 'review',
  description: 'Review an agent/crew/skill definition for quality issues',
  args: '<path>',
  options: {
    prompt: {
      type: 'string',
      description: 'Additional review focus (e.g., "check for security issues")',
    },
    deep: {
      type: 'boolean',
      default: false,
      description: 'Run LLM-based review (slower, more thorough)',
    },
  },
  handler: async (args, options) => {
    const targetPath = args[0];
    if (!targetPath) {
      throw new CliError(
        'Review target path is required',
        'MISSING_PATH',
        ExitCode.ValidationFailure
      );
    }

    if (!(await fileExists(targetPath))) {
      throw new CliError(
        `Path does not exist: ${targetPath}`,
        'PATH_NOT_FOUND',
        ExitCode.ValidationFailure
      );
    }

    // Phase 1: Static checks
    const staticResult = await runStaticChecks(targetPath);

    const report: Record<string, unknown> = {
      static: staticResult,
      deep: null,
    };

    // Phase 2: Deep review (optional)
    if (options.deep) {
      const config = await loadConfig();
      if (!config?.llm) {
        throw new CliError(
          'No LLM configuration found. Cannot run deep review without llm.provider, llm.apiKey, and llm.model.',
          'MISSING_LLM_CONFIG',
          ExitCode.ConfigError
        );
      }

      const stats = await stat(resolve(targetPath));
      let content: string;
      let reviewTarget: string;

      if (stats.isDirectory()) {
        // For directories, read the main definition file
        const agentMd = join(resolve(targetPath), 'AGENT.md');
        const crewMd = join(resolve(targetPath), 'CREW.md');
        if (await fileExists(agentMd)) {
          content = await readFile(agentMd, 'utf-8');
          reviewTarget = agentMd;
        } else if (await fileExists(crewMd)) {
          content = await readFile(crewMd, 'utf-8');
          reviewTarget = crewMd;
        } else {
          content = '';
          reviewTarget = resolve(targetPath);
        }
      } else {
        content = await readFile(resolve(targetPath), 'utf-8');
        reviewTarget = resolve(targetPath);
      }

      if (content.length > 0) {
        const deepReport = await runReviewer(
          reviewTarget,
          content,
          (options.prompt as string | undefined) || undefined
        );
        report.deep = deepReport;
      } else {
        report.deep = {
          overallScore: 0,
          dimensions: {},
          issues: [
            {
              severity: 'critical',
              location: reviewTarget,
              description: 'No content available for deep review',
              suggestion: 'Ensure the target has a readable definition file',
            },
          ],
          summary: 'No content available for deep review',
        };
      }
    }

    console.log(JSON.stringify(report));

    if (!staticResult.passed) {
      return ExitCode.GeneralError;
    }

    return ExitCode.Success;
  },
});
