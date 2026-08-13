/**
 * Spec/Plan E2E Integration Tests — Real LLM + EnhancedRunner + spec-plan tools
 *
 * Tests the full tool-driven spec/plan workflow where agents:
 * - Use save_spec/read_spec tools to create and manage spec documents
 * - Use save_plan/read_plan tools to create and manage plan documents
 * - Execute the complete lifecycle: write spec → review → write plan → execute
 *
 * These tests verify that the spec-plan tool chain works end-to-end
 * with a real LLM, EnhancedRunner, and spec-plan skill provider.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { defaultNodeHostEnv } from '../../src/host-env/node-host-env.js';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import { EnhancedRunner } from '../../src/runner/enhanced-runner.js';
import { testConfig, itif } from './config.js';
import { LLMClient } from '@agentskillmania/llm-client';

describe('Spec/Plan Tool-Driven Integration', () => {
  beforeAll(() => {
    if (testConfig.enabled) {
      console.log(
        `[Wrangler Integration] Provider: ${testConfig.provider}, Model: ${testConfig.testModel}`
      );
    }
  });

  /**
   * US1: save_spec tool creates spec via EnhancedRunner
   */
  describe('US1: save_spec creates spec document', () => {
    itif(testConfig.enabled)(
      'should create a spec via save_spec tool and read it back via read_spec',
      async () => {
        const runner = await EnhancedRunner.create({
          runtime: defaultNodeHostEnv,
          llm: {
            quickInit: {
              providers: [
                {
                  name: testConfig.provider,
                  apiKey: testConfig.apiKey,
                  baseUrl: testConfig.baseUrl,
                  models: [{ modelId: testConfig.testModel }],
                },
              ],
            },
            quickInitFactory: (providers) => LLMClient.quickInit({ providers }),
          },
          model: testConfig.testModel,
          session: { enabled: false },
          todolist: { enabled: false },
          commands: { enabled: false },
          specPlan: { enabled: true },
          builtinFilter: { fileRead: true, fileWrite: false, fileEdit: false },
        });

        const instructions = `
You have access to spec-plan tools. Your task:

1. Use save_spec tool to create a spec named "test-auth" with a complete spec body including Goal, Background, Requirements (FR-001, FR-002), and Success Criteria.
2. Use read_spec tool to read back the spec you just created.
3. Confirm that the spec was saved correctly by mentioning the spec name and version in your response.
`;

        let state = createAgentState({
          name: 'spec-tool-tester',
          instructions,
          tools: [],
        });
        state = addUserMessage(
          state,
          'Create a spec for user authentication feature using the spec-plan tools.'
        );

        const { state: finalState, result } = await runner.run(state);

        expect(result.type).toBe('success');

        const assistantMessages = finalState.context.messages.filter((m) => m.role === 'assistant');
        expect(assistantMessages.length).toBeGreaterThan(0);

        const lastAssistant = assistantMessages[assistantMessages.length - 1];
        const responseText =
          typeof lastAssistant.content === 'string'
            ? lastAssistant.content
            : JSON.stringify(lastAssistant.content);

        // Verify the LLM used the tools and produced expected output
        expect(responseText.toLowerCase()).toMatch(/test-auth|spec/);
      },
      120000
    );
  });

  /**
   * US2: Full workflow — save spec, update status, save plan
   */
  describe('US2: Complete spec-plan workflow', () => {
    itif(testConfig.enabled)(
      'should execute save spec → update status → save plan workflow',
      async () => {
        const runner = await EnhancedRunner.create({
          runtime: defaultNodeHostEnv,
          llm: {
            quickInit: {
              providers: [
                {
                  name: testConfig.provider,
                  apiKey: testConfig.apiKey,
                  baseUrl: testConfig.baseUrl,
                  models: [{ modelId: testConfig.testModel }],
                },
              ],
            },
            quickInitFactory: (providers) => LLMClient.quickInit({ providers }),
          },
          model: testConfig.testModel,
          session: { enabled: false },
          todolist: { enabled: false },
          commands: { enabled: false },
          specPlan: { enabled: true },
          builtinFilter: { fileRead: true, fileWrite: false, fileEdit: false },
        });

        const instructions = `
You have access to these spec-plan tools: save_spec, read_spec, list_specs, update_spec_status,
save_plan, read_plan, list_plans, update_plan_status.

Execute this workflow step by step:

1. Use save_spec to create a spec "profile-upload" with:
   - Goal: Allow users to upload profile pictures
   - Requirements: FR-001 (upload JPG/PNG, max 5MB), FR-002 (auto-generate thumbnail)
   - Success Criteria: SC-001 (rejects non-image files), SC-002 (thumbnail generated within 2s)

2. Use update_spec_status to change the spec status from "draft" to "approved"

3. Use save_plan to create a plan "profile-upload-plan" for specVersion 1 with:
   - Phase 1: Backend - file validation, storage, thumbnail generation
   - Phase 2: Frontend - upload component, preview, error handling
   - Each task should have acceptance criteria and concrete steps

4. Use read_plan to verify the plan was saved

Report what you did and confirm each step succeeded.
`;

        let state = createAgentState({
          name: 'workflow-tester',
          instructions,
          tools: [],
        });
        state = addUserMessage(
          state,
          'Execute the complete spec-plan workflow for a profile picture upload feature.'
        );

        const { state: finalState, result } = await runner.run(state);

        expect(result.type).toBe('success');

        const assistantMessages = finalState.context.messages.filter((m) => m.role === 'assistant');
        expect(assistantMessages.length).toBeGreaterThan(0);

        const lastAssistant = assistantMessages[assistantMessages.length - 1];
        const responseText =
          typeof lastAssistant.content === 'string'
            ? lastAssistant.content
            : JSON.stringify(lastAssistant.content);

        // Check LLM used the workflow tools
        expect(responseText.toLowerCase()).toMatch(/profile|upload/);
        expect(responseText.toLowerCase()).toMatch(/approved|plan|spec/);
      },
      180000
    );
  });

  /**
   * US3: enableSpecPlan=false hides spec-plan tools
   */
  describe('US3: Spec-plan tools toggle', () => {
    itif(testConfig.enabled)(
      'should not expose spec-plan tools when enableSpecPlan is false',
      async () => {
        const runner = await EnhancedRunner.create({
          runtime: defaultNodeHostEnv,
          llm: {
            quickInit: {
              providers: [
                {
                  name: testConfig.provider,
                  apiKey: testConfig.apiKey,
                  baseUrl: testConfig.baseUrl,
                  models: [{ modelId: testConfig.testModel }],
                },
              ],
            },
            quickInitFactory: (providers) => LLMClient.quickInit({ providers }),
          },
          model: testConfig.testModel,
          session: { enabled: false },
          todolist: { enabled: false },
          commands: { enabled: false },
          specPlan: { enabled: false },
          builtinFilter: { fileRead: true, fileWrite: false, fileEdit: false },
        });

        const toolInfo = runner.getToolInfo();
        const specPlanTools = toolInfo.filter(
          (t) =>
            t.name === 'save_spec' ||
            t.name === 'read_spec' ||
            t.name === 'list_specs' ||
            t.name === 'update_spec_status' ||
            t.name === 'save_plan' ||
            t.name === 'read_plan' ||
            t.name === 'list_plans' ||
            t.name === 'update_plan_status'
        );

        expect(specPlanTools).toHaveLength(0);
      },
      120000
    );
  });
});
