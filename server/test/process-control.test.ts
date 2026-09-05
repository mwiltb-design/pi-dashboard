import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'node:test'
import { captureProcessIdentity, terminateProcessTree } from '../src/process-control.js'

async function processExists(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('terminateProcessTree removes a worker grandchild', { skip: process.platform !== 'win32' }, async () => {
  const grandchildScript = 'setInterval(() => {}, 1000)'
  const parentScript = `const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildScript)}], { stdio: 'ignore', windowsHide: true }); console.log(child.pid); setInterval(() => {}, 1000)`
  const parent = spawn(process.execPath, ['-e', parentScript], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
  const identity = await captureProcessIdentity(parent)
  const [line] = await once(parent.stdout!, 'data') as [Buffer]
  const grandchildPid = Number(line.toString('utf8').trim())
  assert.ok(Number.isInteger(grandchildPid) && grandchildPid > 0)

  await terminateProcessTree(parent, { identity, gracefulTimeoutMs: 1_000, forceTimeoutMs: 5_000 })
  await new Promise((resolve) => setTimeout(resolve, 250))
  assert.equal(await processExists(grandchildPid), false)
})
