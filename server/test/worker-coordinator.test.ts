import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { WorkerCoordinator } from '../src/worker-coordinator.js'
import type { WorkerAdapter, WorkerRunHooks, WorkerRunInput, WorkerRunOutput } from '../src/worker-types.js'
import type { WorkerRulesService } from '../src/worker-rules.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for test condition')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('WorkerCoordinator serializes simultaneous submissions and runs both in order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'worker-coordinator-'))
  const releases = new Map<string, ReturnType<typeof deferred<WorkerRunOutput>>>()
  const started: string[] = []
  const adapter: WorkerAdapter = {
    provider: {
      id: 'fake',
      name: 'Fake worker',
      description: 'Test worker',
      kind: 'external',
      status: 'ready',
      statusLabel: 'Ready',
      modes: ['research'],
      enabled: true,
    },
    async run(input: WorkerRunInput, _hooks: WorkerRunHooks) {
      started.push(input.taskId)
      const release = deferred<WorkerRunOutput>()
      releases.set(input.taskId, release)
      return release.promise
    },
    async cancel() {},
  }
  const rules = {
    async initialize() {},
    async loadConfig() {
      await new Promise((resolve) => setTimeout(resolve, 25))
      return {
        schemaVersion: 1 as const,
        providersEnabled: {},
        defaultBounds: { timeoutMs: 60_000, turnLimit: 5, resultLimitBytes: 4_096 },
      }
    },
    async listRules() { return [] },
    async getInjectedRulesForWorker() { return '' },
  } as unknown as WorkerRulesService
  const coordinator = new WorkerCoordinator({
    storePath: join(root, 'workers.json'),
    archivePath: join(root, 'workers-archive.json'),
    adapters: [adapter],
    rulesService: rules,
    bounds: { timeoutMs: 60_000, turnLimit: 5, resultLimitBytes: 4_096 },
    primaryDefaults: async () => ({}),
  })

  try {
    await coordinator.initialize()
    const [first, second] = await Promise.all([
      coordinator.start({ providerId: 'fake', mode: 'research', prompt: 'first' }),
      coordinator.start({ providerId: 'fake', mode: 'research', prompt: 'second' }),
    ])

    await waitFor(() => started.length === 1)
    assert.equal(started[0], first.id)
    assert.equal(coordinator.get(second.id)?.status, 'queued')

    releases.get(first.id)?.resolve({ result: 'first done', resultTruncated: false, changedFiles: [] })
    await waitFor(() => started.length === 2)
    assert.deepEqual(started, [first.id, second.id])

    releases.get(second.id)?.resolve({ result: 'second done', resultTruncated: false, changedFiles: [] })
    await waitFor(() => coordinator.get(second.id)?.status === 'completed')
    assert.equal(coordinator.get(first.id)?.status, 'completed')
    assert.equal(coordinator.get(second.id)?.status, 'completed')
  } finally {
    await coordinator.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})

test('WorkerCoordinator cancels a queued task without spawning it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'worker-queued-cancel-'))
  const release = deferred<WorkerRunOutput>()
  const started: string[] = []
  const adapter: WorkerAdapter = {
    provider: {
      id: 'fake', name: 'Fake worker', description: 'Test worker', kind: 'external', status: 'ready', statusLabel: 'Ready', modes: ['research'], enabled: true,
    },
    async run(input) { started.push(input.taskId); return release.promise },
    async cancel() { release.resolve({ result: 'cancelled', resultTruncated: false, changedFiles: [] }) },
  }
  const rules = {
    async initialize() {},
    async loadConfig() { return { schemaVersion: 1 as const, providersEnabled: {}, defaultBounds: { timeoutMs: 60_000, turnLimit: 5, resultLimitBytes: 4_096 } } },
    async listRules() { return [] },
    async getInjectedRulesForWorker() { return '' },
  } as unknown as WorkerRulesService
  const coordinator = new WorkerCoordinator({
    storePath: join(root, 'workers.json'), archivePath: join(root, 'workers-archive.json'), adapters: [adapter], rulesService: rules,
    bounds: { timeoutMs: 60_000, turnLimit: 5, resultLimitBytes: 4_096 }, primaryDefaults: async () => ({}),
  })

  try {
    await coordinator.initialize()
    const first = await coordinator.start({ providerId: 'fake', mode: 'research', prompt: 'first' })
    const second = await coordinator.start({ providerId: 'fake', mode: 'research', prompt: 'second' })
    await waitFor(() => started.includes(first.id))
    await coordinator.cancel(second.id)
    assert.equal(coordinator.get(second.id)?.status, 'cancelled')
    assert.deepEqual(started, [first.id])
  } finally {
    await coordinator.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})
