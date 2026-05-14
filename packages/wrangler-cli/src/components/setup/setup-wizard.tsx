/**
 * @fileoverview SetupWizard — first-launch configuration wizard for wrangler-cli
 *
 * 3-step guide: Choose Provider -> Enter API Key -> Choose Model.
 * Calls onComplete to persist config after the user finishes all steps.
 */

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { Select, TextInput } from '@inkjs/ui';

/** Configuration produced by the setup wizard */
export interface SetupConfig {
  provider: string;
  apiKey: string;
  model: string;
}

interface SetupWizardProps {
  onComplete: (config: SetupConfig) => void;
}

/** LLM provider options presented in Step 1 */
const PROVIDER_OPTIONS = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'Google', value: 'google' },
  { label: 'Other (custom base URL)', value: 'other' },
];

/** Default model for each provider, used as placeholder and fallback */
const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  google: 'gemini-2.0-flash',
  other: 'gpt-4o',
};

/** Total number of wizard steps (displayed as "Step N/3") */
const TOTAL_STEPS = 3;

/**
 * First-time setup wizard component
 *
 * Guides the user through provider selection, API key entry, and model
 * configuration. Calls {@link SetupWizardProps.onComplete} with the final
 * configuration when all steps are finished.
 */
export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(1);
  const [provider, setProvider] = useState('openai');
  const [apiKey, setApiKey] = useState('');

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>wrangler Setup</Text>
      <Box marginTop={1}>
        <Text color="gray">Step {step}/{TOTAL_STEPS}</Text>
      </Box>

      {step === 1 && (
        <>
          <Box marginTop={1}>
            <Text>Select your LLM provider:</Text>
          </Box>
          <Select
            options={PROVIDER_OPTIONS}
            onChange={(value) => {
              setProvider(value);
              setStep(2);
            }}
          />
        </>
      )}

      {step === 2 && (
        <>
          <Box marginTop={1}>
            <Text>Enter your API key:</Text>
          </Box>
          <TextInput
            placeholder="sk-..."
            onSubmit={(value) => {
              setApiKey(value);
              setStep(3);
            }}
          />
        </>
      )}

      {step === 3 && (
        <>
          <Box marginTop={1}>
            <Text>Model (default: {DEFAULT_MODELS[provider]}):</Text>
          </Box>
          <TextInput
            placeholder={DEFAULT_MODELS[provider]}
            onSubmit={(value) => {
              onComplete({
                provider,
                apiKey,
                model: value || DEFAULT_MODELS[provider],
              });
            }}
          />
        </>
      )}
    </Box>
  );
}
