import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { atomicWriteFile } from './durable-file.js'
import { terminateProcessIdentity } from './process-control.js'
import { WorkerChangeTracker } from './worker-change-tracker.js'
import { WorkerRunError } from './worker-run-error.js'
import { WORKER_MODES, type HandoffContext, type WorkerAdapter, type WorkerBounds, type WorkerConfiguration, type WorkerMode, type WorkerProviderStatus, type WorkerRuleFile, type WorkerRunRecord, type WorkerTask } from './worker-types.js'
import type { WorkerRulesService } from './worker-rules.js'

const ACTIVE_TASK_LIMIT = 15
const MAX_ARCHIVE_TASKS = 500
const MAX_PROMPT_LENGTH = 12_000

interface WorkerStore {
  schemaVersion: 1
  tasks: WorkerTask[]
}

interface WorkerIndex {
  schemaVersion: 2
  activeIds: string[]
  archivedIds: string[]
}

interface ActiveRun {
  taskId: string
  runId: string
  adapter: WorkerAdapter
  cancelRequested: boolean
  timedOut: boolean
  timer?: NodeJS.Timeout
  progressTimer?: NodeJS.Timeout
  pendingProgress?: { progress: string; turns: number; lastActivityAt: string }
  lastProgressWriteAt?: number
  completion: Promise<void>
  resolveCompletion: () => void
}

const TERMINAL_STATUSES = new Set<WorkerTask['status']>(['completed', 'failed', 'cancelled', 'timed-out', 'interrupted'])

export class WorkerError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

export interface WorkerCoordinatorOptions {
  storePath: string
  archivePath: string
  adapters: WorkerAdapter[]
  rulesService: WorkerRulesService
  bounds: WorkerBounds
  primaryDefaults: () => Promise<{ model?: { provider: string; id: string }; thinkingLevel?: string }>
  workspace?: string
}

export class WorkerCoordinator extends EventEmitter {
  private tasks: WorkerTask[] = []
  private archivedTasks: WorkerTask[] = []
  private activeTaskId?: string
  private activeAdapter?: WorkerAdapter
  private activeRun?: ActiveRun
  private admissionChain = Promise.resolve()
  private saveChain = Promise.resolve()
  private shuttingDown = false
  private readonly changeTracker?: WorkerChangeTracker

  constructor(private readonly options: WorkerCoordinatorOptions) {
    super()
    if (options.workspace) this.changeTracker = new WorkerChangeTracker(options.workspace, options.storePath)
  }

