import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  jsonSchemaToZod,
  convertMCPTool,
  createMCPTool,
} from '../../../../src/tools/mcp/tool-converter.js';

describe('tool-converter', () => {
  describe('jsonSchemaToZod', () => {
    it('converts string schema to z.string()', () => {
      const schema = { type: 'string' };
      const result = jsonSchemaToZod(schema);
      expect(result).toBeInstanceOf(z.ZodString);
      expect(result.parse('hello')).toBe('hello');
    });

    it('converts number schema to z.number()', () => {
      const schema = { type: 'number' };
      const result = jsonSchemaToZod(schema);
      expect(result).toBeInstanceOf(z.ZodNumber);
      expect(result.parse(42)).toBe(42);
    });

    it('converts integer schema to z.number()', () => {
      const schema = { type: 'integer' };
      const result = jsonSchemaToZod(schema);
      expect(result).toBeInstanceOf(z.ZodNumber);
      expect(result.parse(42)).toBe(42);
    });

    it('converts boolean schema to z.boolean()', () => {
      const schema = { type: 'boolean' };
      const result = jsonSchemaToZod(schema);
      expect(result).toBeInstanceOf(z.ZodBoolean);
      expect(result.parse(true)).toBe(true);
    });

    it('converts array with items to z.array()', () => {
      const schema = {
        type: 'array',
        items: { type: 'string' },
      };
      const result = jsonSchemaToZod(schema);
      expect(result).toBeInstanceOf(z.ZodArray);
      expect(result.parse(['a', 'b'])).toEqual(['a', 'b']);
    });

    it('converts object with properties to z.object()', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      };
      const result = jsonSchemaToZod(schema);
      expect(result).toBeInstanceOf(z.ZodObject);

      // Valid data
      const valid = { name: 'John', age: 30 };
      expect(result.parse(valid)).toEqual(valid);

      // Missing required field should fail
      expect(() => result.parse({ age: 30 })).toThrow();

      // Missing optional field should work
      expect(result.parse({ name: 'John' })).toEqual({ name: 'John' });
    });

    it('marks non-required fields as optional', () => {
      const schema = {
        type: 'object',
        properties: {
          required: { type: 'string' },
          optional: { type: 'string' },
        },
        required: ['required'],
      };
      const result = jsonSchemaToZod(schema);

      // Should work with just required field
      expect(result.parse({ required: 'value' })).toEqual({ required: 'value' });

      // Should work with both fields
      expect(result.parse({ required: 'value', optional: 'opt' })).toEqual({
        required: 'value',
        optional: 'opt',
      });
    });

    it('handles empty properties object', () => {
      const schema = {
        type: 'object',
        properties: {},
      };
      const result = jsonSchemaToZod(schema);
      expect(result).toBeInstanceOf(z.ZodObject);
      expect(result.parse({})).toEqual({});
    });

    it('handles missing schema (undefined)', () => {
      const result = jsonSchemaToZod(undefined);
      expect(result).toBeInstanceOf(z.ZodObject);
      expect(result.parse({})).toEqual({});
    });

    it('handles nested object properties', () => {
      const schema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              age: { type: 'number' },
            },
            required: ['name'],
          },
        },
        required: ['user'],
      };
      const result = jsonSchemaToZod(schema);
      expect(result).toBeInstanceOf(z.ZodObject);

      // Valid nested data
      const valid = { user: { name: 'John' } };
      expect(result.parse(valid)).toEqual(valid);

      // Valid nested data with optional field
      const withOptional = { user: { name: 'John', age: 30 } };
      expect(result.parse(withOptional)).toEqual(withOptional);
    });

    it('handles array of objects', () => {
      const schema = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            name: { type: 'string' },
          },
          required: ['id'],
        },
      };
      const result = jsonSchemaToZod(schema);
      expect(result).toBeInstanceOf(z.ZodArray);

      const valid = [
        { id: 1, name: 'Item 1' },
        { id: 2 },
      ];
      expect(result.parse(valid)).toEqual(valid);
    });
  });

  describe('convertMCPTool', () => {
    it('creates tool with correct naming pattern (server__tool)', () => {
      const tool = convertMCPTool('my-server', 'my-tool', 'My description', {
        type: 'object',
        properties: {},
      });

      expect(tool.name).toBe('my-server__my-tool');
    });

    it('creates tool with correct description', () => {
      const description = 'This is a test tool';
      const tool = convertMCPTool('server', 'tool', description, {
        type: 'object',
        properties: {},
      });

      expect(tool.description).toBe(description);
    });

    it('creates tool with converted Zod schema', () => {
      const inputSchema = {
        type: 'object',
        properties: {
          message: { type: 'string' },
        },
        required: ['message'],
      };

      const tool = convertMCPTool('server', 'tool', 'description', inputSchema);

      expect(tool.parameters).toBeInstanceOf(z.ZodObject);

      // Should validate correctly
      expect(tool.parameters.parse({ message: 'hello' })).toEqual({
        message: 'hello',
      });

      // Should reject invalid data
      expect(() => tool.parameters.parse({})).toThrow();
    });

    it('creates stub execute that throws error', async () => {
      const tool = convertMCPTool('server', 'tool', 'description', {
        type: 'object',
        properties: {},
      });

      await expect(tool.execute({})).rejects.toThrow(
        'MCP tool not implemented: server__tool'
      );
    });

    it('handles empty properties (empty object schema)', () => {
      const inputSchema = {
        type: 'object',
        properties: {},
      };

      const tool = convertMCPTool('server', 'tool', 'description', inputSchema);

      expect(tool.parameters.parse({})).toEqual({});
    });

    it('handles undefined schema (defaults to empty object)', () => {
      const tool = convertMCPTool('server', 'tool', 'description', undefined);

      expect(tool.parameters).toBeInstanceOf(z.ZodObject);
      expect(tool.parameters.parse({})).toEqual({});
    });
  });

  describe('createMCPTool', () => {
    it('creates tool with wired execute callback', async () => {
      const callTool = vi.fn().mockResolvedValue('result from MCP');
      const tool = createMCPTool(
        'server',
        'tool',
        'description',
        {
          type: 'object',
          properties: {
            arg1: { type: 'string' },
          },
          required: ['arg1'],
        },
        callTool,
      );

      const result = await tool.execute({ arg1: 'value1' });

      expect(result).toBe('result from MCP');
      expect(callTool).toHaveBeenCalledWith('server', 'tool', {
        arg1: 'value1',
      });
    });

    it('passes signal to callTool when provided', async () => {
      const callTool = vi.fn().mockResolvedValue('result');
      const tool = createMCPTool(
        'server',
        'tool',
        'description',
        {
          type: 'object',
          properties: {
            arg1: { type: 'string' },
          },
          required: ['arg1'],
        },
        callTool,
      );

      const signal = new AbortController().signal;
      await tool.execute({ arg1: 'value1' }, { signal });

      expect(callTool).toHaveBeenCalledWith('server', 'tool', {
        arg1: 'value1',
      });
    });

    it('returns error string on callTool failure', async () => {
      const callTool = vi.fn().mockRejectedValue(new Error('MCP call failed'));
      const tool = createMCPTool('server', 'tool', 'description', {}, callTool);

      const result = await tool.execute({});

      expect(result).toBe('Error: MCP call failed');
    });

    it('returns error string with error message', async () => {
      const callTool = vi
        .fn()
        .mockRejectedValue(new Error('Connection timeout'));
      const tool = createMCPTool('server', 'tool', 'description', {}, callTool);

      const result = await tool.execute({});

      expect(result).toBe('Error: Connection timeout');
    });

    it('creates tool with correct naming', () => {
      const callTool = vi.fn();
      const tool = createMCPTool('my-server', 'my-tool', 'description', {}, callTool);

      expect(tool.name).toBe('my-server__my-tool');
    });

    it('creates tool with correct description', () => {
      const description = 'Test tool description';
      const callTool = vi.fn();
      const tool = createMCPTool('server', 'tool', description, {}, callTool);

      expect(tool.description).toBe(description);
    });

    it('creates tool with converted Zod schema', () => {
      const inputSchema = {
        type: 'object',
        properties: {
          count: { type: 'number' },
        },
        required: ['count'],
      };

      const callTool = vi.fn();
      const tool = createMCPTool('server', 'tool', 'description', inputSchema, callTool);

      expect(tool.parameters).toBeInstanceOf(z.ZodObject);
      expect(tool.parameters.parse({ count: 42 })).toEqual({ count: 42 });
    });

    it('validates parameters before calling callTool', async () => {
      const callTool = vi.fn();
      const inputSchema = {
        type: 'object',
        properties: {
          required: { type: 'string' },
        },
        required: ['required'],
      };

      const tool = createMCPTool('server', 'tool', 'description', inputSchema, callTool);

      // This should fail validation before calling callTool
      await expect(tool.execute({})).rejects.toThrow();
      expect(callTool).not.toHaveBeenCalled();
    });

    it('handles empty properties', async () => {
      const callTool = vi.fn().mockResolvedValue('ok');
      const tool = createMCPTool('server', 'tool', 'description', {}, callTool);

      await tool.execute({});

      expect(callTool).toHaveBeenCalledWith('server', 'tool', {});
    });

    it('handles undefined schema', async () => {
      const callTool = vi.fn().mockResolvedValue('ok');
      const tool = createMCPTool('server', 'tool', 'description', undefined, callTool);

      await tool.execute({});

      expect(callTool).toHaveBeenCalledWith('server', 'tool', {});
    });
  });
});
