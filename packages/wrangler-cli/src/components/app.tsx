import React, { useEffect, useState, useCallback } from 'react';
import { useApp, Text } from 'ink';
import { AgentLoader, EnhancedRunner } from '@agentskillmania/wrangler';
import { MainTUI } from './main-tui.js';
import { SetupWizard } from './setup/setup-wizard.js';
import { useAgent } from '../hooks/use-agent.js';
import { SessionManager } from '../hooks/use-session-manager.js';
import { InteractionContext } from '../context/interaction-context.js';
import { createLLMClientFromConfig, createInitialState } from '../runner-setup.js';
import type { AppConfig } from '../config.js';
import { loadConfig, saveSetup } from '../config.js';
import type { DetectedMode } from '../types.js';

interface AppProps {
  config: AppConfig;
  mode: DetectedMode;
  dir: string;
}

/**
 * Root application component.
 *
 * Three states:
 * 1. Config invalid → SetupWizard
 * 2. Config valid, runner loading → loading indicator
 * 3. Config valid, runner ready → MainTUI
 *
 * All hooks must be called unconditionally (React Rules of Hooks).
 */
export function App({ config: initialConfig, mode, dir }: AppProps) {
  const { exit } = useApp();
  const [config, setConfig] = useState<AppConfig>(initialConfig);
  const [runner, setRunner] = useState<EnhancedRunner | null>(null);
  const [agentName, setAgentName] = useState('wrangler-agent');
  const [instructions, setInstructions] = useState('You are a helpful assistant.');
  const [sessionManager] = useState(() => new SessionManager());

  // Initialize runner when config becomes valid
  useEffect(() => {
    if (!config.hasValidConfig) return;

    const setup = async () => {
      const llmClient = createLLMClientFromConfig(config);
      if (!llmClient) return;

      let name = 'wrangler-agent';
      let instr = 'You are a helpful assistant.';
      let dirs: string[] = [];

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
        model: config.llm!.model,
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
  }, [config, mode, dir, exit]);

  const handleSetupComplete = useCallback(
    async (setup: { provider: string; apiKey: string; model: string }) => {
      await saveSetup(setup);
      const newConfig = await loadConfig();
      setConfig(newConfig);
    },
    [],
  );

  // Hooks must be called unconditionally — useAgent handles null runner gracefully
  const initialState = runner ? createInitialState(agentName, instructions) : null;
  const agentHook = useAgent(runner, initialState);

  // State 1: config invalid → show setup wizard
  if (!config.hasValidConfig) {
    return <SetupWizard onComplete={handleSetupComplete} />;
  }

  // State 2: config valid but runner still loading
  if (!runner) {
    return <Text>Initializing runner...</Text>;
  }

  // State 3: config valid, runner ready
  return (
    <InteractionContext.Provider value={null}>
      <MainTUI
        agentHook={agentHook}
        agentName={agentName}
        model={config.llm?.model ?? 'unknown'}
        isCrewMode={sessionManager.isCrewMode}
        currentSession={sessionManager.currentSession}
      />
    </InteractionContext.Provider>
  );
}