  async initialize(): Promise<void> {
    await this.options.rulesService.initialize()

    const recordsDir = join(dirname(this.options.storePath), 'worker-task-records')
    const indexPath = join(recordsDir, 'index.json')
    let loadedPerTaskRecords = false
    try {
      const index = JSON.parse(await readFile(indexPath, 'utf8')) as WorkerIndex
      if (index.schemaVersion === 2) {
        this.tasks = []
        this.archivedTasks = []
        for (const id of index.activeIds) {
          const stored = JSON.parse(await readFile(join(recordsDir, `${id}.json`), 'utf8')) as WorkerTask
          this.tasks.push(await this.reconcileStoredTask(stored))
        }
        for (const id of index.archivedIds) {
          const stored = JSON.parse(await readFile(join(recordsDir, `${id}.json`), 'utf8')) as WorkerTask
          this.archivedTasks.push({ ...this.normalizeTask(stored), archived: true })
        }
        loadedPerTaskRecords = true
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new WorkerError('Worker task index could not be read safely; existing records were left untouched.', 500)
    }

    if (!loadedPerTaskRecords) {
      // 1. Load active tasks from the legacy combined store. The next save
      // migrates them to independent records without deleting the old file.
      try {
        const parsed = JSON.parse(await readFile(this.options.storePath, 'utf8')) as WorkerStore
        if (parsed?.schemaVersion === 1 && Array.isArray(parsed.tasks)) {
          this.tasks = []
          for (const stored of parsed.tasks) this.tasks.push(await this.reconcileStoredTask(stored))
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.tasks = []
        }
      }

      // 2. Load archived tasks from the legacy combined archive.
      try {
        const parsedArchive = JSON.parse(await readFile(this.options.archivePath, 'utf8')) as WorkerStore
        if (parsedArchive?.schemaVersion === 1 && Array.isArray(parsedArchive.tasks)) {
          this.archivedTasks = parsedArchive.tasks.map((task) => ({ ...this.normalizeTask(task), archived: true }))
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.archivedTasks = []
        }
      }
    }

    // 3. Enforce 15 task retention rule
    this.enforceRetentionLimit()
    await this.save()
    this.schedule()
  }

  private normalizeTask(task: WorkerTask): WorkerTask {
    if (task.runs?.length && task.currentRunId) return {
      ...task,
      workspacePath: task.workspacePath ?? this.options.workspace,
      providerCapabilities: task.providerCapabilities ?? this.getAdapter(task.providerId)?.provider.capabilities,
    }
    const runId = task.currentRunId ?? randomUUID()
    const run: WorkerRunRecord = {
      id: runId,
      prompt: task.prompt,
      mode: task.mode,
      status: task.status,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      changedFiles: [...(task.changedFiles ?? [])],
      ...(task.startedAt ? { startedAt: task.startedAt } : {}),
      ...(task.finishedAt ? { finishedAt: task.finishedAt } : {}),
      ...(task.sessionId ? { sessionId: task.sessionId } : {}),
      ...(task.result ? { result: task.result } : {}),
      ...(task.resultTruncated !== undefined ? { resultTruncated: task.resultTruncated } : {}),
      ...(task.error ? { error: task.error } : {}),
      ...(task.workerProcess ? { workerProcess: task.workerProcess } : {}),
    }
    return {
      ...task,
      currentRunId: runId,
      runs: [run],
      workspacePath: task.workspacePath ?? this.options.workspace,
      providerCapabilities: task.providerCapabilities ?? this.getAdapter(task.providerId)?.provider.capabilities,
    }
  }

  private async reconcileStoredTask(stored: WorkerTask): Promise<WorkerTask> {
    const task = this.normalizeTask(stored)
    if (!['starting', 'running', 'cancelling'].includes(task.status)) return task
    if (task.workerProcess) await terminateProcessIdentity(task.workerProcess).catch(() => undefined)
    const now = new Date().toISOString()
    const patch: Partial<WorkerTask> = {
      status: 'interrupted',
      progress: 'Interrupted when the previous worker supervisor stopped. It was not restarted automatically.',
      error: 'Worker supervisor stopped before this run reached a final state.',
      updatedAt: now,
      finishedAt: now,
    }
    Object.assign(task, patch)
    this.patchCurrentRun(task, patch)
    return task
  }

  getAdapter(providerId: string): WorkerAdapter | undefined {
    return this.options.adapters.find((candidate) => candidate.provider.id === providerId)
  }

  get archivedCount(): number {
    return this.archivedTasks.length
  }

  get archivePath(): string {
    return join(dirname(this.options.storePath), 'worker-task-records')
  }

  async snapshot(): Promise<{
    providers: WorkerProviderStatus[]
    activeTaskId?: string
    tasks: WorkerTask[]
    archivedCount: number
    archivePath: string
    configuration: WorkerConfiguration
    rules: WorkerRuleFile[]
  }> {
    const config = await this.options.rulesService.loadConfig()
    const rules = await this.options.rulesService.listRules()

    const providers: WorkerProviderStatus[] = this.options.adapters.map((adapter) => {
      const p = adapter.provider
      const isEnabled = config.providersEnabled[p.id] !== false
      return {
        ...p,
        enabled: isEnabled,
        status: isEnabled ? p.status : 'disabled',
        statusLabel: isEnabled ? p.statusLabel : 'Disabled in configuration',
      }
    })
    const queued = [...this.tasks].reverse().filter((task) => task.status === 'queued')
    const queuePositions = new Map(queued.map((task, index) => [task.id, index + 1]))

    return {
      providers,
      ...(this.activeTaskId ? { activeTaskId: this.activeTaskId } : {}),
      tasks: this.tasks.map((task) => this.cloneTask(task, queuePositions.get(task.id))),
      archivedCount: this.archivedTasks.length,
      archivePath: this.archivePath,
      configuration: config,
      rules,
    }
  }

  get(id: string): WorkerTask | undefined {
    const task = this.tasks.find((candidate) => candidate.id === id) ?? this.archivedTasks.find((candidate) => candidate.id === id)
    return task ? this.cloneTask(task) : undefined
  }

  getArchivedTasks(): WorkerTask[] {
    return this.archivedTasks.map((task) => ({ ...this.cloneTask(task), archived: true }))
  }

  private cloneTask(task: WorkerTask, queuePosition?: number): WorkerTask {
    const { changeSets: _changeSets, ...safe } = task
    return {
      ...safe,
      changedFiles: [...task.changedFiles],
      runs: task.runs?.map((run) => ({ ...run, changedFiles: [...run.changedFiles] })),
      ...(queuePosition ? { queuePosition } : {}),
    }
  }

  async archiveTask(id: string): Promise<boolean> {
    const index = this.tasks.findIndex((t) => t.id === id)
    if (index === -1) return false
    if (this.activeTaskId === id) throw new WorkerError('Cannot archive an active running task', 409)

    const [task] = this.tasks.splice(index, 1)
    if (task) {
      task.archived = true
      // Prepend to archive, avoiding duplicate IDs
      this.archivedTasks = [task, ...this.archivedTasks.filter((t) => t.id !== task.id)].slice(0, MAX_ARCHIVE_TASKS)
      await this.save()
      this.emit('changed')
      return true
    }
    return false
  }

  async archiveAllCompleted(): Promise<number> {
    const toKeep: WorkerTask[] = []
    const toArchive: WorkerTask[] = []

    for (const task of this.tasks) {
      if (task.id === this.activeTaskId || ['queued', 'starting', 'running', 'cancelling'].includes(task.status)) {
        toKeep.push(task)
      } else {
        toArchive.push({ ...task, archived: true })
      }
    }

    if (toArchive.length === 0) return 0

    this.tasks = toKeep
    const existingIds = new Set(this.archivedTasks.map((t) => t.id))
    for (const t of toArchive) {
      if (!existingIds.has(t.id)) {
        this.archivedTasks.unshift(t)
        existingIds.add(t.id)
      }
    }
    this.archivedTasks = this.archivedTasks.slice(0, MAX_ARCHIVE_TASKS)

    await this.save()
    this.emit('changed')
    return toArchive.length
  }

  async restoreTask(id: string): Promise<boolean> {
    const index = this.archivedTasks.findIndex((t) => t.id === id)
    if (index === -1) return false

    const [task] = this.archivedTasks.splice(index, 1)
    if (task) {
      task.archived = false
      this.tasks.unshift(task)
      this.enforceRetentionLimit()
      await this.save()
      this.emit('changed', task)
      return true
    }
    return false
  }

  private enforceRetentionLimit(): boolean {
    if (this.tasks.length <= ACTIVE_TASK_LIMIT) return false

    const keep: WorkerTask[] = []
    const toArchive: WorkerTask[] = []

    for (const task of this.tasks) {
      if (keep.length < ACTIVE_TASK_LIMIT || task.id === this.activeTaskId || ['queued', 'starting', 'running', 'cancelling'].includes(task.status)) {
        keep.push(task)
      } else {
        toArchive.push({ ...task, archived: true })
      }
    }

    if (toArchive.length > 0) {
      this.tasks = keep
      const existingIds = new Set(this.archivedTasks.map((t) => t.id))
      for (const t of toArchive) {
        if (!existingIds.has(t.id)) {
          this.archivedTasks.unshift(t)
          existingIds.add(t.id)
        }
      }
      this.archivedTasks = this.archivedTasks.slice(0, MAX_ARCHIVE_TASKS)
      return true
    }
    return false
  }

  async start(input: {
    providerId?: string
    mode?: string
    prompt?: string
    bounds?: Partial<WorkerBounds>
    model?: { provider: string; id: string }
    thinkingLevel?: string
    submissionId?: string
  }): Promise<WorkerTask> {
    return this.serializeAdmission(async () => {
      if (this.shuttingDown) throw new WorkerError('The worker coordinator is shutting down', 503)
      if (input.submissionId) {
        const existing = this.tasks.find((task) => task.submissionId === input.submissionId) ?? this.archivedTasks.find((task) => task.submissionId === input.submissionId)
        if (existing) return this.cloneTask(existing)
      }

      const providerId = input.providerId || 'sub-pi'
      const adapter = this.getAdapter(providerId)
      if (!adapter) throw new WorkerError(`Worker provider '${providerId}' is not available`, 404)

      const config = await this.options.rulesService.loadConfig()
      if (config.providersEnabled[providerId] === false) {
        throw new WorkerError(`Worker provider '${adapter.provider.name}' is currently disabled`, 403)
      }

      if (adapter.provider.status !== 'ready') {
        throw new WorkerError(adapter.provider.statusLabel || `Worker '${adapter.provider.name}' is not ready`, 409)
      }

      if (!WORKER_MODES.includes(input.mode as WorkerMode)) throw new WorkerError('Choose Research, Review, or Implement mode')
      const mode = input.mode as WorkerMode
      if (!adapter.provider.modes.includes(mode)) {
        throw new WorkerError(`${adapter.provider.name} does not support ${mode} mode`, 400)
      }

      const prompt = input.prompt?.trim() ?? ''
      if (!prompt) throw new WorkerError('Describe a bounded task for the worker')
      if (prompt.length > MAX_PROMPT_LENGTH) throw new WorkerError(`Worker prompts are limited to ${MAX_PROMPT_LENGTH.toLocaleString()} characters`, 413)

      const computedBounds: WorkerBounds = {
        turnLimit: Math.min(30, Math.max(1, input.bounds?.turnLimit ?? config.defaultBounds.turnLimit ?? this.options.bounds.turnLimit)),
        timeoutMs: Math.min(30 * 60_000, Math.max(60_000, input.bounds?.timeoutMs ?? config.defaultBounds.timeoutMs ?? this.options.bounds.timeoutMs)),
        resultLimitBytes: Math.min(64 * 1024, Math.max(1024, input.bounds?.resultLimitBytes ?? config.defaultBounds.resultLimitBytes ?? this.options.bounds.resultLimitBytes)),
      }

      const now = new Date().toISOString()
      const runId = randomUUID()
      const run: WorkerRunRecord = {
        id: runId,
        prompt,
        mode,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
        changedFiles: [],
      }
      const task: WorkerTask = {
        id: randomUUID(),
        providerId: adapter.provider.id,
        providerName: adapter.provider.name,
        mode,
        prompt,
        status: 'queued',
        progress: `Waiting for ${adapter.provider.name} to start.`,
        turns: 0,
        bounds: computedBounds,
        createdAt: now,
        updatedAt: now,
        changedFiles: [],
        archived: false,
        workspacePath: this.options.workspace,
        currentRunId: runId,
        runs: [run],
        providerCapabilities: adapter.provider.capabilities,
        ...(input.submissionId ? { submissionId: input.submissionId } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
      }

      this.tasks.unshift(task)
      this.enforceRetentionLimit()
      await this.save()
      this.emit('changed', task)
      this.schedule()
      return this.cloneTask(task)
    })
  }

  async continueTask(id: string, promptInput: string, requestedMode?: string, forceHandoff = false): Promise<WorkerTask> {
    return this.serializeAdmission(async () => {
      if (this.shuttingDown) throw new WorkerError('The worker coordinator is shutting down', 503)
      const task = this.tasks.find((candidate) => candidate.id === id)
      if (!task) throw new WorkerError('Worker task not found', 404)
      if (!TERMINAL_STATUSES.has(task.status)) throw new WorkerError('Wait for the current run to finish before continuing it', 409)
      const prompt = promptInput.trim()
      if (!prompt) throw new WorkerError('Enter a follow-up instruction')
      if (prompt.length > MAX_PROMPT_LENGTH) throw new WorkerError(`Follow-up prompts are limited to ${MAX_PROMPT_LENGTH.toLocaleString()} characters`, 413)
      if (requestedMode && requestedMode !== task.mode) {
        throw new WorkerError('A continuation keeps the original permission mode. Start a new task to change permissions.', 409)
      }
      const adapter = this.getAdapter(task.providerId)
      if (!adapter) throw new WorkerError(`Worker provider '${task.providerId}' is not available`, 404)
      const config = await this.options.rulesService.loadConfig()
      if (config.providersEnabled[task.providerId] === false) throw new WorkerError(`Worker provider '${task.providerName}' is currently disabled`, 403)
      if (adapter.provider.status !== 'ready') throw new WorkerError(adapter.provider.statusLabel || `Worker '${task.providerName}' is not ready`, 409)
      const previousRunId = task.currentRunId ?? task.runs?.at(-1)?.id ?? randomUUID()
      const native = !forceHandoff && Boolean(adapter.provider.capabilities?.continuation && task.sessionId)
      const handoff = native ? undefined : this.handoffFor(task, previousRunId)
      const now = new Date().toISOString()
      const runId = randomUUID()
      const run: WorkerRunRecord = {
        id: runId,
        prompt,
        mode: task.mode,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
        changedFiles: [],
        continuationKind: native ? 'native' : 'handoff',
      }
      task.runs = [...(task.runs ?? []), run]
      Object.assign(task, {
        currentRunId: runId,
        status: 'queued',
        progress: native ? `Waiting to continue the saved ${task.providerName} session.` : `Waiting to start a new ${task.providerName} session from a saved handoff.`,
        turns: 0,
        updatedAt: now,
        startedAt: undefined,
        finishedAt: undefined,
        result: undefined,
        resultTruncated: undefined,
        error: undefined,
        changedFiles: [],
        resultEnvelope: undefined,
        workerProcess: undefined,
        handoffContext: handoff,
      })
      await this.save()
      this.emit('changed', task)
      this.schedule()
      return this.cloneTask(task)
    })
  }

  changes(id: string, runId?: string): unknown {
    const task = this.tasks.find((candidate) => candidate.id === id) ?? this.archivedTasks.find((candidate) => candidate.id === id)
    if (!task) throw new WorkerError('Worker task not found', 404)
    const selectedRunId = runId ?? task.currentRunId
    if (!selectedRunId) return { runId: '', files: [], incomplete: true, warning: 'This legacy task has no recorded run identifier.' }
    return task.changeSets?.[selectedRunId] ?? { runId: selectedRunId, files: [], incomplete: true, warning: 'No per-run change baseline was available.' }
  }

  private handoffFor(task: WorkerTask, previousRunId: string): HandoffContext {
    return {
      schemaVersion: 1,
      taskId: task.id,
      previousRunId,
      provider: task.providerId,
      workspacePath: task.workspacePath ?? this.options.workspace ?? '',
      objective: task.prompt,
      summaryOfWork: task.resultEnvelope?.summary ?? task.result ?? task.progress,
      ...(task.result ? { lastVerifiedResult: task.result } : {}),
      touchedFiles: task.changedFiles.map((file) => ({
        path: file.path,
        status: file.state === 'deleted' ? 'deleted' as const : file.state === 'added' || file.state === 'untracked' ? 'created' as const : 'modified' as const,
      })),
      validationOutcomes: [],
      unfinishedWork: task.status === 'completed' ? [] : [task.error ?? 'The previous run did not complete successfully.'],
      knownLimitationsOrErrors: task.error ? [task.error] : [],
      recommendedNextStep: 'Follow the new instruction without repeating work already summarized above.',
    }
  }

  async cancel(id: string): Promise<WorkerTask> {
    const task = this.tasks.find((candidate) => candidate.id === id)
    if (!task) throw new WorkerError('Worker task not found', 404)
    if (!['queued', 'starting', 'running', 'cancelling'].includes(task.status)) throw new WorkerError('This worker task is not running', 409)
    const run = this.activeRun?.taskId === id ? this.activeRun : undefined
    if (!run) {
      await this.finish(task, 'cancelled', { progress: 'Cancelled by the user before it started.' })
      return { ...task, changedFiles: [...task.changedFiles] }
    }
    run.cancelRequested = true
    await this.update(task, { status: 'cancelling', progress: 'Stopping the worker and its child processes.' })
    let cleanupError: unknown
    try {
      await run.adapter.cancel(id)
    } catch (error) {
      cleanupError = error
    }
    await this.finish(task, cleanupError ? 'failed' : 'cancelled', {
      progress: cleanupError ? 'Cancellation requested, but worker cleanup could not be confirmed.' : 'Cancelled by the user.',
      ...(cleanupError ? { error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) } : {}),
    })
    if (!cleanupError) await run.completion
    return { ...task, changedFiles: [...task.changedFiles] }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    const run = this.activeRun
    if (!run) return
    run.cancelRequested = true
    const task = this.tasks.find((candidate) => candidate.id === run.taskId)
    let cleanupError: unknown
    try {
      await run.adapter.cancel(run.taskId)
    } catch (error) {
      cleanupError = error
    }
    if (task) {
      await this.finish(task, cleanupError ? 'failed' : 'cancelled', {
        progress: cleanupError ? 'Dashboard shutdown could not confirm worker cleanup.' : 'Stopped because the Dashboard shut down.',
        ...(cleanupError ? { error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) } : {}),
      })
    }
    await run.completion
  }

