// packages/core/src/agent/configurable-agent.ts

import { AgentRunner, createAgentState, addUserMessage } from '@agentskillmania/colts';
import { createSessionSupport } from '../session/support.js';
import { createBuiltinTools } from '../tools/builtin/index.js';
import type { AgentDefinition, ConfigurableAgentOptions } from './types.js';

/**
 * A single-agent runner configured from an AgentDefinition.
 *
 * Parses AGENT.md → wires session support + builtin tools + skills
 * into an AgentRunner per invocation.
 */
export class ConfigurableAgent {
  constructor(
    private readonly agentDef: AgentDefinition,
    private readonly workspacePath: string,
    private readonly options: ConfigurableAgentOptions
  ) {}

  async run(userInput: string): Promise<string> {
    const model = this.options.defaultModel ?? 'gpt-4';

    const session = createSessionSupport({
      workspacePath: this.workspacePath,
      sessionBaseDir: this.options.sessionBaseDir,
      askHumanHandler: this.options.askHumanHandler,
    });

    const builtinTools = createBuiltinTools({
      workspacePath: this.workspacePath,
    });

    const runner = new AgentRunner({
      model,
      llmClient: this.options.llmClient,
      tools: [...session.tools, ...builtinTools],
      middleware: [session.middleware],
      skillDirectories: this.options.skillDirectories,
      systemPrompt: this.agentDef.instructions,
      thinkingEnabled: this.agentDef.meta.thinking?.enabled,
    });

    let state = createAgentState({
      name: this.agentDef.meta.name,
      instructions: this.agentDef.instructions,
      tools: [],
    });
    state = addUserMessage(state, userInput);

    const { result } = await runner.run(state);

    if (result.type === 'success') {
      return result.answer;
    }
    if (result.type === 'error') {
      return `Error: ${result.error.message}`;
    }
    return `Error: run ended with ${result.type}`;
  }
}
