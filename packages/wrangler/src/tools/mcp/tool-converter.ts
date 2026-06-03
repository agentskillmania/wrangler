import type { Tool } from '@agentskillmania/colts';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

/**
 * Converts a JSON Schema type string to corresponding Zod type
 *
 * @param typeStr - JSON Schema type (string, number, integer, boolean, array, object)
 * @param schema - Full schema object (needed for array items and object properties)
 * @returns Zod type corresponding to the JSON Schema type
 */
function jsonSchemaTypeToZod(typeStr: string, schema?: Record<string, unknown>): ZodTypeAny {
  switch (typeStr) {
    case 'string':
      return z.string();
    case 'number':
    case 'integer':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'array':
      if (schema?.items && typeof schema.items === 'object') {
        const innerSchema = schema.items as Record<string, unknown>;
        return z.array(jsonSchemaToZod(innerSchema));
      }
      return z.array(z.any());
    case 'object':
      return convertObjectSchema(schema);
    default:
      return z.any();
  }
}

/**
 * Converts an object schema to Zod object schema
 *
 * @param schema - JSON Schema object definition
 * @returns Zod object schema
 */
function convertObjectSchema(schema?: Record<string, unknown>): z.ZodObject<z.ZodRawShape> {
  const properties = schema?.properties as Record<string, Record<string, unknown>> | undefined;
  const required = schema?.required as string[] | undefined;

  if (!properties || Object.keys(properties).length === 0) {
    return z.object({}).passthrough();
  }

  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [propName, propSchema] of Object.entries(properties)) {
    const propType = propSchema.type as string;
    let zodType = jsonSchemaTypeToZod(propType, propSchema);

    // Mark as optional if not in required array
    if (!required?.includes(propName)) {
      zodType = zodType.optional();
    }

    shape[propName] = zodType;
  }

  return z.object(shape).strict();
}

/**
 * Converts a JSON Schema to a Zod schema
 *
 * Handles:
 * - Primitive types: string, number, integer, boolean
 * - Complex types: array (with items), object (with properties + required)
 * - Missing/empty schema → empty object schema
 *
 * @param schema - JSON Schema object or undefined
 * @returns Corresponding Zod schema
 */
export function jsonSchemaToZod(schema?: Record<string, unknown>): ZodTypeAny {
  if (!schema || typeof schema !== 'object') {
    return z.object({}).passthrough();
  }

  const type = schema.type as string;

  if (!type) {
    // No type specified — accept any object shape (MCP servers may not declare schemas)
    return z.object({}).passthrough();
  }

  return jsonSchemaTypeToZod(type, schema);
}

/**
 * Converts an MCP tool definition to a colts Tool-like object
 *
 * Creates a tool with name "{serverName}__{toolName}" (double underscore separator),
 * converted Zod schema, and a stub execute that throws an error.
 *
 * @param serverName - MCP server name
 * @param toolName - MCP tool name
 * @param description - Tool description
 * @param inputSchema - JSON Schema for tool parameters
 * @returns Tool-like object (not fully wired to MCP)
 */
export function convertMCPTool(
  serverName: string,
  toolName: string,
  description: string,
  inputSchema?: Record<string, unknown>
): Tool<ZodTypeAny> {
  const name = `${serverName}__${toolName}`;
  const parameters = jsonSchemaToZod(inputSchema);

  return {
    name,
    description,
    parameters,
    async execute(_args: z.infer<typeof parameters>) {
      throw new Error(`MCP tool not implemented: ${name}`);
    },
  };
}

/**
 * Creates a fully-wired MCP tool with execute callback
 *
 * The execute function calls through the `callTool` callback:
 * `callTool(serverName, toolName, args)`. On error, returns error string
 * instead of throwing.
 *
 * @param serverName - MCP server name
 * @param toolName - MCP tool name
 * @param description - Tool description
 * @param inputSchema - JSON Schema for tool parameters
 * @param callTool - Callback function to invoke the MCP tool
 * @returns Fully-wired Tool
 */
export function createMCPTool(
  serverName: string,
  toolName: string,
  description: string,
  inputSchema: Record<string, unknown> | undefined,
  callTool: (
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<unknown>
): Tool<ZodTypeAny> {
  const name = `${serverName}__${toolName}`;
  const parameters = jsonSchemaToZod(inputSchema);

  return {
    name,
    description,
    parameters,
    async execute(args: z.infer<typeof parameters>, _options?: { signal?: AbortSignal }) {
      // Validate input parameters against the schema
      const parsedArgs = parameters.parse(args);

      try {
        return await callTool(serverName, toolName, parsedArgs as Record<string, unknown>);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return `Error: ${message}`;
      }
    },
  };
}