  private schedule(): void {
    if (this.shuttingDown || this.activeRun) return
    const task = [...this.tasks].reverse().find((candidate) => candidate.status === 'queued')
    if (!task) return
    const adapter = this.getAdapter(task.providerId)
    if (!adapter) {
      void this.finish(task, 'failed', { progress: 'Worker provider is no longer available.', error: `Worker provider '${task.providerId}' is not available` })
        .then(() => this.schedule())
        .catch((error) => console.error('Unable to record unavailable worker provider:', error))
      return
    }
    const runId = task.currentRunId ?? task.runs?.at(-1)?.id
    if (!runId) {
      void this.finish(task, 'failed', { progress: 'Worker run metadata is missing.', error: 'Cannot execute a task without a run identifier.' })
        .then(() => this.schedule())
        .catch((error) => console.error('Unable to record invalid worker run:', error))
      return
    }
    let resolveCompletion: () => void = () => {}
    const completion = new Promise<void>((resolve) => { resolveCompletion = resolve })
    const run: ActiveRun = { taskId: task.id, runId, adapter, cancelRequested: false, timedOut: false, completion, resolveCompletion }
    this.activeRun = run
    this.activeTaskId = task.id
    this.activeAdapter = adapter
    void this.execute(task, adapter, run).catch((error) => console.error('Worker lifecycle failed:', error))
  }

