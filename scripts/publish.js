import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

function stripQuotes(value) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return
  }

  const content = readFileSync(filePath, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) {
      continue
    }

    const [, key, rawValue] = match
    if (process.env[key] === undefined) {
      process.env[key] = stripQuotes(rawValue)
    }
  }
}

for (const fileName of ['.env.local', '.env']) {
  loadEnvFile(resolve(process.cwd(), fileName))
}

const token =
  process.env.NODE_AUTH_TOKEN ??
  process.env.NPM_TOKEN

if (!token) {
  console.error('Missing NPM token. Set NODE_AUTH_TOKEN or NPM_TOKEN before publishing.')
  process.exit(1)
}

const result = spawnSync(
  process.platform === 'win32' ? 'npm publish --access public' : 'npm',
  process.platform === 'win32' ? process.argv.slice(2) : ['publish', '--access', 'public', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      NODE_AUTH_TOKEN: token,
    },
  },
)

if (typeof result.status === 'number') {
  process.exit(result.status)
}

process.exit(1)
