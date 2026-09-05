import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

test('WorkerCoordinator reuses a native provider session for continuation and keeps run history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'worker-continuation-'))
  const inputs: WorkerRunInput[] = []
  const adapter: WorkerAdapter = {
    provider: {
      id: 'fake', name: 'Fake worker', description: 'Test worker', kind: 'external', status: 'ready', statusLabel: 'Ready', modes: ['research'], enabled: true,
      capabilities: { nativeSessions: true, continuation: true, structuredEvents: true, cancellation: true, modelSelection: true },
    },
    async run(input, hooks) {
      inputs.push(input)
      if (inputs.length === 1) await hooks.onSession('session-123')
      return { result: `run ${inputs.length}`, resultTruncated: false, changedFiles: [] }
    },
    async cancel() {},
  }
  const rules = {
    async initialize() {},
    async loadConfig() { return { schemaVersion: 1 as const, providersEnabled: {}, defaultBounds: { timeoutMs: 60_000, turnLimit: 5, resultLimitBytes: 4_096 } } },
    async listRules() { return [] },
    async getInjectedRulesForWorker() { return '' },
  } as unknown as WorkerRulesService
  const coordinator = new WorkerCoordinator({
    storePath: join(root, 'workers.json'), archivePath: join(root, 'archive.json'), adapters: [adapter], rulesService: rules,
    bounds: { timeoutMs: 60_000, turnLimit: 5, resultLimitBytes: 4_096 }, primaryDefaults: async () => ({}),
  })
  try {
    await coordinator.initialize()
    const task = await coordinator.start({ providerId: 'fake', mode: 'research', prompt: 'original' })
    await waitFor(() => coordinator.get(task.id)?.status === 'completed')
    await coordinator.continueTask(task.id, 'follow up')
    await waitFor(() => coordinator.get(task.id)?.status === 'completed' && inputs.length === 2)
    assert.equal(inputs[1]?.continuation?.kind, 'native')
    assert.equal(inputs[1]?.continuation?.sessionId, 'session-123')
    assert.equal(coordinator.get(task.id)?.runs?.length, 2)
    assert.equal(coordinator.get(task.id)?.runs?.[1]?.continuationKind, 'native')
    await assert.rejects(() => coordinator.continueTask(task.id, 'write files', 'implement'), /keeps the original permission mode/)
    await coordinator.continueTask(task.id, 'use the briefing', undefined, true)
    await waitFor(() => coordinator.get(task.id)?.status === 'completed' && inputs.length === 3)
    assert.equal(inputs[2]?.continuation?.kind, 'handoff')
    assert.equal(inputs[2]?.continuation?.handoff?.objective, 'original')
  } finally {
    await coordinator.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})

test('WorkerCoordinator deduplicates retried submissions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'worker-deduplicate-'))
  let executions = 0
  const adapter: WorkerAdapter = {
    provider: { id: 'fake', name: 'Fake', description: 'Test', kind: 'external', status: 'ready', statusLabel: 'Ready', modes: ['research'], enabled: true },
    async run() { executions += 1; return { result: 'done', resultTruncated: false, changedFiles: [] } },
    async cancel() {},
  }
  const rules = {
    async initialize() {},
    async loadConfig() { return { schemaVersion: 1 as const, providersEnabled: {}, defaultBounds: { timeoutMs: 60_000, turnLimit: 5, resultLimitBytes: 4_096 } } },
    async listRules() { return [] }, async getInjectedRulesForWorker() { return '' },
  } as unknown as WorkerRulesService
  const coordinator = new WorkerCoordinator({ storePath: join(root, 'tasks.json'), archivePath: join(root, 'archive.json'), adapters: [adapter], rulesService: rules, bounds: { timeoutMs: 60_000, turnLimit: 5, resultLimitBytes: 4_096 }, primaryDefaults: async () => ({}) })
  try {
    await coordinator.initialize()
    const first = await coordinator.start({ providerId: 'fake', mode: 'research', prompt: 'once', submissionId: 'submission-1' })
    const retry = await coordinator.start({ providerId: 'fake', mode: 'research', prompt: 'once', submissionId: 'submission-1' })
    assert.equal(retry.id, first.id)
    await waitFor(() => coordinator.get(first.id)?.status === 'completed')
    assert.equal(executions, 1)
  } finally {
    await coordinator.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})