  private async execute(task: WorkerTask, adapter: WorkerAdapter, run: ActiveRun): Promise<void> {
    let changesCaptured = false
    try {
      const runRecord = task.runs?.find((candidate) => candidate.id === run.runId)
      if (!runRecord) throw new Error('Worker run metadata is missing')
      await this.update(task, {
        status: 'starting',
        progress: `${adapter.provider.name} is preparing the task.`,
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
      })
      run.timer = setTimeout(() => {
        if (this.activeRun !== run || TERMINAL_STATUSES.has(task.status)) return
        run.cancelRequested = true
        run.timedOut = true
        void adapter.cancel(task.id)
          .then(() => this.finish(task, 'timed-out', { progress: 'Stopped at the configured runtime limit.', error: 'Worker runtime limit reached.' }))
          .catch((error) => this.finish(task, 'timed-out', {
            progress: 'Runtime limit reached; worker cleanup reported an error.',
            error: `Worker runtime limit reached. Cleanup error: ${error instanceof Error ? error.message : String(error)}`,
          }))
          .catch((error) => console.error('Unable to record worker timeout:', error))
      }, task.bounds.timeoutMs)
      run.timer.unref()

      const defaults = await this.options.primaryDefaults()
      if (run.cancelRequested) return
      const ruleContext = await this.options.rulesService.getInjectedRulesForWorker(adapter.provider.id)
      if (run.cancelRequested) return
      await this.changeTracker?.captureBaseline(run.runId)
      if (run.cancelRequested) return

      await this.update(task, {
        status: 'running',
        progress: `${adapter.provider.name} started task in mode ${runRecord.mode}.`,
      })

      const output = await adapter.run({
        taskId: task.id,
        runId: run.runId,
        providerId: adapter.provider.id,
        mode: runRecord.mode,
        prompt: runRecord.prompt,
        bounds: task.bounds,
        ruleContext,
        ...(runRecord.continuationKind ? {
          continuation: runRecord.continuationKind === 'native'
            ? { kind: 'native' as const, sessionId: task.sessionId }
            : { kind: 'handoff' as const, handoff: task.handoffContext },
        } : {}),
        ...defaults,
        ...(task.model ? { model: task.model } : {}),
        ...(task.thinkingLevel ? { thinkingLevel: task.thinkingLevel } : {}),
      }, {
        onSession: (sessionId) => this.safeUpdate(task, { sessionId }),
        onProgress: (progress, turns) => this.queueProgress(run, task, progress, turns),
        onProcess: (identity) => this.safeUpdate(task, { workerProcess: identity }),
      })

      if (this.activeRun !== run || run.cancelRequested || TERMINAL_STATUSES.has(task.status)) return
      const changeSet = await this.changeTracker?.captureChanges(run.runId)
      changesCaptured = Boolean(changeSet)
      if (changeSet) task.changeSets = { ...(task.changeSets ?? {}), [run.runId]: changeSet }
      await this.flushProgress(run, task)
      await this.finish(task, 'completed', {
        progress: `${adapter.provider.name} completed successfully. Primary PI remains responsible for review.`,
        result: output.result,
        resultTruncated: output.resultTruncated,
        changedFiles: changeSet?.files.map((file) => ({ path: file.path, state: file.state })) ?? output.changedFiles,
        resultEnvelope: output.resultEnvelope,
      })
    } catch (error) {
      if (this.activeRun !== run || TERMINAL_STATUSES.has(task.status)) return
      const changeSet = await this.changeTracker?.captureChanges(run.runId).catch(() => undefined)
      changesCaptured = Boolean(changeSet)
      if (changeSet) task.changeSets = { ...(task.changeSets ?? {}), [run.runId]: changeSet }
      const message = error instanceof Error ? error.message : `${adapter.provider.name} failed`
      await this.finish(task, run.timedOut ? 'timed-out' : run.cancelRequested ? 'cancelled' : 'failed', {
        progress: run.timedOut ? 'Stopped at the configured runtime limit.' : run.cancelRequested ? 'Cancelled by the user.' : `${adapter.provider.name} could not complete the task.`,
        ...(error instanceof WorkerRunError && error.partialResult ? { result: error.partialResult, resultTruncated: error.resultTruncated } : {}),
        ...(run.cancelRequested ? {} : { error: message }),
      })
    } finally {
      if (!changesCaptured && this.changeTracker) {
        const changeSet = await this.changeTracker.captureChanges(run.runId).catch(() => undefined)
        if (changeSet) {
          task.changeSets = { ...(task.changeSets ?? {}), [run.runId]: changeSet }
          await this.save().catch(() => undefined)
        }
      }
      if (run.timer) clearTimeout(run.timer)
      if (run.progressTimer) clearTimeout(run.progressTimer)
      if (this.activeRun === run) {
        this.activeRun = undefined
        this.activeTaskId = undefined
        this.activeAdapter = undefined
      }
      run.resolveCompletion()
      this.schedule()
    }
  }

