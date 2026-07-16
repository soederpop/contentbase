import { z } from 'zod'

// Base helper schemas — looseObject allows additional properties so subclass
// state types can structurally extend the base via z.infer<>
export const HelperStateSchema = z.looseObject({}).describe('Base state for all helpers')

export const HelperOptionsSchema = z.object({
  name: z.string().optional().describe('Optional name identifier for this helper instance'),
  _cacheKey: z.string().optional().describe('Internal cache key used for instance deduplication'),
}).describe('Base options for all helpers')

export const FeatureStateSchema = HelperStateSchema.extend({
  enabled: z.boolean().default(false).describe('Whether this feature is currently enabled'),
}).describe('Base feature state with enabled flag')

export const FeatureOptionsSchema = HelperOptionsSchema.extend({
  cached: z.boolean().optional().describe('Whether to cache this feature instance'),
  enable: z.boolean().optional().describe('Whether to automatically enable the feature on creation'),
}).describe('Base feature options with cached and enable flags')

export const ServerStateSchema = HelperStateSchema.extend({
  port: z.number().optional().describe('The port the server is bound to'),
  listening: z.boolean().default(false).describe('Whether the server is actively listening for connections'),
  configured: z.boolean().default(false).describe('Whether the server has been configured'),
  stopped: z.boolean().default(false).describe('Whether the server has been stopped'),
}).describe('Base server state with port and status information')

export const ServerOptionsSchema = HelperOptionsSchema.extend({
  port: z.number().positive().optional().describe('Port number to listen on'),
  host: z.string().optional().describe('Hostname or IP address to bind to'),
}).describe('Base server options with port and host settings')

// Events schemas — each key is an event name, value is z.tuple() of listener args
export const HelperEventsSchema = z.object({
  stateChange: z.tuple([z.any().describe('The current state object')]),
}).describe('Base events for all helpers')

export const FeatureEventsSchema = HelperEventsSchema.extend({
  enabled: z.tuple([]).describe('Emitted when the feature is enabled'),
}).describe('Base feature events')

export const ServerEventsSchema = HelperEventsSchema.extend({}).describe('Base server events')

// MCP Server schemas
export const MCPServerOptionsSchema = ServerOptionsSchema.extend({
  transport: z.enum(['stdio', 'http']).optional().describe('Transport type for MCP communication'),
  serverName: z.string().optional().describe('Server name reported to MCP clients'),
  serverVersion: z.string().optional().describe('Server version reported to MCP clients'),
  mcpCompat: z.enum(['standard', 'codex']).optional().describe('HTTP compatibility profile for MCP clients'),
  stdioCompat: z.enum(['standard', 'codex', 'auto']).optional().describe('Stdio framing compatibility profile for MCP clients'),
}).describe('MCP server options')

export const MCPServerStateSchema = ServerStateSchema.extend({
  transport: z.string().optional().describe('Active transport type'),
  toolCount: z.number().default(0).describe('Number of registered tools'),
  resourceCount: z.number().default(0).describe('Number of registered resources'),
  promptCount: z.number().default(0).describe('Number of registered prompts'),
}).describe('MCP server state with tool/resource/prompt counts')

export const MCPServerEventsSchema = ServerEventsSchema.extend({
  toolRegistered: z.tuple([z.string().describe('Tool name')]).describe('Emitted when a tool is registered'),
  resourceRegistered: z.tuple([z.string().describe('Resource URI')]).describe('Emitted when a resource is registered'),
  promptRegistered: z.tuple([z.string().describe('Prompt name')]).describe('Emitted when a prompt is registered'),
  toolCalled: z.tuple([z.string().describe('Tool name'), z.any().describe('Arguments')]).describe('Emitted when a tool is called'),
}).describe('MCP server events')

// Endpoint schemas
export const EndpointStateSchema = HelperStateSchema.extend({
  mounted: z.boolean().default(false).describe('Whether the endpoint is mounted on a server'),
  path: z.string().default('').describe('The URL path this endpoint is served from'),
  methods: z.array(z.string()).default([]).describe('HTTP methods this endpoint handles'),
  requestCount: z.number().default(0).describe('Total number of requests handled'),
}).describe('Base endpoint state')

export const EndpointOptionsSchema = HelperOptionsSchema.extend({
  path: z.string().describe('The URL path this endpoint is served from'),
  filePath: z.string().optional().describe('Absolute path to the endpoint source file'),
}).describe('Base endpoint options')

export const EndpointEventsSchema = HelperEventsSchema.extend({
  loaded: z.tuple([z.any().describe('The loaded endpoint module')]).describe('Emitted when the endpoint module is loaded'),
  mounted: z.tuple([z.string().describe('The path')]).describe('Emitted when the endpoint is mounted on a server'),
  request: z.tuple([z.string().describe('HTTP method'), z.string().describe('Path'), z.any().describe('Parameters')]).describe('Emitted on every request'),
  error: z.tuple([z.any().describe('The error object')]).describe('Emitted when a request handler throws'),
}).describe('Base endpoint events')
