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
}

commands.register('serve', {
  description: 'Start an HTTP server for the collection with REST API and document serving',
  argsSchema,
  handler,
})
