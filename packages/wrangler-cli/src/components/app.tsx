import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useApp, Text } from 'ink';
import { AgentLoader, EnhancedRunner, discoverGlobalConfigPath } from '@agentskillmania/wrangler';
import type { SessionSource } from '@agentskillmania/wrangler';
import * as fs from 'node:fs';
import { MainTUI } from './main-tui.js';
import type { DialogState } from './main-tui.js';
import { SetupWizard } from './setup/setup-wizard.js';
import { useAgent } from '../hooks/use-agent.js';
import { SessionManager } from '../hooks/use-session-manager.js';
import { createLLMClientFromConfig, createInitialState } from '../runner-setup.js';
import type { AppConfig } from '../config.js';
import { loadConfig, saveSetup } from '../config.js';
import type { DetectedMode } from '../types.js';
import type { Question, HumanResponse } from '@agentskillmania/colts';

interface AppProps {
  config: AppConfig;
  mode: DetectedMode;
  dir: string;
}

// Default tools that require human confirmation before execution
const DEFAULT_CONFIRM_TOOLS = ['shell', 'file_write', 'file_edit', 'python'];

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
  const [dialog, setDialog] = useState<DialogState>({ type: 'none' });

  // Shared resolve ref for confirm/ask promises (runner is single-threaded, so safe)
  const resolveRef = useRef<((value: unknown) => void) | null>(null);
  const askQuestionIdRef = useRef<string | null>(null);

  const confirmHandler = useCallback(
    async (toolName: string, args: Record<string, unknown>) => {
      return new Promise<boolean>((resolve) => {
        resolveRef.current = resolve as (value: unknown) => void;
        setDialog({ type: 'confirm', toolName, summary: JSON.stringify(args, null, 2) });
      });
    },
    []
  );

  const askHumanHandler = useCallback(
    async (params: { questions: Question[]; context?: string; signal?: AbortSignal }) => {
      return new Promise<HumanResponse>((resolve) => {
        resolveRef.current = resolve as (value: unknown) => void;
        const q = params.questions[0];
        askQuestionIdRef.current = q?.id ?? 'unknown';
        setDialog({
          type: 'ask',
          question: q?.question ?? 'Unknown question',
        });
      });
    },
    []
  );

  const handleConfirmResult = useCallback(
    (result: 'yes' | 'no' | 'always') => {
      // 'always' treated as 'yes' for now (future: cache per-tool approval)
      resolveRef.current?.(result === 'yes' || result === 'always');
      resolveRef.current = null;
      setDialog({ type: 'none' });
    },
    []
  );

  const handleAskAnswer = useCallback(
    (answer: string) => {
      const id = askQuestionIdRef.current ?? 'unknown';
      resolveRef.current?.({
        [id]: { type: 'direct', value: answer },
      } as HumanResponse);
      askQuestionIdRef.current = null;
      resolveRef.current = null;
      setDialog({ type: 'none' });
    },
    []
  );

  // Initialize runner when config becomes valid
  useEffect(() => {
    if (!config.hasValidConfig) return;

    const setup = async () => {
      const llmClient = createLLMClientFromConfig(config);
      if (!llmClient) return;

      let name = 'wrangler-agent';
      let instr = 'You are a helpful assistant.';
      let dirs: string[] = [];
      let sandbox: boolean | undefined;
      let mcpConfigPaths: string[] | undefined;
      let source: SessionSource = { type: 'bare' };

      if (mode.mode === 'agent') {
        const loaded = await AgentLoader.loadFrom(mode.agentDir);
        name = loaded.name;
        instr = loaded.instructions || instr;
        dirs = loaded.skillDirs;
        sandbox = loaded.sandbox;
        source = loaded.source;

        const globalPath = discoverGlobalConfigPath();
        mcpConfigPaths = [globalPath, ...loaded.mcpPaths].filter((p) => fs.existsSync(p));
        if (mcpConfigPaths.length === 0) mcpConfigPaths = undefined;
      }

      const workspacePath =
        mode.mode === 'bare' ? mode.dir : mode.mode === 'agent' ? mode.agentDir : mode.crewDir;

      const model = config.llm!.providers[0].models[0].modelId;

      const r = await EnhancedRunner.create({
        llmClient,
        model,
        workspacePath,
        skillDirs: dirs,
        mcpConfigPaths,
        thinkingEnabled: true,
        enablePromptThinking: false,
        requestTimeout: config.requestTimeout,
        maxSteps: config.maxSteps,
        sandbox,
        confirmHandler,
        confirmTools: DEFAULT_CONFIRM_TOOLS,
        askHumanHandler,
        source,
      });

      setRunner(r);
      setAgentName(name);
      setInstructions(instr);
    };

    setup().catch((err: unknown) => {
      console.error('Setup failed:', err);
      exit();
    });
  }, [config, mode, dir, exit, confirmHandler, askHumanHandler]);

  const handleSetupComplete = useCallback(
    async (setup: { provider: string; apiKey: string; model: string }) => {
      await saveSetup(setup);
      const newConfig = await loadConfig();
      setConfig(newConfig);
    },
    []
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
    <MainTUI
      agentHook={agentHook}
      agentName={agentName}
      model={config.llm?.providers[0]?.models[0]?.modelId ?? 'unknown'}
      isCrewMode={sessionManager.isCrewMode}
      currentSession={sessionManager.currentSession}
      dialog={dialog}
      onConfirmResult={handleConfirmResult}
      onAskAnswer={handleAskAnswer}
    />
  );
}
