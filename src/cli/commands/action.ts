import { z } from 'zod'
import { commands } from '../registry.js'
import { loadCollection } from '../load-collection.js'

const argsSchema = z.object({
  contentFolder: z.string().optional(),
})

async function handler(options: z.infer<typeof argsSchema>, context: { container: any }) {
  const collection = await loadCollection({
    contentFolder: options.contentFolder,
  })

  const actionName = context.container.argv._[1] as string | undefined

  if (!actionName) {
    console.error('Usage: cnotes action <name>')
    console.error(`Available: ${collection.availableActions.join(', ') || '(none)'}`)
    process.exit(1)
  }

  if (!collection.actions.has(actionName)) {
    console.error(
      `Action "${actionName}" not found. Available: ${collection.availableActions.join(', ') || '(none)'}`
    )
    process.exit(1)
  }

  const result = await collection.runAction(actionName)
  if (result !== undefined) {
    console.log(
      typeof result === 'string'
        ? result
        : JSON.stringify(result, null, 2)
    )
  }
}

commands.register('action', {
  description: 'Run a named action on the collection',
  usage: '<name>',
  help: `# cnotes action

Run a named action registered on the collection. Actions are custom functions defined in your collection's entry point.

## Usage

\`\`\`
cnotes action <name> [options]
\`\`\`

## Arguments

| Argument | Description |
|----------|-------------|
| \`name\` | The registered action name |

## Options

| Option | Description |
|--------|-------------|
| \`--contentFolder\` | Path to content folder |

## Output

If the action returns a value, it is printed to stdout (strings directly, objects as JSON).

## Examples

\`\`\`bash
# Run an action
cnotes action generate-report

# Run an action on a specific content folder
cnotes action sync --contentFolder ./docs

# List available actions (shows error with available names)
cnotes action
\`\`\`
`,
  argsSchema,
  handler,
})
