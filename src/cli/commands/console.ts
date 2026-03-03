import { z } from 'zod'
import { commands } from '../registry.js'
import { loadCollection } from '../load-collection.js'

const argsSchema = z.object({
  contentFolder: z.string().optional(),
})

async function handler(options: z.infer<typeof argsSchema>, context: { container: any }) {
  const container = context.container
  const ui = container.feature('ui')

  const collection = await loadCollection({
    contentFolder: options.contentFolder,
  })

  const featureContext: Record<string, any> = {
    collection,
  }

  // Expose all container features
  for (const name of container.features.available) {
    try {
      featureContext[name] = container.feature(name)
    } catch {}
  }

  // Load user console module if present
  const consoleModulePath = container.paths.resolve('cbase.console.ts')
  let consoleModuleLoaded = false
  let consoleModuleError: Error | null = null

  if (container.fs.exists(consoleModulePath)) {
    try {
      const vmFeature = container.feature('vm')
      const userExports = vmFeature.loadModule(consoleModulePath, { container, console, collection })
      Object.assign(featureContext, userExports)
      consoleModuleLoaded = true
    } catch (err: any) {
      consoleModuleError = err
    }
  }

  const prompt = ui.colors.cyan('cbase') + ui.colors.dim(' > ')

  console.log()
  console.log(ui.colors.dim('  Contentbase REPL — collection and container features in scope. Tab to autocomplete.'))
  if (consoleModuleLoaded) {
    console.log(ui.colors.dim('  Loaded cbase.console.ts exports into scope.'))
  } else if (consoleModuleError) {
    console.log(ui.colors.yellow('  Warning: Failed to load cbase.console.ts:'))
    console.log(ui.colors.yellow(`    ${consoleModuleError.message}`))
    console.log(ui.colors.dim('  The REPL will start without your custom exports.'))
  }
  console.log(ui.colors.dim('  Type .exit to quit.'))
  console.log()

  const repl = container.feature('repl', { prompt })
  await repl.start({
    context: {
      ...featureContext,
      console,
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
      fetch,
      Bun,
    },
  })
}

commands.register('console', {
  description: 'Start an interactive REPL with collection and container features in scope',
  help: `# cbase console

Start an interactive REPL with the loaded collection, all container features, and optional user-defined exports in scope. Useful for exploring and debugging your content.

## Usage

\`\`\`
cbase console [options]
\`\`\`

## Options

| Option | Description |
|--------|-------------|
| \`--contentFolder\` | Path to content folder |

## Scope

The REPL has these variables available:

- \`collection\` — The loaded Collection instance
- All luca container features (fs, ui, grep, etc.)
- Exports from \`cbase.console.ts\` if present in the project root

## Custom Console Module

Create a \`cbase.console.ts\` file in your project root to add custom helpers to the REPL scope:

\`\`\`typescript
export const myHelper = () => "hello from console"
\`\`\`

## Examples

\`\`\`bash
# Start the REPL
cbase console

# Start with a specific content folder
cbase console --contentFolder ./docs

# Once inside the REPL:
#   collection.available           — list all document IDs
#   collection.document('posts/hello')  — load a document
#   .exit                          — quit
\`\`\`
`,
  argsSchema,
  handler,
})
