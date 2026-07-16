import type { Container } from '../container.js'
import { z } from 'zod'
import { MCPServerStateSchema, MCPServerOptionsSchema, MCPServerEventsSchema } from '../schemas.js'
import { Server } from '../server.js'
import { Server as MCPProtocolServer } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  JSONRPCMessageSchema,
} from '@modelcontextprotocol/sdk/types.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

declare module '../server' {
  interface AvailableServers {
    mcp: typeof MCPServer
  }
}

export type MCPServerOptions = z.infer<typeof MCPServerOptionsSchema>
export type MCPServerState = z.infer<typeof MCPServerStateSchema>

/** Context object passed to all MCP tool, resource, and prompt handlers. */
export type MCPContext = {
  container: Container
}

/** A registered MCP tool with its schema, handler, and pre-computed JSON Schema. */
export interface RegisteredTool {
  name: string
  description?: string
  schema?: z.ZodType
  jsonSchema?: Record<string, any>
  handler: Function
}

/** A registered MCP resource with its URI, metadata, and handler. */
export interface RegisteredResource {
  uri: string
  name?: string
  description?: string
  mimeType?: string
  handler: (uri: string, ctx: MCPContext) => Promise<string> | string
}

/** A registered MCP prompt with its argument schemas and handler. */
export interface RegisteredPrompt {
  name: string
  description?: string
  args?: Record<string, z.ZodType>
  handler: (args: Record<string, string | undefined>, ctx: MCPContext) => Promise<PromptMessage[]> | PromptMessage[]
}

export type PromptMessage = {
  role: 'user' | 'assistant'
  content: string
}

type ToolRegistrationOptions = {
  schema?: z.ZodType
  description?: string
  handler?: Function | ((args: any, ctx: any) => any)
}

type ResourceRegistrationOptions = {
  name?: string
  description?: string
  mimeType?: string
  handler: (uri: string, ctx: MCPContext) => Promise<string> | string
}

type PromptRegistrationOptions = {
  description?: string
  args?: Record<string, z.ZodType>
  handler: (args: Record<string, string | undefined>, ctx: MCPContext) => Promise<PromptMessage[]> | PromptMessage[]
}

type MCPCompatMode = 'standard' | 'codex'
type StdioCompatMode = 'standard' | 'codex' | 'auto'

const SKIP_MESSAGE = Symbol('skip-message')

class CompatStdioServerTransport {
  private _readBuffer: Buffer | undefined
  private _started = false
  private _inputFormat: 'framed' | 'line' | undefined

  onmessage?: (message: any) => void
  onerror?: (error: Error) => void
  onclose?: () => void

  constructor(
    private readonly mode: Exclude<StdioCompatMode, 'standard'>,
    private readonly _stdin = process.stdin,
    private readonly _stdout = process.stdout,
  ) {}

  private _ondata = (chunk: Buffer) => {
    this._readBuffer = this._readBuffer ? Buffer.concat([this._readBuffer, chunk]) : chunk
    this.processReadBuffer()
  }

  private _onerror = (error: Error) => {
    this.onerror?.(error)
  }

  async start() {
    if (this._started) {
      throw new Error('CompatStdioServerTransport already started')
    }

    this._started = true
    this._stdin.on('data', this._ondata)
    this._stdin.on('error', this._onerror)
  }

  private processReadBuffer() {
    while (true) {
      try {
        const message = this._tryReadMessage()
        if (message === null) break
        if (message === SKIP_MESSAGE) continue
        this.onmessage?.(message)
      } catch (error) {
        this.onerror?.(error as Error)
      }
    }
  }

  private _tryReadMessage(): any | typeof SKIP_MESSAGE | null {
    if (!this._readBuffer || this._readBuffer.length === 0) {
      return null
    }

    const format = this._resolveInputFormat()
    if (!format) return null

    if (format === 'framed') {
      return this._readFramedMessage()
    }

    return this._readLineMessage()
  }

