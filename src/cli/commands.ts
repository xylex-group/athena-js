/**
 * CLI commands
 * 
 * command handlers for the CLI. pretty simple stuff.
 */

export interface Command {
  name: string
  description: string
  handler: (args: string[]) => Promise<void>
}

export function createCommands(): Command[] {
  return [
    {
      name: 'dashboard',
      description: 'open the real-time dashboard',
      handler: async () => {
        console.log('starting dashboard...')
        // dashboard is launched from the main CLI entry
      },
    },
    {
      name: 'help',
      description: 'show help',
      handler: async () => {
        console.log('worlds-engine - workflow orchestration')
        console.log('')
        console.log('commands:')
        console.log('  dashboard    open the real-time dashboard')
        console.log('  help         show this help')
        console.log('  version      show version')
        console.log('')
        console.log('built by floris from XYLEX Group')
      },
    },
    {
      name: 'version',
      description: 'show version',
      handler: async () => {
        console.log('worlds-engine v0.1.0')
      },
    },
  ]
}

