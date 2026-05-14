import React, { useEffect, useState, useCallback } from 'react';
import { useApp } from 'ink';
import { AgentLoader, EnhancedRunner } from '@agentskillmania/wrangler';
import { MainTUI } from './main-tui.js';
import { SetupWizard } from './setup/setup-wizard.js';
import { useAgent } from '../hooks/use-agent.js';
import { SessionManager } from '../hooks/use-session-manager.js';
import { InteractionContext } from '../context/interaction-context.js';
import { createLLMClientFromConfig, createInitialStateFromConfig } from '../runner-setup.js';
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
 * Routes to SetupWizard when config is invalid,
 * otherwise initializes EnhancedRunner and renders MainTUI.
 */
export function App({ config: initialConfig, mode, dir }: AppProps) {
  const { exit } = useApp();
  const [config, setConfig] = useState<AppConfig>(initialConfig);
  const [runner, setRunner] = useState<EnhancedRunner | null>(null);
  const [agentName, setAgentName] = useState('wrangler-agent');
  const [instructions, setInstructions] = useState('You are a helpful assistant.');
  const [sessionManager] = useState(() => new SessionManager());

  const ready = config.hasValidConfig && runner !== null;

  // Initialize runner when config becomes valid
  useEffect(() => {
    if (!config.hasValidConfig) return;

    const setup = async () => {
      const llmClient = createLLMClientFromConfig(config);
      if (!llmClient) return;

      let name = config.agent?.name ?? 'wrangler-agent';
      let instr = config.agent?.instructions ?? 'You are a helpful assistant.';
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

  // Create initial state from runner (only when runner is ready)
  const initialState = runner
    ? createInitialStateFromConfig(config) ??
      createInitialStateFromConfig({
        hasValidConfig: true,
        llm: { provider: 'openai', apiKey: '', model: config.llm?.model ?? 'gpt-4o' },
        agent: { name: agentName, instructions },
      })
    : null;

  const agentHook = useAgent(runner, initialState);

  if (!ready) {
    return <SetupWizard onComplete={handleSetupComplete} />;
  }

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
