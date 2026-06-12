// @vitest-environment jsdom

import React from 'react';
import { render } from 'ink-testing-library';
import { SetupWizard } from '../../../src/components/setup/setup-wizard.js';

// --- Mocks ---

// Capture the onChange/onSubmit callbacks so tests can trigger them
let capturedSelectOnChange: ((value: string) => void) | null = null;
let capturedTextInputOnSubmit: ((value: string) => void) | null = null;

vi.mock('@inkjs/ui', async () => {
  // Import ink's Text to satisfy the reconciler requirement that text
  // nodes must be wrapped in <Text>
  const { Text } = await import('ink');
  return {
    Select: ({ options, onChange }: { options: Array<{ label: string; value: string }>; onChange: (value: string) => void }) => {
      capturedSelectOnChange = onChange;
      return React.createElement(
        'ink-box',
        { 'data-testid': 'select' },
        ...options.map((opt: { label: string; value: string }) =>
          React.createElement(Text, { key: opt.value }, `[${opt.value}] ${opt.label}`),
        ),
      );
    },
    TextInput: ({ placeholder, onSubmit }: { placeholder?: string; onSubmit: (value: string) => void }) => {
      capturedTextInputOnSubmit = onSubmit;
      return React.createElement(Text, null, `TextInput (placeholder: ${placeholder ?? ''})`);
    },
  };
});

// --- Tests ---

describe('SetupWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedSelectOnChange = null;
    capturedTextInputOnSubmit = null;
  });

  it('renders step 1/3 with provider selection', () => {
    const onComplete = vi.fn();
    const { lastFrame } = render(React.createElement(SetupWizard, { onComplete }));

    const output = lastFrame();
    expect(output).toContain('Step 1/3');
    expect(output).toContain('Select your LLM provider');
    expect(output).toContain('[openai] OpenAI');
    expect(output).toContain('[anthropic] Anthropic');
    expect(output).toContain('[google] Google');
    expect(output).toContain('[other] Other (custom base URL)');
  });

  it('transitions to step 2 after provider selection', () => {
    const onComplete = vi.fn();
    const { lastFrame } = render(React.createElement(SetupWizard, { onComplete }));

    // Simulate selecting "anthropic" in step 1
    expect(capturedSelectOnChange).not.toBeNull();
    capturedSelectOnChange!('anthropic');

    const output = lastFrame();
    expect(output).toContain('Step 2/3');
    expect(output).toContain('Enter your API key');
    expect(output).toContain('TextInput');
  });

  it('transitions to step 3 after API key submission and shows model prompt', () => {
    const onComplete = vi.fn();
    const { lastFrame } = render(React.createElement(SetupWizard, { onComplete }));

    // Step 1: select provider
    capturedSelectOnChange!('openai');

    // Step 2: submit API key
    expect(capturedTextInputOnSubmit).not.toBeNull();
    capturedTextInputOnSubmit!('sk-test-key');

    const output = lastFrame();
    expect(output).toContain('Step 3/3');
    expect(output).toContain('Model');
    expect(output).toContain('default: gpt-4o');
  });

  it('calls onComplete with user-entered model', () => {
    const onComplete = vi.fn();
    render(React.createElement(SetupWizard, { onComplete }));

    // Step 1: select provider
    capturedSelectOnChange!('anthropic');

    // Step 2: submit API key
    capturedTextInputOnSubmit!('sk-ant-test');

    // Step 3: submit model
    capturedTextInputOnSubmit!('claude-sonnet-4-20250514');

    expect(onComplete).toHaveBeenCalledWith({
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-4-20250514',
    });
  });

  it('calls onComplete with default model when empty string submitted', () => {
    const onComplete = vi.fn();
    render(React.createElement(SetupWizard, { onComplete }));

    // Step 1: select provider (openai default)
    capturedSelectOnChange!('openai');

    // Step 2: submit API key
    capturedTextInputOnSubmit!('sk-test');

    // Step 3: submit empty model (should use default)
    capturedTextInputOnSubmit!('');

    expect(onComplete).toHaveBeenCalledWith({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
  });

  it('uses correct default model for anthropic provider', () => {
    const onComplete = vi.fn();
    const { lastFrame } = render(React.createElement(SetupWizard, { onComplete }));

    // Select anthropic
    capturedSelectOnChange!('anthropic');

    // Submit API key
    capturedTextInputOnSubmit!('sk-key');

    const output = lastFrame();
    expect(output).toContain('default: claude-sonnet-4-20250514');

    // Submit empty model
    capturedTextInputOnSubmit!('');

    expect(onComplete).toHaveBeenCalledWith({
      provider: 'anthropic',
      apiKey: 'sk-key',
      model: 'claude-sonnet-4-20250514',
    });
  });

  it('proceeds with empty API key (negative path: no validation)', () => {
    const onComplete = vi.fn();
    render(React.createElement(SetupWizard, { onComplete }));

    capturedSelectOnChange!('openai');
    capturedTextInputOnSubmit!('');
    capturedTextInputOnSubmit!('gpt-4o-mini');

    expect(onComplete).toHaveBeenCalledWith({
      provider: 'openai',
      apiKey: '',
      model: 'gpt-4o-mini',
    });
  });

  it('falls back to undefined model for unrecognized provider', () => {
    const onComplete = vi.fn();
    render(React.createElement(SetupWizard, { onComplete }));

    capturedSelectOnChange!('unsupported-provider' as string);
    capturedTextInputOnSubmit!('sk-key');
    capturedTextInputOnSubmit!('');

    expect(onComplete).toHaveBeenCalledWith({
      provider: 'unsupported-provider',
      apiKey: 'sk-key',
      model: undefined,
    });
  });
});
