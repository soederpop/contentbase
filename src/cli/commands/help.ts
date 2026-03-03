import { commands } from '../registry.js'

async function handler(_options: any, context: { container: any }) {
  const ui = context.container.feature('ui')

  const lines: string[] = [
    '# cbase',
    '',
    'An ORM for structured Markdown/MDX files.',
    '',
    '## Usage',
    '',
    '```',
    'cbase <command> [options]',
    '```',
    '',
    '## Commands',
    '',
    '| Command | Description |',
    '|---------|-------------|',
  ]

  for (const name of commands.available) {
    const def = commands.get(name)!
    lines.push(`| \`${name}\` | ${def.description} |`)
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
    'cbase help',
    '',
    '# Show detailed help for a command',
    'cbase help serve',
    'cbase serve --help',
    '```',
  )

  console.log(ui.markdown(lines.join('\n')))
}

commands.register('help', {
  description: 'Show available commands',
  help: `# cbase help

Show available commands and usage information.

## Usage

\`\`\`
cbase help [command]
\`\`\`

## Arguments

| Argument | Description |
|----------|-------------|
| \`command\` | Show detailed help for a specific command |

## Examples

\`\`\`bash
# Show all commands
cbase help

# Show help for the serve command
cbase help serve
\`\`\`
`,
  handler,
})
