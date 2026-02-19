#!/usr/bin/env node

import('../dist/cli/index.js').then(({ runCLI }) => {
  runCLI(process.argv.slice(2))
}).catch(err => {
  console.error('Failed to start worlds-engine CLI:', err)
  process.exit(1)
})

