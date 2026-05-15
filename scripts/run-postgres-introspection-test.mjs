import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const composeFile = path.join(repoRoot, 'test', 'integration', 'postgres', 'docker-compose.yml')
const testFile = path.join(repoRoot, 'test', 'postgres-introspection.integration.test.ts')
const connectionString = 'postgres://postgres:postgres@127.0.0.1:55432/athena_js'

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
      ...options,
    })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
    })
  })
}

function waitForPostgres(port, host, timeoutMs) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()

    const attempt = () => {
      const socket = net.createConnection({ host, port })
      socket.once('connect', () => {
        socket.end()
        resolve()
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Postgres was not reachable at ${host}:${port} within ${timeoutMs}ms`))
          return
        }
        setTimeout(attempt, 500)
      })
    }

    attempt()
  })
}

async function main() {
  const dockerArgsPrefix = ['compose', '-f', composeFile]
  try {
    await run('docker', [...dockerArgsPrefix, 'up', '-d'], { cwd: repoRoot })
    await waitForPostgres(55432, '127.0.0.1', 60_000)

    await run(
      process.execPath,
      ['--import', 'tsx', '--test', testFile],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          PG_INTROSPECTION_URL: connectionString,
        },
      },
    )
  } finally {
    try {
      await run('docker', [...dockerArgsPrefix, 'down', '--volumes'], { cwd: repoRoot })
    } catch {
      // best effort cleanup
    }
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})

