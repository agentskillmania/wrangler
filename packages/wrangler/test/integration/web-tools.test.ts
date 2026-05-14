/**
 * E2E Integration Tests for Web Tools
 *
 * Tests the web_fetch tool with real LLM calls and actual network requests.
 * These tests verify that:
 * 1. The AgentRunner can use web_fetch to fetch real webpages
 * 2. The LLM correctly interprets the fetched content
 * 3. Error handling works end-to-end (e.g., 404 errors)
 *
 * Prerequisites:
 * - Set ENABLE_INTEGRATION_TESTS=true in .env
 * - Set OPENAI_API_KEY in .env
 */

import { describe, beforeAll, expect } from 'vitest';
import { AgentRunner, createAgentState, addUserMessage } from '@agentskillmania/colts';
import { createWebFetchTool } from '../../src/tools/builtin/web-fetch.js';
import { MarkdownMessageAssembler } from '../../src/runner/markdown-assembler.js';
import { testConfig, itif } from './config.js';

describe('Web Tools E2E Integration Tests', () => {
  beforeAll(() => {
    if (testConfig.enabled) {
      console.log(
        `[Web Tools E2E] Provider: ${testConfig.provider}, Model: ${testConfig.testModel}`
      );
    }
  });

  /**
   * Helper function to create an AgentRunner with web_fetch tool
   */
  function createWebFetchRunner() {
    const tools = [
      createWebFetchTool({
        workspacePath: '/tmp',
        timeout: 30000,
        maxOutputSize: 1024 * 1024, // 1MB
      }),
    ];

    return new AgentRunner({
      model: testConfig.testModel,
      llm: {
        apiKey: testConfig.apiKey,
        provider: testConfig.provider,
        baseUrl: testConfig.baseUrl,
      },
      tools,
      middleware: [],
      messageAssembler: new MarkdownMessageAssembler(),
    });
  }

  /**
   * US1: LLM fetches a real webpage and answers questions about it
   *
   * As an LLM, I use the web_fetch tool to fetch https://httpbin.org/html
   * and answer questions about the page content.
   */
  describe('US1: LLM fetches real webpage and answers questions', () => {
    itif(testConfig.enabled)(
      'should fetch httpbin.org/html and identify the page title',
      async () => {
        const runner = createWebFetchRunner();

        let state = createAgentState({
          name: 'web-fetch-agent',
          instructions:
            'You are a helpful assistant. Use the web_fetch tool to fetch webpages and answer questions about their content. Be concise.',
          tools: [],
        });

        state = addUserMessage(
          state,
          'Use the web_fetch tool to fetch https://httpbin.org/html and tell me what the page title is and what the main content is about.'
        );

        const { result, state: finalState } = await runner.run(state);

        // Verify the execution succeeded
        expect(result.type).toBe('success');

        // Verify the LLM's response references content from the page
        // httpbin.org/html returns HTML with "Herman Melville - Moby Dick" content
        const assistantMessages = finalState.context.messages.filter((m) => m.role === 'assistant');
        expect(assistantMessages.length).toBeGreaterThan(0);

        const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];
        const responseText =
          typeof lastAssistantMessage.content === 'string'
            ? lastAssistantMessage.content
            : JSON.stringify(lastAssistantMessage.content);

        // The response should mention either "Herman" or "Melville" or "Moby Dick" or "Herman Melville"
        const hasMention =
          responseText.toLowerCase().includes('herman') ||
          responseText.toLowerCase().includes('melville') ||
          responseText.toLowerCase().includes('moby');

        expect(
          hasMention,
          `Expected response to mention Herman Melville or Moby Dick, but got: ${responseText}`
        ).toBe(true);
      },
      60000
    );
  });

  /**
   * US2: LLM fetches JSON API and extracts data
   *
   * As an LLM, I use the web_fetch tool to fetch a JSON endpoint
   * and extract structured data from the response.
   */
  describe('US2: LLM fetches JSON API and extracts data', () => {
    itif(testConfig.enabled)(
      'should fetch httpbin.org/json and identify the slideshow',
      async () => {
        const runner = createWebFetchRunner();

        let state = createAgentState({
          name: 'json-fetch-agent',
          instructions:
            'You are a helpful assistant. Use the web_fetch tool to fetch JSON data and answer questions about it. Be concise.',
          tools: [],
        });

        state = addUserMessage(
          state,
          'Use the web_fetch tool to fetch https://httpbin.org/json and tell me what the slideshow title is.'
        );

        const { result, state: finalState } = await runner.run(state);

        // Verify the execution succeeded
        expect(result.type).toBe('success');

        // Verify the LLM's response mentions the slideshow
        const assistantMessages = finalState.context.messages.filter((m) => m.role === 'assistant');
        expect(assistantMessages.length).toBeGreaterThan(0);

        const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];
        const responseText =
          typeof lastAssistantMessage.content === 'string'
            ? lastAssistantMessage.content
            : JSON.stringify(lastAssistantMessage.content);

        // httpbin.org/json returns sample JSON with a slideshow
        expect(
          responseText.toLowerCase().includes('slide'),
          `Expected response to mention "slide" or "slideshow", but got: ${responseText}`
        ).toBe(true);
      },
      60000
    );
  });

  /**
   * US3: LLM handles fetch error gracefully
   *
   * As an LLM, I use the web_fetch tool to try fetching a URL that returns 404,
   * and I should gracefully communicate the error to the user.
   */
  describe('US3: LLM handles fetch error gracefully', () => {
    itif(testConfig.enabled)(
      'should attempt to fetch httpbin.org/status/404 and report the error',
      async () => {
        const runner = createWebFetchRunner();

        let state = createAgentState({
          name: 'error-handling-agent',
          instructions:
            'You are a helpful assistant. Use the web_fetch tool to fetch webpages. If the fetch fails, explain what went wrong to the user.',
          tools: [],
        });

        state = addUserMessage(
          state,
          'Use the web_fetch tool to try fetching https://httpbin.org/status/404 and tell me what happened.'
        );

        const { result, state: finalState } = await runner.run(state);

        // Verify the execution succeeded (even though the fetch failed, the agent should handle it gracefully)
        expect(result.type).toBe('success');

        // Verify the LLM's response mentions the error
        const assistantMessages = finalState.context.messages.filter((m) => m.role === 'assistant');
        expect(assistantMessages.length).toBeGreaterThan(0);

        const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];
        const responseText =
          typeof lastAssistantMessage.content === 'string'
            ? lastAssistantMessage.content
            : JSON.stringify(lastAssistantMessage.content);

        // The response should mention 404 or "not found" or "error"
        const hasErrorMention =
          responseText.toLowerCase().includes('404') ||
          responseText.toLowerCase().includes('not found') ||
          responseText.toLowerCase().includes('error');

        expect(
          hasErrorMention,
          `Expected response to mention the error (404, not found, or error), but got: ${responseText}`
        ).toBe(true);
      },
      60000
    );
  });

  /**
   * US4: LLM can fetch and compare multiple pages
   *
   * As an LLM, I use the web_fetch tool multiple times to fetch different pages
   * and compare their content.
   */
  describe('US4: LLM fetches and compares multiple pages', () => {
    itif(testConfig.enabled)(
      'should fetch two different httpbin endpoints and compare their responses',
      async () => {
        const runner = createWebFetchRunner();

        let state = createAgentState({
          name: 'multi-fetch-agent',
          instructions:
            'You are a helpful assistant. Use the web_fetch tool to fetch multiple URLs and compare their content. Be concise.',
          tools: [],
        });

        state = addUserMessage(
          state,
          'Use the web_fetch tool to fetch both https://httpbin.org/html and https://httpbin.org/json. Tell me briefly what type of content each endpoint returns.'
        );

        const { result, state: finalState } = await runner.run(state);

        // Verify the execution succeeded
        expect(result.type).toBe('success');

        // Verify the LLM's response mentions both HTML and JSON
        const assistantMessages = finalState.context.messages.filter((m) => m.role === 'assistant');
        expect(assistantMessages.length).toBeGreaterThan(0);

        const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];
        const responseText =
          typeof lastAssistantMessage.content === 'string'
            ? lastAssistantMessage.content
            : JSON.stringify(lastAssistantMessage.content);

        const responseTextLower = responseText.toLowerCase();

        // Should mention html and json
        expect(
          responseTextLower.includes('html') || responseTextLower.includes('hypertext'),
          `Expected response to mention HTML, but got: ${responseText}`
        ).toBe(true);

        expect(
          responseTextLower.includes('json'),
          `Expected response to mention JSON, but got: ${responseText}`
        ).toBe(true);
      },
      60000
    );
  });

  /**
   * US5: LLM handles plain text responses
   *
   * As an LLM, I use the web_fetch tool to fetch a plain text endpoint
   * and correctly interpret the content.
   */
  describe('US5: LLM handles plain text responses', () => {
    itif(testConfig.enabled)(
      'should fetch httpbin.org/robots.txt and identify it as a robots.txt file',
      async () => {
        const runner = createWebFetchRunner();

        let state = createAgentState({
          name: 'text-fetch-agent',
          instructions:
            'You are a helpful assistant. Use the web_fetch tool to fetch webpages and answer questions about their content. Be concise.',
          tools: [],
        });

        state = addUserMessage(
          state,
          'Use the web_fetch tool to fetch https://httpbin.org/robots.txt and tell me what type of file it is and what its main purpose is.'
        );

        const { result, state: finalState } = await runner.run(state);

        // Verify the execution succeeded
        expect(result.type).toBe('success');

        // Verify the LLM's response mentions robots.txt or disallow or user-agent
        const assistantMessages = finalState.context.messages.filter((m) => m.role === 'assistant');
        expect(assistantMessages.length).toBeGreaterThan(0);

        const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];
        const responseText =
          typeof lastAssistantMessage.content === 'string'
            ? lastAssistantMessage.content
            : JSON.stringify(lastAssistantMessage.content);

        const responseTextLower = responseText.toLowerCase();

        // Should mention robots.txt, disallow, or user-agent
        const hasRobotsMention =
          responseTextLower.includes('robots') ||
          responseTextLower.includes('user-agent') ||
          responseTextLower.includes('disallow') ||
          responseTextLower.includes('crawl');

        expect(
          hasRobotsMention,
          `Expected response to mention robots.txt or related concepts, but got: ${responseText}`
        ).toBe(true);
      },
      60000
    );
  });
});