test('WorkerCoordinator migrates legacy records without overwriting the legacy files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'worker-legacy-migration-'))
  const storePath = join(root, 'worker-tasks.json')
  const archivePath = join(root, 'worker-tasks-archive.json')
  const now = new Date().toISOString()
  const legacy = `${JSON.stringify({ schemaVersion: 1, tasks: [{
    id: 'legacy-task', providerId: 'fake', providerName: 'Fake', mode: 'research', prompt: 'legacy', status: 'completed', progress: 'done', turns: 1,
    bounds: { timeoutMs: 60_000, turnLimit: 5, resultLimitBytes: 4_096 }, createdAt: now, updatedAt: now, finishedAt: now, changedFiles: [],
  }] }, null, 2)}\n`
  await writeFile(storePath, legacy)
  await writeFile(archivePath, `${JSON.stringify({ schemaVersion: 1, tasks: [] }, null, 2)}\n`)
  const adapter: WorkerAdapter = {
    provider: { id: 'fake', name: 'Fake', description: 'Test', kind: 'external', status: 'ready', statusLabel: 'Ready', modes: ['research'], enabled: true },
    async run() { return { result: 'done', resultTruncated: false, changedFiles: [] } }, async cancel() {},
  }
  const rules = {
    async initialize() {}, async loadConfig() { return { schemaVersion: 1 as const, providersEnabled: {}, defaultBounds: { timeoutMs: 60_000, turnLimit: 5, resultLimitBytes: 4_096 } } },
    async listRules() { return [] }, async getInjectedRulesForWorker() { return '' },
  } as unknown as WorkerRulesService
  const coordinator = new WorkerCoordinator({ storePath, archivePath, adapters: [adapter], rulesService: rules, bounds: { timeoutMs: 60_000, turnLimit: 5, resultLimitBytes: 4_096 }, primaryDefaults: async () => ({}) })
  try {
    await coordinator.initialize()
    assert.equal(coordinator.get('legacy-task')?.runs?.length, 1)
    assert.equal(await readFile(storePath, 'utf8'), legacy)
    const index = JSON.parse(await readFile(join(root, 'worker-task-records', 'index.json'), 'utf8')) as { activeIds: string[] }
    assert.deepEqual(index.activeIds, ['legacy-task'])
  } finally {
    await coordinator.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})

test('WorkerCoordinator marks an active recovered run interrupted and only replays queued work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'worker-recovery-'))
  const records = join(root, 'worker-task-records')
  await mkdir(records)
  const now = new Date().toISOString()
  const task = (id: string, status: 'running' | 'queued') => ({
    id, providerId: 'fake', providerName: 'Fake', mode: 'research' as const, prompt: id, status,
    progress: status, turns: 0, bounds: { timeoutMs: 60_000, turnLimit: 5, resultLimitBytes: 4_096 },
    createdAt: now, updatedAt: now, changedFiles: [], archived: false, currentRunId: `${id}-run`,
    runs: [{ id: `${id}-run`, prompt: id, mode: 'research' as const, status, createdAt: now, updatedAt: now, changedFiles: [] }],
  })
  await Promise.all([
    writeFile(join(records, 'running.json'), JSON.stringify(task('running', 'running'))),
    writeFile(join(records, 'queued.json'), JSON.stringify(task('queued', 'queued'))),
    writeFile(join(records, 'index.json'), JSON.stringify({ schemaVersion: 2, activeIds: ['running', 'queued'], archivedIds: [] })),
  ])
  const executions: string[] = []
  const adapter: WorkerAdapter = {
    provider: { id: 'fake', name: 'Fake', description: 'Test', kind: 'external', status: 'ready', statusLabel: 'Ready', modes: ['research'], enabled: true },
    async run(input) { executions.push(input.taskId); return { result: 'done', resultTruncated: false, changedFiles: [] } }, async cancel() {},
  }
  const rules = {
    async initialize() {}, async loadConfig() { return { schemaVersion: 1 as const, providersEnabled: {}, defaultBounds: { timeoutMs: 60_000, turnLimit: 5, resultLimitBytes: 4_096 } } },
    async listRules() { return [] }, async getInjectedRulesForWorker() { return '' },
  } as unknown as WorkerRulesService
  const coordinator = new WorkerCoordinator({ storePath: join(root, 'worker-tasks.json'), archivePath: join(root, 'archive.json'), adapters: [adapter], rulesService: rules, bounds: { timeoutMs: 60_000, turnLimit: 5, resultLimitBytes: 4_096 }, primaryDefaults: async () => ({}) })
  try {
    await coordinator.initialize()
    await waitFor(() => coordinator.get('queued')?.status === 'completed')
    assert.equal(coordinator.get('running')?.status, 'interrupted')
    assert.deepEqual(executions, ['queued'])
  } finally {
    await coordinator.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})
