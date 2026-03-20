import { commands } from '../registry.js'

async function handler(_options: any, context: { container: any }) {
  const ui = context.container.feature('ui')

  const lines: string[] = [
    '# cnotes',
    '',
    'An ORM for structured Markdown/MDX files.',
    '',
    '## Usage',
    '',
    '```',
    'cnotes <command> [options]',
    '```',
    '',
    '## Commands',
    '',
    '| Command | Description |',
    '|---------|-------------|',
  ]

  for (const name of commands.available) {
    const def = commands.get(name)!
    const label = def.usage ? `${name} ${def.usage}` : name
    lines.push(`| \`${label}\` | ${def.description} |`)
  }

  lines.push(
    '',
    '## Global Options',
    '',
    '| Option | Description |',
    '|--------|-------------|',
    '| `--help`, `-h` | Show help for a command |',
    '| `--contentFolder` | Path to content folder (most commands) |',
    '',
    '## Getting Help',
    '',
    '```bash',
    '# Show this overview',
    'cnotes help',
    '',
    '# Show detailed help for a command',
    'cnotes help serve',
    'cnotes serve --help',
    '```',
  )

  console.log(ui.markdown(lines.join('\n')))
}

commands.register('help', {
  description: 'Show available commands',
  help: `# cnotes help

Show available commands and usage information.

## Usage

\`\`\`
cnotes help [command]
\`\`\`

## Arguments

| Argument | Description |
|----------|-------------|
| \`command\` | Show detailed help for a specific command |

## Examples

\`\`\`bash
# Show all commands
cnotes help

# Show help for the serve command
cnotes help serve
\`\`\`
`,
  handler,
})