  private _resolveInputFormat(): 'framed' | 'line' | undefined {
    if (this._inputFormat) {
      return this._inputFormat
    }

    if (!this._readBuffer || this._readBuffer.length === 0) {
      return undefined
    }

    const prefix = this._readBuffer.toString('utf8', 0, Math.min(this._readBuffer.length, 128))
    if (/^\s*Content-Length\s*:/i.test(prefix)) {
      this._inputFormat = 'framed'
      return this._inputFormat
    }

    const firstByte = this._readBuffer.find((b) => ![0x20, 0x09, 0x0d, 0x0a].includes(b))
    if (firstByte === undefined) return undefined

    if (firstByte === 0x7b || firstByte === 0x5b) {
      this._inputFormat = 'line'
      return this._inputFormat
    }

    if (this._readBuffer.indexOf('\n') !== -1) {
      this._inputFormat = 'line'
      return this._inputFormat
    }

    return undefined
  }

  private _readFramedMessage(): any | null {
    if (!this._readBuffer) return null

    const crlfHeaderEnd = this._readBuffer.indexOf('\r\n\r\n')
    const lfHeaderEnd = this._readBuffer.indexOf('\n\n')

    if (crlfHeaderEnd === -1 && lfHeaderEnd === -1) {
      return null
    }

    let headerEnd = crlfHeaderEnd
    let headerSeparatorLength = 4

    if (headerEnd === -1 || (lfHeaderEnd !== -1 && lfHeaderEnd < headerEnd)) {
      headerEnd = lfHeaderEnd
      headerSeparatorLength = 2
    }

    const headerText = this._readBuffer.toString('utf8', 0, headerEnd)
    const headers = headerText.split(/\r?\n/)
    const lengthHeader = headers.find((line) => /^content-length\s*:/i.test(line))
    if (!lengthHeader) {
      throw new Error('Missing Content-Length header in framed stdio message')
    }

    const length = Number(lengthHeader.split(':')[1]?.trim())
    if (!Number.isFinite(length) || length < 0) {
      throw new Error(`Invalid Content-Length value: ${lengthHeader}`)
    }

    const bodyStart = headerEnd + headerSeparatorLength
    const bodyEnd = bodyStart + length
    if (this._readBuffer.length < bodyEnd) {
      return null
    }

    const body = this._readBuffer.toString('utf8', bodyStart, bodyEnd)
    this._readBuffer = this._readBuffer.subarray(bodyEnd)

    return JSONRPCMessageSchema.parse(JSON.parse(body))
  }

  private _readLineMessage(): any | typeof SKIP_MESSAGE | null {
    if (!this._readBuffer) return null

    const newlineIndex = this._readBuffer.indexOf('\n')
    if (newlineIndex === -1) {
      return null
    }

    const line = this._readBuffer.toString('utf8', 0, newlineIndex).replace(/\r$/, '')
    this._readBuffer = this._readBuffer.subarray(newlineIndex + 1)

    if (line.trim() === '') {
      return SKIP_MESSAGE
    }

    return JSONRPCMessageSchema.parse(JSON.parse(line))
  }

  async close() {
    this._stdin.off('data', this._ondata)
    this._stdin.off('error', this._onerror)

    if (this._stdin.listenerCount('data') === 0) {
      this._stdin.pause()
    }

    this._readBuffer = undefined
    this.onclose?.()
  }

  send(message: any) {
    return new Promise<void>((resolve) => {
      const json = JSON.stringify(message)
      const useFramed = this._inputFormat === 'line'
        ? false
        : (this.mode === 'codex' || this._inputFormat === 'framed')
      const payload = useFramed
        ? `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`
        : `${json}\n`

      if (this._stdout.write(payload)) {
        resolve()
      } else {
        this._stdout.once('drain', resolve)
      }
    })
  }
}

