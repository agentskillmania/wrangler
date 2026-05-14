/**
 * Spec/Plan E2E Integration Tests — Real LLM Calls
 *
 * Tests the LLM-driven spec/plan workflows where agents:
 * - Generate spec documents from feature descriptions
 * - Review spec documents against quality standards
 * - Generate implementation plans from approved specs
 * - Execute full lifecycle: spec → review → plan
 *
 * These are NOT file system tests — SpecStore/PlanStore CRUD is covered in unit tests.
 * These tests verify that LLMs can follow skill instructions and produce structured artifacts.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  AgentRunner,
  createAgentState,
  addUserMessage,
  type ToolDefinition,
} from '@agentskillmania/colts';
import { testConfig, itif } from './config.js';
import {
  WRITING_SPEC_CONTENT,
  REVIEW_SPEC_CONTENT,
  WRITING_PLAN_CONTENT,
} from '../../src/spec-plan/index.js';

function makeRunner(tools: ToolDefinition[], middleware: any[]) {
  return new AgentRunner({
    model: testConfig.testModel,
    llm: { apiKey: testConfig.apiKey, provider: testConfig.provider, baseUrl: testConfig.baseUrl },
    tools,
    middleware,
  });
}

describe('Spec/Plan E2E Integration', () => {
  beforeAll(() => {
    if (testConfig.enabled) {
      console.log(
        `[Wrangler Integration] Provider: ${testConfig.provider}, Model: ${testConfig.testModel}`
      );
    }
  });

  /**
   * US1: LLM generates a spec document
   *
   * Given: A feature description for user authentication
   * When: LLM is instructed with WRITING_SPEC_CONTENT
   * Then: LLM produces structured spec with goals, requirements, acceptance criteria
   */
  describe('US1: LLM generates spec document', () => {
    itif(testConfig.enabled)(
      'should generate spec with structured content from feature description',
      async () => {
        const runner = makeRunner([], []);

        const instructions = `
You are a spec writer. Follow these instructions:

${WRITING_SPEC_CONTENT}

Today's task: Create a spec for a "user authentication" feature.
The system should allow users to register, login, and logout.
Users should be able to reset their password via email.
`;

        let state = createAgentState({
          name: 'spec-writer',
          instructions,
          tools: [],
        });
        state = addUserMessage(state, 'Create a spec for user authentication feature');

        const { result } = await runner.run(state);

        expect(result.type).toBe('success');

        // Verify LLM output contains spec-like structure
        const lastMessage = state.context.messages[state.context.messages.length - 1];
        const responseText =
          typeof lastMessage.content === 'string'
            ? lastMessage.content
            : JSON.stringify(lastMessage.content);

        // Check for key spec elements (not exact formatting, but semantic content)
        expect(responseText.toLowerCase()).toMatch(/goal|objectiv/);
        expect(responseText.toLowerCase()).toMatch(/requirement|feature/);
        expect(responseText.toLowerCase()).toMatch(/auth|login|register/);
      },
      60000
    );
  });

  /**
   * US2: LLM reviews a spec document
   *
   * Given: A pre-written spec document
   * When: LLM is instructed with REVIEW_SPEC_CONTENT
   * Then: LLM produces review with dimensions, pass/fail, suggestions
   */
  describe('US2: LLM reviews spec document', () => {
    itif(testConfig.enabled)(
      'should review spec and provide structured feedback',
      async () => {
        const runner = makeRunner([], []);

        const sampleSpec = `
# User Login Feature

## Goal
Allow users to authenticate with email and password.

## Requirements
- FR-001: Users must be able to register with email and password
- FR-002: Users must be able to login with email and password
- FR-003: Users must be able to logout

## Acceptance Criteria
- Registration validates email format
- Login fails with wrong credentials
- Logout clears session
`;

        const instructions = `
You are a spec reviewer. Follow these instructions:

${REVIEW_SPEC_CONTENT}

Review the following spec document and provide feedback.
`;

        let state = createAgentState({
          name: 'spec-reviewer',
          instructions,
          tools: [],
        });
        state = addUserMessage(state, `Please review this spec:\n\n${sampleSpec}`);

        const { result } = await runner.run(state);

        expect(result.type).toBe('success');

        // Verify review contains structured feedback
        const lastMessage = state.context.messages[state.context.messages.length - 1];
        const responseText =
          typeof lastMessage.content === 'string'
            ? lastMessage.content
            : JSON.stringify(lastMessage.content);

        // Check for review elements
        expect(responseText.toLowerCase()).toMatch(/review|审查/);
        expect(responseText.toLowerCase()).toMatch(/pass|通过|fail|不通过/);
      },
      60000
    );
  });

  /**
   * US3: LLM generates a plan from a spec
   *
   * Given: An approved spec document
   * When: LLM is instructed with WRITING_PLAN_CONTENT
   * Then: LLM produces structured plan with tasks, checkboxes, acceptance criteria
   */
  describe('US3: LLM generates plan from spec', () => {
    itif(testConfig.enabled)(
      'should generate implementation plan with tasks and acceptance criteria',
      async () => {
        const runner = makeRunner([], []);

        const approvedSpec = `
# User Authentication Spec (APPROVED)

## Goal
Implement email/password authentication for web application.

## Requirements
- FR-001: User registration with email validation
- FR-002: User login with password hashing
- FR-003: Password reset via email token

## Acceptance Criteria
- Registration rejects invalid emails
- Passwords are hashed using bcrypt
- Reset tokens expire after 1 hour
`;

        const instructions = `
You are a plan writer. Follow these instructions:

${WRITING_PLAN_CONTENT}

Create an implementation plan for the following approved spec.
`;

        let state = createAgentState({
          name: 'plan-writer',
          instructions,
          tools: [],
        });
        state = addUserMessage(state, `Create a plan for this spec:\n\n${approvedSpec}`);

        const { result } = await runner.run(state);

        expect(result.type).toBe('success');

        // Verify plan contains task structure
        const lastMessage = state.context.messages[state.context.messages.length - 1];
        const responseText =
          typeof lastMessage.content === 'string'
            ? lastMessage.content
            : JSON.stringify(lastMessage.content);

        // Check for plan elements
        expect(responseText.toLowerCase()).toMatch(/task|任务|phase|阶段/);
        expect(responseText.toLowerCase()).toMatch(/acceptance|验收|step|步骤/);
      },
      60000
    );
  });

  /**
   * US4: Full lifecycle — spec → review → plan
   *
   * Given: A feature request
   * When: LLM executes full workflow
   * Then: All three artifacts are produced with proper structure
   */
  describe('US4: Full lifecycle — spec → review → plan', () => {
    itif(testConfig.enabled)(
      'should execute complete workflow from feature request to implementation plan',
      async () => {
        const runner = makeRunner([], []);

        const instructions = `
You are a product planning agent. Your job is to:
1. First, create a spec for the requested feature using these instructions:
${WRITING_SPEC_CONTENT}

2. Then, review your own spec using these instructions:
${REVIEW_SPEC_CONTENT}

3. Finally, create an implementation plan using these instructions:
${WRITING_PLAN_CONTENT}

Execute all three steps in sequence for the feature request.
`;

        let state = createAgentState({
          name: 'planning-agent',
          instructions,
          tools: [],
        });
        state = addUserMessage(
          state,
          'I need a feature that allows users to upload profile pictures with size limits and format validation.'
        );

        const { result } = await runner.run(state);

        expect(result.type).toBe('success');

        // Verify all three artifacts are mentioned/produced
        const lastMessage = state.context.messages[state.context.messages.length - 1];
        const responseText =
          typeof lastMessage.content === 'string'
            ? lastMessage.content
            : JSON.stringify(lastMessage.content);

        // Check for workflow artifacts
        expect(responseText.toLowerCase()).toMatch(/spec|plan/);
        expect(responseText.toLowerCase()).toMatch(/upload|profile|picture/);
      },
      120000
    );
  });
});
