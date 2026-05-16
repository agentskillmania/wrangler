// packages/wrangler-devtool/src/cli/commands/session.ts

import { defineCommand } from '../framework.js';
import { CliError, ExitCode } from '../options.js';
import { listSessions } from '../../tools/session-list.js';
import { forkSession } from '../../tools/session-fork.js';

export const sessionCommand = defineCommand({
  name: 'session',
  description: 'Session management',
  subcommands: {
    list: {
      name: 'list',
      description: 'List sessions for a workspace',
      args: '[workspace-path]',
      handler: async (args) => {
        const workspacePath = args[0] as string | undefined;
        const sessions = await listSessions(workspacePath);
        console.log(JSON.stringify({ success: true, sessions }));
        return ExitCode.Success;
      },
    },
    fork: {
      name: 'fork',
      description: 'Fork a session from a historical message',
      args: '<session-id>',
      options: {
        msg: {
          type: 'number',
          required: true,
          description: 'Message position (1-based)',
        },
        name: {
          type: 'string',
          description: 'New session name',
        },
        workspace: {
          type: 'string',
          description: 'Override workspace path',
        },
      },
      handler: async (args, options) => {
        const sessionId = args[0];
        if (!sessionId) {
          throw new CliError('Session ID is required', 'MISSING_SESSION_ID', ExitCode.ValidationFailure);
        }
        const newId = await forkSession(sessionId, {
          msg: options.msg as number,
          name: options.name as string | undefined,
          workspace: options.workspace as string | undefined,
        });
        console.log(JSON.stringify({ success: true, newSessionId: newId }));
        return ExitCode.Success;
      },
    },
  },
});
