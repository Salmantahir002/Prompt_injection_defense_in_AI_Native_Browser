import { spawn } from 'node:child_process'

// Electron treats this inherited setting as an instruction to run as Node.js.
delete process.env.ELECTRON_RUN_AS_NODE

const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('This script must be run with npm.')

const child = spawn(process.execPath, [npmCli, 'run', 'dev:processes'], { env: process.env, stdio: 'inherit' })

child.once('error', (error) => {
  console.error(error)
  process.exitCode = 1
})
child.once('exit', (code) => {
  process.exitCode = code ?? 1
})