/**
 * MCP (Model Context Protocol) server for exposing tools, resources, and prompts
 * to AI clients like Claude Code. Uses the low-level MCP SDK Server class directly
 * with Zod 4 native JSON Schema conversion.
 *
 * Register tools, resources, and prompts programmatically, then start the server
 * over stdio (for CLI integration) or HTTP (for remote access).
 *
 * @example
 * ```ts
 * const mcp = container.server('mcp', { serverName: 'my-server', serverVersion: '1.0.0' })
 *
 * mcp.tool('search_files', {
 *   schema: z.object({ pattern: z.string() }),
 *   description: 'Search for files',
 *   handler: async (args, ctx) => {
 *     return ctx.container.feature('fs').walk('.', { include: [args.pattern] }).files.join('\n')
 *   }
 * })
 *
 * await mcp.start()
 * ```
 */
export class MCPServer extends Server<MCPServerState, MCPServerOptions> {
  static override shortcut = 'servers.mcp' as const
  static override stability = 'core' as const
  static override category = 'ai-assistants' as const
  static override stateSchema = MCPServerStateSchema
  static override optionsSchema = MCPServerOptionsSchema
  static override eventsSchema = MCPServerEventsSchema

  static { Server.register(this, 'mcp') }

  _mcpServer?: MCPProtocolServer
  _tools: Map<string, RegisteredTool> = new Map()
  _resources: Map<string, RegisteredResource> = new Map()
  _prompts: Map<string, RegisteredPrompt> = new Map()

  override get initialState(): MCPServerState {
    return {
      port: this.options.port,
      listening: false,
      configured: false,
      stopped: false,
      transport: undefined,
      toolCount: 0,
      resourceCount: 0,
      promptCount: 0,
    }
  }

  /** The underlying MCP protocol server instance. Created during configure(). */
  get mcpServer(): MCPProtocolServer {
    if (!this._mcpServer) {
      this.configure()
    }
    return this._mcpServer!
  }

  /** The handler context passed to all tool, resource, and prompt handlers. */
  get handlerContext(): MCPContext {
    return { container: this.container }
  }

  /**
   * Register an MCP tool. The tool's Zod schema is converted to JSON Schema
   * for the protocol listing, and used for runtime argument validation.
   *
   * Tool handlers can return a string (auto-wrapped as text content) or a
   * full CallToolResult object for advanced responses (images, errors, etc).
   *
   * @param name - Unique tool name
   * @param options - Tool schema, description, and handler
   */
  tool(name: string, options: ToolRegistrationOptions): this {
    let jsonSchema: Record<string, any> | undefined

    if (options.schema) {
      const full = (options.schema as any).toJSONSchema() as Record<string, any>
      jsonSchema = {
        type: full.type || 'object',
        properties: full.properties || {},
        ...(full.required ? { required: full.required } : {}),
      }
    }

    const registered: RegisteredTool = {
      name,
      description: options.description,
      schema: options.schema,
      jsonSchema,
      handler: options.handler ?? (() => {}),
    }

    this._tools.set(name, registered)
    this.state.set('toolCount', this._tools.size)
    this.emit('toolRegistered', name)

    return this
  }

  /**
   * Register an MCP resource. Resources expose data (files, configs, etc)
   * that AI clients can read by URI.
   *
   * Accepts either a handler function directly or an options object with
   * additional metadata (name, description, mimeType).
   *
   * @param uri - Unique resource URI (e.g. "project://readme")
   * @param handlerOrOptions - Handler function or options object with handler
   */
  resource(
    uri: string,
    handlerOrOptions: ResourceRegistrationOptions['handler'] | ResourceRegistrationOptions
  ): this {
    let registered: RegisteredResource

    if (typeof handlerOrOptions === 'function') {
      registered = { uri, handler: handlerOrOptions }
    } else {
      registered = {
        uri,
        name: handlerOrOptions.name,
        description: handlerOrOptions.description,
        mimeType: handlerOrOptions.mimeType,
        handler: handlerOrOptions.handler,
      }
    }

    this._resources.set(uri, registered)
    this.state.set('resourceCount', this._resources.size)
    this.emit('resourceRegistered', uri)

    return this
  }

