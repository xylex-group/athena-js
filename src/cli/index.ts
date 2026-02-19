/**
 * CLI entry point
 * 
 * handles command line arguments and launches the appropriate command
 */

import { createCommands } from './commands.js'

export async function runCLI(args: string[]): Promise<void> {
  const commands = createCommands()
  const commandName = args[0] || 'help'

  const command = commands.find(c => c.name === commandName)

  if (!command) {
    console.error(`unknown command: ${commandName}`)
    console.log('run "worlds-engine help" for usage')
    process.exit(1)
  }

  await command.handler(args.slice(1))
}