  private async safeUpdate(task: WorkerTask, patch: Partial<WorkerTask>): Promise<void> {
    try {
      await this.update(task, patch)
    } catch (error) {
      console.error(`Unable to persist worker progress for ${task.id}:`, error)
    }
  }

  private queueProgress(run: ActiveRun, task: WorkerTask, progress: string, turns: number): void {
    if (this.activeRun !== run || TERMINAL_STATUSES.has(task.status)) return
    run.pendingProgress = { progress: progress.slice(0, 2_000), turns, lastActivityAt: new Date().toISOString() }
    this.scheduleProgressFlush(run, task)
  }

  private scheduleProgressFlush(run: ActiveRun, task: WorkerTask): void {
    if (!run.pendingProgress || run.progressTimer) return
    const delay = Math.max(0, 250 - (Date.now() - (run.lastProgressWriteAt ?? 0)))
    run.progressTimer = setTimeout(() => {
      run.progressTimer = undefined
      void this.flushProgress(run, task)
    }, delay)
    run.progressTimer.unref()
  }

  private async flushProgress(run: ActiveRun, task: WorkerTask): Promise<void> {
    const pending = run.pendingProgress
    run.pendingProgress = undefined
    if (!pending || this.activeRun !== run || TERMINAL_STATUSES.has(task.status)) return
    run.lastProgressWriteAt = Date.now()
    await this.safeUpdate(task, pending)
    this.scheduleProgressFlush(run, task)
  }

