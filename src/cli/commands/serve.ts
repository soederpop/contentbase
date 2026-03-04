import { z } from 'zod'
import path from 'node:path'
import fs from 'node:fs'
import { commands } from '../registry.js'
import { loadCollection } from '../load-collection.js'
import { buildSchemaJSON } from '../../api/helpers.js'

const argsSchema = z.object({
  port: z.number().default(8000),
  contentFolder: z.string().optional(),
  modulePath: z.string().optional(),
  endpointsDir: z.string().optional(),
  staticDir: z.string().optional(),
  cors: z.boolean().default(true),
  force: z.boolean().default(false),
  anyPort: z.boolean().default(false),
  open: z.boolean().default(false),
  readOnly: z.boolean().default(false),
  refreshInterval: z.number().optional(),
  watch: z.boolean().default(true),
})

async function handler(options: z.infer<typeof argsSchema>, context: { container: any }) {
  const container = context.container
  const { networking, proc } = container

  // Resolve content folder from positional arg or option
  const positionalFolder = container.argv._[1] as string | undefined
  const contentFolder = positionalFolder || options.contentFolder || undefined
  const modulePath = options.modulePath || undefined

  const collection = await loadCollection({ contentFolder, modulePath })
  const modelDefs = collection.modelDefinitions as any[]

  // Attach collection to container so endpoints can access it
  container._contentbaseCollection = collection
  container._contentbaseReadOnly = options.readOnly

  // ---------------------------------------------------------------------------
  // Port handling
  // ---------------------------------------------------------------------------
  let port = options.port

  if (options.anyPort) {
    port = await networking.findOpenPort(port + 1)
  }

  const isPortAvailable = await networking.isPortOpen(port)
  if (!isPortAvailable) {
    if (!options.force) {
      console.error(`Port ${port} is already in use.`)
      console.error(`Use --force to kill the process on this port, or --any-port to find another port.`)
      process.exit(1)
    }

    const pids = proc.findPidsByPort(port)
    if (!pids.length) {
      console.error(`Port ${port} is in use, but no PID could be discovered for termination.`)
      process.exit(1)
    }

    for (const pid of pids) {
      proc.kill(pid)
    }

    let portFreed = false
    for (let i = 0; i < 10; i++) {
      if (await networking.isPortOpen(port)) {
        portFreed = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    if (!portFreed) {
      console.error(`Failed to free port ${port} after terminating process(es): ${pids.join(', ')}`)
      process.exit(1)
    }
  }

  // ---------------------------------------------------------------------------
  // Static directory
  // ---------------------------------------------------------------------------
  const cwd = process.cwd()
  const staticDir = options.staticDir ? path.resolve(cwd, options.staticDir) : path.resolve(cwd, 'public')
  let resolvedStaticDir: string | undefined
  if (fs.existsSync(staticDir)) {
    resolvedStaticDir = staticDir
  } else if (fs.existsSync(path.resolve(cwd, 'index.html'))) {
    resolvedStaticDir = cwd
  }

  // ---------------------------------------------------------------------------
  // User endpoints directory
  // ---------------------------------------------------------------------------
  let userEndpointsDir: string | null = null
  if (options.endpointsDir) {
    const dir = path.resolve(cwd, options.endpointsDir)
    if (fs.existsSync(dir)) userEndpointsDir = dir
  } else {
    for (const candidate of ['endpoints', 'src/endpoints']) {
      const dir = path.resolve(cwd, candidate)
      if (fs.existsSync(dir)) {
        userEndpointsDir = dir
        break
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Express server
  // ---------------------------------------------------------------------------
  const expressServer = container.server('express', {
    port,
    cors: options.cors,
    static: resolvedStaticDir,
    historyFallback: false,
  }) as any

  // Load built-in contentbase endpoints
  const builtinEndpointsDir = path.resolve(import.meta.dir, '../../api/endpoints')
  await expressServer.useEndpoints(builtinEndpointsDir)

  // Load user endpoints if present
  if (userEndpointsDir) {
    await expressServer.useEndpoints(userEndpointsDir)
  }

  // Redirect root to /docs/ table of contents when no static index.html exists
  if (!resolvedStaticDir || !fs.existsSync(path.join(resolvedStaticDir, 'index.html'))) {
    expressServer.app.get('/', (_req: any, res: any) => {
      res.redirect('/docs/')
    })
  }

  // OpenAPI spec
  expressServer.serveOpenAPISpec({
    title: 'Contentbase API',
    version: '1.0.0',
    description: `REST API for ${collection.rootPath}`,
  })

  await expressServer.start({ port })

  // ---------------------------------------------------------------------------
  // Startup summary
  // ---------------------------------------------------------------------------
  const schema = buildSchemaJSON(collection)
  const modelNames = Object.keys(schema)

  console.log(`\nContentbase server listening on http://localhost:${port}`)
  console.log(`Collection: ${collection.rootPath}`)
  console.log(`Models: ${modelNames.join(', ') || '(none)'}`)
  console.log(`Documents: ${collection.available.length}`)
  if (options.readOnly) {
    console.log(`Mode: read-only (write endpoints disabled)`)
  }
  console.log(`OpenAPI spec: http://localhost:${port}/openapi.json`)

  if (resolvedStaticDir) {
    console.log(`Static files: ${resolvedStaticDir}`)
  }

  if (expressServer._mountedEndpoints?.length) {
    console.log(`\nEndpoints:`)
    for (const ep of expressServer._mountedEndpoints) {
      console.log(`  ${ep.methods.map((m: string) => m.toUpperCase()).join(', ').padEnd(20)} ${ep.path}`)
    }
  }

  console.log()

  if (options.open) {
    try {
      const opener = container.feature('opener')
      await opener.open(`http://localhost:${port}`)
    } catch (error) {
      console.warn(`Could not open browser automatically: ${(error as Error).message}`)
    }
  }

  // ---------------------------------------------------------------------------
  // File watching
  // ---------------------------------------------------------------------------
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
          console.log(`[watch] Collection refreshed: ${before} → ${after} documents`)
        }
      } catch (error) {
        console.warn(`[watch] Refresh failed: ${(error as Error).message}`)
      }
    }, 500)

    fileManager.on('file:change', (event: { type: string; path: string }) => {
      if (/\.(md|mdx)$/i.test(event.path)) {
        refreshCollection()
      }
    })
    console.log(`Watching for file changes in ${collection.rootPath}`)
  }

  // ---------------------------------------------------------------------------
  // Collection refresh interval (safety-net fallback)
  // ---------------------------------------------------------------------------
  const defaultInterval = container.isProduction ? 10 * 60 : 60 // seconds
  const intervalSeconds = options.refreshInterval ?? defaultInterval

  setInterval(async () => {
    try {
      const before = collection.available.length
      await collection.load({ refresh: true })
      const after = collection.available.length
      if (after !== before) {
        console.log(`[refresh] Collection rescanned: ${before} → ${after} documents`)
      }
    } catch (error) {
      console.warn(`[refresh] Failed to rescan collection: ${(error as Error).message}`)
    }
  }, intervalSeconds * 1000)

  console.log(`Refresh interval: every ${intervalSeconds}s`)
}

