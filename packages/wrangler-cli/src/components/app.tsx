import React, { useEffect, useState } from 'react';
import { useApp } from 'ink';
import { AgentLoader, EnhancedRunner } from '@agentskillmania/wrangler';
import { createAgentState } from '@agentskillmania/colts';
import { MainTUI } from './main-tui.js';
import { useAgent } from '../hooks/use-agent.js';
import { SessionManager } from '../hooks/use-session-manager.js';
import { InteractionContext } from '../context/interaction-context.js';
import type { DetectedMode } from '../types.js';

interface AppProps {
  mode: DetectedMode;
  model: string;
  llmClient: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/**
 * Root application component.
 *
 * Initializes the EnhancedRunner based on the detected mode,
 * wires up the agent hook, and renders the main TUI layout.
 */
export function App({ mode, model, llmClient }: AppProps) {
  const { exit } = useApp();
  const [runner, setRunner] = useState<EnhancedRunner | null>(null);
  const [agentName, setAgentName] = useState('assistant');
  const [instructions, setInstructions] = useState('You are a helpful assistant.');
  const [sessionManager] = useState(() => new SessionManager());

  useEffect(() => {
    const setup = async () => {
      let dirs: string[] = [];
      let name = 'assistant';
      let instr = 'You are a helpful assistant.';

      if (mode.mode === 'agent') {
        const loaded = await AgentLoader.loadFrom(mode.agentDir);
        name = loaded.name;
        instr = loaded.instructions || instr;
        dirs = loaded.skillDirs;
      }

      const workspacePath =
        mode.mode === 'bare' ? mode.dir : mode.mode === 'agent' ? mode.agentDir : mode.crewDir;

      const r = await EnhancedRunner.create({
        llmClient,
        model,
        workspacePath,
        skillDirectories: dirs,
      });

      setRunner(r);
      setAgentName(name);
      setInstructions(instr);
    };

    setup().catch((err: unknown) => {
      console.error('Setup failed:', err);
      exit();
    });
  }, []);

  const initialState = runner
    ? createAgentState({ name: agentName, instructions, tools: [] })
    : null;

  const agentHook = useAgent(runner, initialState);

  return (
    <InteractionContext.Provider value={null}>
      <MainTUI
        agentHook={agentHook}
        agentName={agentName}
        model={model}
        isCrewMode={sessionManager.isCrewMode}
        currentSession={sessionManager.currentSession}
      />
    </InteractionContext.Provider>
  );
}