  /**
   * Register an MCP prompt. Prompts are reusable message templates that
   * AI clients can invoke with optional string arguments.
   *
   * @param name - Unique prompt name
   * @param options - Prompt handler, optional args schema, and description
   */
  prompt(name: string, options: PromptRegistrationOptions): this {
    const registered: RegisteredPrompt = {
      name,
      description: options.description,
      args: options.args,
      handler: options.handler,
    }

    this._prompts.set(name, registered)
    this.state.set('promptCount', this._prompts.size)
    this.emit('promptRegistered', name)

    return this
  }

  /**
   * Configure the MCP protocol server and register all protocol handlers.
   * Called automatically before start() if not already configured.
   */
  override async configure(): Promise<this> {
    if (this.isConfigured) return this

    const serverName = this.options.serverName || this.container.manifest?.name || 'contentbase-mcp'
    const serverVersion = this.options.serverVersion || this.container.manifest?.version || '1.0.0'

    this._mcpServer = new MCPProtocolServer(
      { name: serverName, version: serverVersion },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      }
    )

    this._registerToolHandlers()
    this._registerResourceHandlers()
    this._registerPromptHandlers()

    this._mcpServer.onerror = (error) => {
      console.error('[MCP Server Error]', error)
    }

    this.state.set('configured', true)
    return this
  }

  /**
   * Start the MCP server with the specified transport.
   *
   * @param options - Transport configuration. Defaults to stdio.
   * @param options.transport - 'stdio' for CLI integration, 'http' for remote access
   * @param options.port - Port for HTTP transport (default 3001)
   */
  override async start(options?: {
    transport?: 'stdio' | 'http'
    port?: number
    host?: string
    mcpCompat?: MCPCompatMode
    stdioCompat?: StdioCompatMode
  }): Promise<this> {
    if (this.isListening) return this
    await this._drainPendingPlugins()
    if (!this.isConfigured) await this.configure()

    const transport = options?.transport || this.options.transport || 'stdio'

    if (transport === 'stdio') {
      const stdioCompat = this._resolveStdioCompat(options?.stdioCompat)
      const stdioTransport = stdioCompat === 'standard'
        ? new StdioServerTransport()
        : new CompatStdioServerTransport(stdioCompat)
      await this.mcpServer.connect(stdioTransport)
      this.state.set('transport', 'stdio')
    } else if (transport === 'http') {
      const port = options?.port || this.options.port || 3001
      const compat = this._resolveMCPCompat(options?.mcpCompat)
      await this._startHTTPTransport(port, compat)
      this.state.set('transport', 'http')
      this.state.set('port', port)
    }

    this.state.set('listening', true)
    return this
  }

  /**
   * Stop the MCP server and close all connections.
   */
  override async stop(): Promise<this> {
    if (this.isStopped) return this

    if (this._mcpServer) {
      await this._mcpServer.close()
    }

    this.state.set('listening', false)
    this.state.set('stopped', true)
    return this
  }

  /** Register tools/list and tools/call protocol handlers on a given MCP protocol server. */
  private _registerToolHandlers(target: MCPProtocolServer = this.mcpServer) {
    target.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = Array.from(this._tools.values()).map((t) => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.jsonSchema || { type: 'object' as const, properties: {} },
      }))

      return { tools }
    })

    target.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args = {} } = request.params

      const tool = this._tools.get(name)
      if (!tool) {
        return {
          content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
          isError: true,
        }
      }

      try {
        const validatedArgs = tool.schema ? tool.schema.parse(args) : args

        this.emit('toolCalled', name, validatedArgs)

        const result = await tool.handler(validatedArgs, this.handlerContext)

        if (typeof result === 'string') {
          return {
            content: [{ type: 'text' as const, text: result }],
          }
        }

        return result as CallToolResult
      } catch (error: any) {
        return {
          content: [{ type: 'text' as const, text: `Error calling tool ${name}: ${error.message}` }],
          isError: true,
        }
      }
    })
  }

  /** Register resources/list and resources/read protocol handlers on a given MCP protocol server. */
  private _registerResourceHandlers(target: MCPProtocolServer = this.mcpServer) {
    target.setRequestHandler(ListResourcesRequestSchema, async () => {
      const resources = Array.from(this._resources.values()).map((r) => ({
        uri: r.uri,
        name: r.name || r.uri,
        description: r.description,
        mimeType: r.mimeType,
      }))

      return { resources }
    })

    target.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params

      const resource = this._resources.get(uri)
      if (!resource) {
        throw new Error(`Unknown resource: ${uri}`)
      }

      const text = await resource.handler(uri, this.handlerContext)

      return {
        contents: [{
          uri,
          mimeType: resource.mimeType || 'text/plain',
          text,
        }],
      }
    })
  }

  /** Register prompts/list and prompts/get protocol handlers on a given MCP protocol server. */
  private _registerPromptHandlers(target: MCPProtocolServer = this.mcpServer) {
    target.setRequestHandler(ListPromptsRequestSchema, async () => {
      const prompts = Array.from(this._prompts.values()).map((p) => ({
        name: p.name,
        description: p.description,
        arguments: p.args
          ? Object.entries(p.args).map(([argName, schema]) => ({
              name: argName,
              description: (schema as any)._zod?.def?.description || '',
              required: !(schema as any).isOptional?.(),
            }))
          : undefined,
      }))

      return { prompts }
    })

    target.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args = {} } = request.params

      const prompt = this._prompts.get(name)
      if (!prompt) {
        throw new Error(`Unknown prompt: ${name}`)
      }

      const messages = await prompt.handler(args as Record<string, string | undefined>, this.handlerContext)

      return {
        messages: messages.map((m) => ({
          role: m.role,
          content: { type: 'text' as const, text: m.content },
        })),
      }
    })
  }

  /**
   * Create a fresh MCPProtocolServer with all registered handlers wired up.
   * Used by the HTTP transport to give each client session its own server instance,
   * avoiding the "Server already initialized" rejection on reconnects.
   */
  private _createSessionServer(): MCPProtocolServer {
    const serverName = this.options.serverName || this.container.manifest?.name || 'contentbase-mcp'
    const serverVersion = this.options.serverVersion || this.container.manifest?.version || '1.0.0'

    const server = new MCPProtocolServer(
      { name: serverName, version: serverVersion },
      { capabilities: { tools: {}, resources: {}, prompts: {} } },
    )

    server.onerror = (error) => {
      console.error('[MCP Server Error]', error)
    }

    this._registerToolHandlers(server)
    this._registerResourceHandlers(server)
    this._registerPromptHandlers(server)

    return server
  }

  /** Start an HTTP transport using StreamableHTTPServerTransport. */
  private async _startHTTPTransport(port: number, compat: MCPCompatMode): Promise<void> {
    const { createServer } = await import('node:http')
    const { StreamableHTTPServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/streamableHttp.js'
    )
    const { randomUUID } = await import('node:crypto')

    // Track active sessions: sessionId → transport. Each new initialize request
    // gets a fresh server+transport pair so reconnecting clients don't hit
    // "Server already initialized".
    const sessions = new Map<string, InstanceType<typeof StreamableHTTPServerTransport>>()

    const httpServer = createServer(async (req, res) => {
      if (compat === 'codex') {
        this._normalizeCodexRequest(req)
        this._ensureJSONContentType(res)
      }

      const url = new URL(req.url || '/', `http://localhost:${port}`)

      if (url.pathname !== '/mcp') {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32004, message: 'Not found' },
          id: null,
        }))
        return
      }

      let body: any
      if (req.method === 'POST') {
        const chunks: Buffer[] = []
        for await (const chunk of req) {
          chunks.push(chunk as Buffer)
        }
        body = JSON.parse(Buffer.concat(chunks).toString())
      }

      // Route to existing session if the client sent a session ID.
      const existingSessionId = req.headers['mcp-session-id'] as string | undefined
      if (existingSessionId && sessions.has(existingSessionId)) {
        const transport = sessions.get(existingSessionId)!
        await transport.handleRequest(req, res, body)
        return
      }

      // New session — only allow if this is an initialize request.
      const isInit = body?.method === 'initialize'
      if (!isInit) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'No active session. Send initialize first.' },
          id: body?.id ?? null,
        }))
        return
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: compat === 'codex' ? undefined : () => randomUUID(),
        enableJsonResponse: compat === 'codex',
        onsessioninitialized: (sessionId) => {
          sessions.set(sessionId, transport)
        },
      })

      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId)
        }
      }

      const sessionServer = this._createSessionServer()
      await sessionServer.connect(transport)
      await transport.handleRequest(req, res, body)
    })

    await new Promise<void>((resolve) => {
      httpServer.listen(port, () => resolve())
    })
  }

  private _resolveMCPCompat(explicit?: MCPCompatMode): MCPCompatMode {
    if (explicit === 'codex' || explicit === 'standard') {
      return explicit
    }

    if (this.options.mcpCompat === 'codex' || this.options.mcpCompat === 'standard') {
      return this.options.mcpCompat
    }

    const envValue = process.env.MCP_HTTP_COMPAT?.toLowerCase()
    if (envValue === 'codex') {
      return 'codex'
    }

    return 'standard'
  }

  private _resolveStdioCompat(explicit?: StdioCompatMode): StdioCompatMode {
    if (explicit === 'codex' || explicit === 'auto' || explicit === 'standard') {
      return explicit
    }

    if (
      this.options.stdioCompat === 'codex'
      || this.options.stdioCompat === 'auto'
      || this.options.stdioCompat === 'standard'
    ) {
      return this.options.stdioCompat
    }

    const envValue = process.env.MCP_STDIO_COMPAT?.toLowerCase()
    if (envValue === 'codex' || envValue === 'auto') {
      return envValue
    }

    return 'standard'
  }

  private _normalizeCodexRequest(req: any) {
    if (req.method !== 'POST') return

    const accept = req.headers.accept

    if (typeof accept === 'string') {
      if (!accept.includes('application/json')) {
        req.headers.accept = `application/json, ${accept}`
      }
      if (!req.headers.accept.includes('text/event-stream')) {
        req.headers.accept = `${req.headers.accept}, text/event-stream`
      }
      return
    }

    if (Array.isArray(accept)) {
      const joined = accept.join(', ')
      req.headers.accept = `${joined}, text/event-stream`
      if (!req.headers.accept.includes('application/json')) {
        req.headers.accept = `application/json, ${req.headers.accept}`
      }
      return
    }

    req.headers.accept = 'application/json, text/event-stream'
  }

  private _ensureJSONContentType(res: any) {
    const originalWriteHead = res.writeHead.bind(res)

    res.writeHead = ((statusCode: number, ...args: any[]) => {
      let statusMessage: string | undefined
      let headers: any

      if (typeof args[0] === 'string') {
        statusMessage = args[0]
        headers = args[1]
      } else {
        headers = args[0]
      }

      const hasContentType = (input: any): boolean => {
        if (!input) return false

        if (Array.isArray(input)) {
          for (let i = 0; i < input.length; i += 2) {
            const key = String(input[i] || '').toLowerCase()
            if (key === 'content-type') return true
          }
          return false
        }

        return Object.keys(input).some((k) => k.toLowerCase() === 'content-type')
      }

      if (headers && !hasContentType(headers)) {
        if (Array.isArray(headers)) {
          headers = [...headers, 'Content-Type', 'application/json; charset=utf-8']
        } else {
          headers = { ...headers, 'Content-Type': 'application/json; charset=utf-8' }
        }
      } else if (!headers && !res.hasHeader('content-type')) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
      }

      if (statusMessage !== undefined && headers !== undefined) {
        return originalWriteHead(statusCode, statusMessage, headers)
      }
      if (statusMessage !== undefined) {
        return originalWriteHead(statusCode, statusMessage)
      }
      if (headers !== undefined) {
        return originalWriteHead(statusCode, headers)
      }

      return originalWriteHead(statusCode)
    }) as typeof res.writeHead
  }
}

export default MCPServer
