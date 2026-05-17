#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const binPath = fileURLToPath(import.meta.url)
const packageRoot = path.resolve(path.dirname(binPath), '..')
const cliEntrypointPath = path.resolve(packageRoot, 'dist', 'cli', 'index.js')
const packageJsonPath = path.resolve(packageRoot, 'package.json')

function getInstalledVersion() {
  try {
    const packageJsonRaw = readFileSync(packageJsonPath, 'utf8')
    const packageJson = JSON.parse(packageJsonRaw)
    return typeof packageJson.version === 'string' ? packageJson.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

function printMissingEntrypointError() {
  const installedVersion = getInstalledVersion()
  console.error(
    [
      'Failed to start athena-js CLI: package install is missing the generated CLI entrypoint.',
      `Expected file: ${cliEntrypointPath}`,
      `Installed package version: ${installedVersion}`,
      '',
      'Fix by reinstalling the latest package:',
      '  pnpm add -g @xylex-group/athena@latest',
    ].join('\n'),
  )
}

function formatRuntimeError(error) {
  if (error instanceof Error) {
    if (process.env.ATHENA_JS_DEBUG === '1') {
      return error.stack ?? error.message;
    }
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown error.';
}

async function main() {
  if (!existsSync(cliEntrypointPath)) {
    printMissingEntrypointError();
    process.exit(1);
    return;
  }

  try {
    const cliEntrypointUrl = pathToFileURL(cliEntrypointPath).href;
    const cliModule = await import(cliEntrypointUrl);
    if (typeof cliModule.runCLI !== 'function') {
      throw new Error('CLI module does not export runCLI.');
    }
    await cliModule.runCLI(process.argv.slice(2));
  } catch (err) {
    const errorDetail = formatRuntimeError(err);
    if (errorDetail.includes('\n')) {
      console.error(`Failed to start athena-js CLI:\n${errorDetail}`);
    } else {
      console.error(`Failed to start athena-js CLI: ${errorDetail}`);
    }
    process.exit(1);
  }
}

void main()
