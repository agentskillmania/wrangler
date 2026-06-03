// packages/wrangler-devtool/src/cli/commands/session.ts

import { listSessions, forkSession } from '../../tools/session-manager.js';
import { defineCommand } from '../framework.js';
import { CliError, ExitCode } from '../options.js';

export const sessionCommand = defineCommand({
  name: 'session',
  description: 'Session management',
  subcommands: {
    list: {
      name: 'list',
      description: 'List sessions for a workspace',
      args: '[workspace-path]',
      options: {
        'all-workspaces': {
          type: 'boolean',
          description: 'List sessions from all workspaces',
        },
      },
      handler: async (args, options) => {
        const sessions = await listSessions({
          workspacePath: args[0],
          allWorkspaces: options['all-workspaces'] as boolean,
        });
        console.log(JSON.stringify({ success: true, sessions }));
        return ExitCode.Success;
      },
    },
    fork: {
      name: 'fork',
      description: 'Fork a session from a historical message',
      args: '<session-id>',
      options: {
        before: {
          type: 'string',
          required: true,
          description: 'Message ID to fork up to (inclusive)',
        },
        workspace: {
          type: 'string',
          description: 'Override workspace path',
        },
      },
      handler: async (args, options) => {
        const sessionId = args[0];
        if (!sessionId) {
          throw new CliError(
            'Session ID is required',
            'MISSING_SESSION_ID',
            ExitCode.ValidationFailure
          );
        }
        const newId = await forkSession(sessionId, {
          upToMessageId: options.before as string,
          workspace: options.workspace as string | undefined,
        });
        console.log(JSON.stringify({ success: true, newSessionId: newId }));
        return ExitCode.Success;
      },
    },
  },
});
