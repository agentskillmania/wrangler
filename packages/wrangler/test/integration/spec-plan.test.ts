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

function makeRunner(tools: ToolDefinition[], middleware: any[]) {
  return new AgentRunner({
    model: testConfig.testModel,
    llm: {
      providers: [
        {
          name: testConfig.provider,
          apiKey: testConfig.apiKey,
          baseUrl: testConfig.baseUrl,
          models: [{ modelId: testConfig.testModel }],
        },
      ],
    },
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
   * When: LLM is instructed to generate a spec
   * Then: LLM produces structured spec with goals, requirements, acceptance criteria
   */
  describe('US1: LLM generates spec document', () => {
    itif(testConfig.enabled)(
      'should generate spec with structured content from feature description',
      async () => {
        const runner = makeRunner([], []);

        const instructions = `
You are a spec writer. Your job is to create structured specification documents from feature descriptions.

A good spec should include:
- **Goal**: A one-sentence summary of what you want to achieve
- **Background**: Why are we doing this? What problem does it solve?
- **Requirements**: Numbered list (FR-001, FR-002, etc.) using "must" for mandatory items
- **Acceptance Criteria**: Specific, measurable conditions for completion
- **Constraints**: Technical or business limitations

Write your response in markdown format with clear section headers.
`;

        let state = createAgentState({
          name: 'spec-writer',
          instructions,
          tools: [],
        });
        state = addUserMessage(
          state,
          'Create a spec for a user authentication feature. The system should allow users to register with email/password, login, logout, and reset passwords via email.'
        );

        const runResult = await runner.run(state);

        expect(runResult.result.type).toBe('success');

        // Get assistant messages
        const assistantMessages = runResult.state.context.messages.filter(
          (m) => m.role === 'assistant'
        );
        expect(assistantMessages.length).toBeGreaterThan(0);

        const lastAssistant = assistantMessages[assistantMessages.length - 1];
        const responseText =
          typeof lastAssistant.content === 'string'
            ? lastAssistant.content
            : JSON.stringify(lastAssistant.content);

        // Check for key spec elements (not exact formatting, but semantic content)
        expect(responseText.toLowerCase()).toMatch(/goal|background|objective/);
        expect(responseText.toLowerCase()).toMatch(/requirement|feature/);
        expect(responseText.toLowerCase()).toMatch(/auth|login|register|password/);
      },
      90000
    );
  });

  /**
   * US2: LLM reviews a spec document
   *
   * Given: A pre-written spec document
   * When: LLM is instructed to review the spec
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
You are a spec reviewer. Review specification documents against these quality dimensions:

1. **Coverage**: Are all scenarios covered with requirements? Does each requirement have acceptance criteria?
2. **Clarity**: Is there no ambiguity? Are all TBDs resolved? Is language clear (must/should, not might)?
3. **Feasibility**: Are requirements technically possible? No contradictions? Constraints align with requirements?
4. **Completeness**: Is there a clear goal? Background explains why? Success criteria are measurable?

Provide a review report with:
- Overall result: PASS or FAIL
- For each dimension: PASS or FAIL with explanation
- For FAIL items: specific suggestions for improvement

Write your review in markdown format.
`;

        let state = createAgentState({
          name: 'spec-reviewer',
          instructions,
          tools: [],
        });
        state = addUserMessage(state, `Please review this spec:\n\n${sampleSpec}`);

        const runResult = await runner.run(state);

        expect(runResult.result.type).toBe('success');

        // Get assistant messages
        const assistantMessages = runResult.state.context.messages.filter(
          (m) => m.role === 'assistant'
        );
        expect(assistantMessages.length).toBeGreaterThan(0);

        const lastAssistant = assistantMessages[assistantMessages.length - 1];
        const responseText =
          typeof lastAssistant.content === 'string'
            ? lastAssistant.content
            : JSON.stringify(lastAssistant.content);

        // Check for review elements
        expect(responseText.toLowerCase()).toMatch(/review|assessment|evaluation/);
        expect(responseText.toLowerCase()).toMatch(/pass|fail|通过|不通过/);
      },
      90000
    );
  });

  /**
   * US3: LLM generates a plan from a spec
   *
   * Given: An approved spec document
   * When: LLM is instructed to create an implementation plan
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
You are an implementation planner. Convert approved specs into actionable execution plans.

Break down the work into phases and tasks:
- **Phase 1**: Preparation - research, setup, environment
- **Phase 2**: Core work - main implementation
- **Phase 3**: Integration - connect components
- **Phase 4**: Verification - end-to-end testing

For each task:
- **Scope**: What does this task cover?
- **Spec Reference**: Which requirement(s) (FR-XXX)?
- **Acceptance**: Checklist of specific, verifiable conditions
- **Steps**: Detailed 2-5 minute steps with clear actions (no placeholders)

Rules:
- Each step must be 2-5 minutes
- No placeholders - be specific
- Every task must have acceptance criteria
- Mark parallel tasks with [P]

Write your plan in markdown format.
`;

        let state = createAgentState({
          name: 'plan-writer',
          instructions,
          tools: [],
        });
        state = addUserMessage(
          state,
          `Create an implementation plan for this spec:\n\n${approvedSpec}`
        );

        const runResult = await runner.run(state);

        expect(runResult.result.type).toBe('success');

        // Get assistant messages
        const assistantMessages = runResult.state.context.messages.filter(
          (m) => m.role === 'assistant'
        );
        expect(assistantMessages.length).toBeGreaterThan(0);

        const lastAssistant = assistantMessages[assistantMessages.length - 1];
        const responseText =
          typeof lastAssistant.content === 'string'
            ? lastAssistant.content
            : JSON.stringify(lastAssistant.content);

        // Check for plan elements
        expect(responseText.toLowerCase()).toMatch(/task|任务|phase|阶段/);
        expect(responseText.toLowerCase()).toMatch(/acceptance|验收|step|步骤/);
      },
      120000
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
You are a product planning agent. Execute a complete planning workflow:

Step 1 - Create Spec:
Write a specification document including:
- Goal: One-sentence summary
- Background: Why this is needed
- Requirements: Numbered (FR-001, FR-002) using "must" language
- Acceptance Criteria: Measurable completion conditions
- Constraints: Any limitations

Step 2 - Review Spec:
Review your spec against:
- Coverage: All scenarios have requirements
- Clarity: No ambiguity or TBDs
- Feasibility: Technically possible
- Completeness: Goal, background, measurable criteria

Provide PASS/FAIL for each dimension with feedback.

Step 3 - Create Plan:
Break down into phases (Prep, Core, Integration, Verification).
For each task include:
- Scope and spec reference
- Acceptance checklist
- Detailed 2-5 minute steps (no placeholders)

Execute all three steps for the feature request. Output each step clearly.
`;

        let state = createAgentState({
          name: 'planning-agent',
          instructions,
          tools: [],
        });
        state = addUserMessage(
          state,
          'I need a feature that allows users to upload profile pictures. Requirements: max file size 5MB, only JPG/PNG formats, generate thumbnail on upload.'
        );

        const runResult = await runner.run(state);

        expect(runResult.result.type).toBe('success');

        // Get assistant messages
        const assistantMessages = runResult.state.context.messages.filter(
          (m) => m.role === 'assistant'
        );
        expect(assistantMessages.length).toBeGreaterThan(0);

        const lastAssistant = assistantMessages[assistantMessages.length - 1];
        const responseText =
          typeof lastAssistant.content === 'string'
            ? lastAssistant.content
            : JSON.stringify(lastAssistant.content);

        // Check for workflow artifacts
        expect(responseText.toLowerCase()).toMatch(/spec|requirement|goal/);
        expect(responseText.toLowerCase()).toMatch(/plan|task|phase|step/);
        expect(responseText.toLowerCase()).toMatch(/upload|profile|picture|thumbnail/);
      },
      180000
    );
  });
});
