#!/usr/bin/env bun
import { commands } from './registry.js'

// Side-effect imports register all commands
import './commands/index.js'

async function renderMarkdown(container: any, text: string) {
  const ui = container.feature('ui')
  console.log(ui.markdown(text))
}

async function main() {
  // Dynamic import so the library stays luca-free; only the CLI pulls it in
  const luca = await import('@soederpop/luca/node')
  const container = luca.default

  const commandName = container.argv._[0] as string | undefined
  const wantsHelp = container.argv.help || container.argv.h

  // Bare invocation or explicit "help" with no subcommand
  if (!commandName || (commandName === 'help' && !container.argv._[1])) {
    const help = commands.get('help')!
    await help.handler({}, { container })
    return
  }

  // `cbase help <command>` — show that command's help
  if (commandName === 'help' && container.argv._[1]) {
    const target = container.argv._[1] as string
    if (!commands.has(target)) {
      console.error(`Unknown command: ${target}`)
      console.error(`Run "cbase help" to see available commands.\n`)
      process.exit(1)
    }
    const def = commands.get(target)!
    if (def.help) {
      await renderMarkdown(container, def.help)
    } else {
      console.log(`${target} — ${def.description}\n`)
      console.log(`No detailed help available for this command.`)
    }
    return
  }

  if (!commands.has(commandName)) {
    console.error(`Unknown command: ${commandName}`)
    console.error(`Run "cbase help" to see available commands.\n`)
    process.exit(1)
  }

  const def = commands.get(commandName)!

  // `cbase <command> --help` — show that command's help
  if (wantsHelp) {
    if (def.help) {
      await renderMarkdown(container, def.help)
    } else {
      console.log(`${commandName} — ${def.description}\n`)
      console.log(`No detailed help available for this command.`)
    }
    return
  }

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
      if (def.help) {
        console.error(`\nRun "cbase ${commandName} --help" for usage information.`)
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
