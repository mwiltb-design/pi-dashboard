import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { WorkerSupervisorClient } from '../src/worker-supervisor-client.js'
import type { WorkerSupervisorConfig } from '../src/worker-supervisor-types.js'

test('one named-pipe supervisor owns a data directory and secondary clients reconnect', async () => {
  const root = await mkdtemp(join(tmpdir(), 'foci-supervisor-test-'))
  const workspace = join(root, 'workspace')
  const dataDir = join(root, 'data')
  await Promise.all([mkdir(workspace), mkdir(dataDir)])
  const config: WorkerSupervisorConfig = {
    schemaVersion: 1,
    dataDir,
    workspace,
    storePath: join(dataDir, 'worker-tasks.json'),
    archivePath: join(dataDir, 'worker-tasks-archive.json'),
    rulesRoot: join(dataDir, 'rules'),
    pluginToolsExtension: join(root, 'unused-extension.ts'),
    enabled: false,
    bounds: { timeoutMs: 60_000, turnLimit: 5, resultLimitBytes: 4_096 },
  }
  const first = new WorkerSupervisorClient(config)
  const second = new WorkerSupervisorClient(config)
  try {
    await Promise.all([first.initialize(), second.initialize()])
    const [firstInfo, secondInfo] = await Promise.all([first.info(), second.info()])
    assert.equal(firstInfo.pid, secondInfo.pid)
    const snapshot = await second.snapshot()
    assert.deepEqual(snapshot.tasks, [])
    assert.equal(snapshot.activeTaskId, undefined)

    await first.shutdown()
    await new Promise((resolve) => setTimeout(resolve, 250))
    const restartedSnapshot = await second.snapshot()
    const restartedInfo = await second.info()
    assert.deepEqual(restartedSnapshot.tasks, [])
    assert.notEqual(restartedInfo.pid, firstInfo.pid)
  } finally {
    await first.shutdown().catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 250))
    await rm(root, { recursive: true, force: true })
  }
})
