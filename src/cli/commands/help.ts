import { commands } from '../registry.js'

async function handler(_options: any, _context: { container: any }) {
  console.log('cbase — An ORM for Markdown/MDX files\n')
  console.log('Usage: cbase <command> [options]\n')
  console.log('Commands:\n')

  for (const name of commands.available) {
    const def = commands.get(name)!
    console.log(`  ${name.padEnd(14)} ${def.description}`)
  }

  console.log()
}

commands.register('help', {
  description: 'Show available commands',
  handler,
})