commands.register('serve', {
  description: 'Start an HTTP server for the collection with REST API and document serving',
  help: `# cbase serve

Start an HTTP server with REST API endpoints for querying, creating, updating, and deleting documents. Serves static files and auto-generates an OpenAPI spec.

## Usage

\`\`\`
cbase serve [contentFolder] [options]
\`\`\`

## Arguments

| Argument | Description |
|----------|-------------|
| \`contentFolder\` | Path to content folder (positional or via \`--contentFolder\`) |

## Options

| Option | Default | Description |
|--------|---------|-------------|
| \`--port\` | \`8000\` | Port to listen on |
| \`--force\` | \`false\` | Kill existing process on the port |
| \`--anyPort\` | \`false\` | Find next available port if taken |
| \`--open\` | \`false\` | Open browser after starting |
| \`--readOnly\` | \`false\` | Disable write endpoints |
| \`--cors\` | \`true\` | Enable CORS |
| \`--staticDir\` | \`public/\` | Directory for static file serving |
| \`--endpointsDir\` | auto | Directory for user endpoint modules |
| \`--modulePath\` | | Path to collection entry module |
| \`--refreshInterval\` | \`60\` | Seconds between collection rescans (fallback) |
| \`--disable-watch\` | \`false\` | Disable file watching for automatic collection refresh |
| \`--contentFolder\` | | Path to content folder |

## User Endpoints

Place endpoint modules in \`endpoints/\` or \`src/endpoints/\` and they'll be auto-mounted. Use \`--endpointsDir\` to override.

## Examples

\`\`\`bash
# Start on default port
cbase serve

# Serve a specific folder on a custom port
cbase serve ./docs --port 3000

# Force kill existing server and open browser
cbase serve --port 8000 --force --open

# Read-only mode for production
cbase serve --readOnly --port 8080

# Find any available port
cbase serve --anyPort
\`\`\`
`,
  argsSchema,
  handler,
})