  private async update(task: WorkerTask, patch: Partial<WorkerTask>): Promise<void> {
    if (!this.tasks.includes(task)) return
    Object.assign(task, patch, { updatedAt: new Date().toISOString() })
    this.patchCurrentRun(task, patch)
    await this.save()
    this.emit('changed', task)
  }

  private async finish(task: WorkerTask, status: WorkerTask['status'], patch: Partial<WorkerTask>): Promise<void> {
    if (TERMINAL_STATUSES.has(task.status)) return
    const finishedAt = new Date().toISOString()
    const elapsedMs = task.startedAt ? Math.max(0, Date.parse(finishedAt) - Date.parse(task.startedAt)) : undefined
    Object.assign(task, patch, {
      status,
      finishedAt,
      updatedAt: finishedAt,
      ...(elapsedMs !== undefined ? { elapsedMs } : {}),
      cleanupOutcome: status === 'cancelled' || status === 'timed-out' ? (patch.error ? 'cleanup reported an error' : 'owned process tree stopped') : 'process exited',
    })
    this.patchCurrentRun(task, { ...patch, status, finishedAt: task.finishedAt, updatedAt: task.updatedAt })
    this.enforceRetentionLimit()
    await this.save()
    this.emit('changed', task)
  }

  private patchCurrentRun(task: WorkerTask, patch: Partial<WorkerTask>): void {
    const run = task.runs?.find((candidate) => candidate.id === task.currentRunId)
    if (!run) return
    const allowed: Partial<WorkerRunRecord> = {}
    for (const key of ['status', 'progress', 'turns', 'startedAt', 'finishedAt', 'sessionId', 'result', 'resultTruncated', 'error', 'changedFiles', 'workerProcess', 'updatedAt', 'lastActivityAt', 'elapsedMs', 'cleanupOutcome'] as const) {
      if (key in patch) (allowed as Record<string, unknown>)[key] = patch[key]
    }
    Object.assign(run, allowed)
  }

  private serializeAdmission<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.admissionChain.then(operation, operation)
    this.admissionChain = result.then(() => undefined, () => undefined)
    return result
  }

  private async save(): Promise<void> {
    const operation = this.saveChain.then(() => this.saveDirect(), () => this.saveDirect())
    this.saveChain = operation.catch(() => undefined)
    return operation
  }

  private async saveDirect(): Promise<void> {
    const recordsDir = join(dirname(this.options.storePath), 'worker-task-records')
    const records = [...this.tasks, ...this.archivedTasks]
    await Promise.all(records.map((task) => atomicWriteFile(join(recordsDir, `${task.id}.json`), `${JSON.stringify(task, null, 2)}\n`)))
    const index: WorkerIndex = {
      schemaVersion: 2,
      activeIds: this.tasks.map((task) => task.id),
      archivedIds: this.archivedTasks.map((task) => task.id),
    }
    await atomicWriteFile(join(recordsDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
  }
}
