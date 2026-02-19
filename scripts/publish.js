#!/usr/bin/env node

/**
 * Publish script that reads NPM token from .env.local
 */

const { readFileSync } = require('fs')
const { join } = require('path')
const { execSync } = require('child_process')

// Read .env.local file from project root
const envPath = join(__dirname, '..', '.env.local')
let envContent = ''

try {
  envContent = readFileSync(envPath, 'utf-8')
} catch (err) {
  console.error('Error reading .env.local from project root:', err.message)
  process.exit(1)
}

// Parse token from .env.local (supports various formats)
const tokenMatch = envContent.match(/NPM_TOKEN\s*=\s*(.+)/i) || 
                   envContent.match(/npm_token\s*=\s*(.+)/i) ||
                   envContent.match(/NPM_AUTH_TOKEN\s*=\s*(.+)/i)

const token = tokenMatch ? tokenMatch[1].trim().replace(/['"]/g, '') : null

if (!token) {
  console.error('NPM_TOKEN not found in .env.local')
  console.error('Please add one of the following:')
  console.error('  NPM_TOKEN=your_token_here')
  console.error('  npm_token=your_token_here')
  console.error('  NPM_AUTH_TOKEN=your_token_here')
  process.exit(1)
}

// Set npm token and publish
try {
  console.log('Setting npm authentication token...')
  execSync(`npm config set //registry.npmjs.org/:_authToken ${token}`, { stdio: 'inherit' })
  
  console.log('Publishing package to npm...')
  execSync('npm publish --access public', { stdio: 'inherit', cwd: join(__dirname, '..') })
  
  console.log('Package published successfully!')
} catch (err) {
  console.error('Error publishing:', err.message)
  process.exit(1)
}
