import { loadCollection } from '../cli/load-collection.js'
import { registerResources } from './resources.js'
import { registerQueryTools } from './tools/query.js'
import { registerSearchTools } from './tools/search.js'
import { registerMutationTools } from './tools/mutation.js'
import { registerPrompts } from './prompts.js'

export interface McpServerOptions {
  transport: 'stdio' | 'http'
  port: number
  contentFolder?: string
  modulePath?: string
  mcpCompat?: 'standard' | 'codex'
  stdioCompat?: 'standard' | 'codex' | 'auto'
  watch?: boolean
}

export async function createMcpServer(container: any, options: McpServerOptions) {
  const collection = await loadCollection({
    contentFolder: options.contentFolder,
    modulePath: options.modulePath,
  })
  const modelDefs = collection.modelDefinitions as any[]

  console.error(`[cnotes mcp] Loaded collection: ${collection.rootPath}`)
  console.error(`[cnotes mcp] Models: ${modelDefs.map((d: any) => d.name).join(', ') || '(none)'}`)
  console.error(`[cnotes mcp] Documents: ${collection.available.length}`)

  const mcpServer = container.server('mcp', {
    transport: options.transport,
    port: options.port,
    serverName: 'contentbase',
    serverVersion: '1.0.0',
    mcpCompat: options.mcpCompat,
    stdioCompat: options.stdioCompat,
  }) as any

  // Register all capabilities
  registerResources(mcpServer, collection)
  registerQueryTools(mcpServer, collection)
  registerSearchTools(mcpServer, collection, container)
  registerMutationTools(mcpServer, collection)
  registerPrompts(mcpServer, collection)

  return { mcpServer, collection }
}

export async function startMcpServer(container: any, options: McpServerOptions) {
  const envCompat = process.env.MCP_HTTP_COMPAT?.toLowerCase()
  const resolvedCompat = options.mcpCompat || (envCompat === 'codex' ? 'codex' : 'standard')
  const envStdioCompat = process.env.MCP_STDIO_COMPAT?.toLowerCase()
  const resolvedStdioCompat = options.stdioCompat
    || (envStdioCompat === 'codex' || envStdioCompat === 'auto' ? envStdioCompat : 'standard')

  const { mcpServer, collection } = await createMcpServer(container, options)

  await mcpServer.start({
    transport: options.transport,
    port: options.port,
    mcpCompat: options.mcpCompat,
    stdioCompat: options.stdioCompat,
  })

  if (options.transport === 'http') {
    console.log(`\nContentbase MCP listening on http://localhost:${options.port}/mcp`)
    console.log(`Transport: HTTP (Streamable)`)
    console.log(`Compatibility: ${resolvedCompat}`)
  } else {
    console.error(`[cnotes mcp] Server started (stdio transport)`)
    console.error(`[cnotes mcp] Stdio compatibility: ${resolvedStdioCompat}`)
    console.error(`[cnotes mcp] Tools: ${mcpServer._tools.size} | Resources: ${mcpServer._resources.size} | Prompts: ${mcpServer._prompts.size}`)
  }

  // File watching
  if (options.watch !== false) {
    const fileManager = container.feature('fileManager')
    await fileManager.start({ rootPath: collection.rootPath })
    await fileManager.watch()

    const { debounce } = container.utils.lodash
    const refreshCollection = debounce(async () => {
      try {
        const before = collection.available.length
        await collection.load({ refresh: true })
        const after = collection.available.length
        if (after !== before) {
          console.error(`[watch] Collection refreshed: ${before} → ${after} documents`)
        }
      } catch (err) {
        console.error(`[watch] Refresh failed: ${(err as Error).message}`)
      }
    }, 500)

    fileManager.on('file:change', (event: { type: string; path: string }) => {
      if (/\.(md|mdx)$/i.test(event.path)) {
        refreshCollection()
      }
    })
    console.error(`[cnotes mcp] Watching for file changes in ${collection.rootPath}`)
  }

  return { mcpServer, collection }
}
