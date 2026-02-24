#!/usr/bin/env bun
import { commands } from './registry.js'

// Side-effect imports register all commands
import './commands/index.js'

async function main() {
  // Dynamic import so the library stays luca-free; only the CLI pulls it in
  const luca = await import('@soederpop/luca/node')
  const container = luca.default

  const commandName = container.argv._[0] as string | undefined

  if (!commandName || commandName === 'help') {
    const help = commands.get('help')!
    await help.handler({}, { container })
    return
  }

  if (!commands.has(commandName)) {
    console.error(`Unknown command: ${commandName}`)
    console.error(`Run "cbase help" to see available commands.\n`)
    process.exit(1)
  }

  const def = commands.get(commandName)!

  // Parse args from container.argv (minimist-parsed)
  const { _: _positional, ...flags } = container.argv
  let options = flags

  if (def.argsSchema) {
    const result = def.argsSchema.safeParse(flags)
    if (!result.success) {
      console.error(`Invalid options for "${commandName}":`)
      for (const issue of result.error.issues) {
        console.error(`  ${issue.path.join('.')}: ${issue.message}`)
      }
      process.exit(1)
    }
    options = result.data
  }

  await def.handler(options, { container })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
