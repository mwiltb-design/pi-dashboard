export const WORKER_MODES = ['research', 'review', 'implement'] as const
export type WorkerMode = typeof WORKER_MODES[number]

export const WORKER_STATUSES = ['queued', 'starting', 'running', 'cancelling', 'completed', 'failed', 'cancelled', 'timed-out', 'interrupted'] as const
export type WorkerStatus = typeof WORKER_STATUSES[number]

export interface WorkerBounds {
  timeoutMs: number
  turnLimit: number
  resultLimitBytes: number
}

export interface WorkerChangedFile {
  path: string
  state: string
}

export interface WorkerProcessIdentity {
  pid: number
  creationTime?: string
}

export interface WorkerProviderCapabilities {
  nativeSessions: boolean
  continuation: boolean
  structuredEvents: boolean
  cancellation: boolean
  modelSelection: boolean
}

export interface WorkerValidationOutcome {
  command: string
  exitCode: number
  summary: string
}

export interface HandoffContext {
  schemaVersion: number
  taskId: string
  previousRunId: string
  provider: string
  workspacePath: string
  objective: string
  summaryOfWork: string
  lastVerifiedResult?: string
  touchedFiles: Array<{ path: string; status: 'created' | 'modified' | 'deleted' }>
  validationOutcomes: WorkerValidationOutcome[]
  unfinishedWork: string[]
  knownLimitationsOrErrors: string[]
  recommendedNextStep?: string
}

export interface WorkerRunRecord {
  id: string
  prompt: string
  mode: WorkerMode
  status: WorkerStatus
  progress?: string
  turns?: number
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  sessionId?: string
  result?: string
  resultTruncated?: boolean
  error?: string
  changedFiles: WorkerChangedFile[]
  workerProcess?: WorkerProcessIdentity
  continuationKind?: 'native' | 'handoff'
  lastActivityAt?: string
  elapsedMs?: number
  cleanupOutcome?: string
}

export interface WorkerFileDiff {
  path: string
  state: string
  diff: string
  truncated: boolean
  warning?: string
}

export interface WorkerChangeSet {
  runId: string
  files: WorkerFileDiff[]
  incomplete: boolean
  warning?: string
}

export interface WorkerResultEnvelope {
  summary: string
  actionsTaken: string[]
  changedFiles: WorkerChangedFile[]
  warnings: string[]
  artifactLinks?: string[]
  sessionId?: string
}

export interface WorkerTask {
  id: string
  providerId: string
  providerName: string
  mode: WorkerMode
  prompt: string
  status: WorkerStatus
  progress: string
  turns: number
  bounds: WorkerBounds
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  sessionId?: string
  result?: string
  resultTruncated?: boolean
  error?: string
  model?: { provider: string; id: string }
  thinkingLevel?: string
  changedFiles: WorkerChangedFile[]
  resultEnvelope?: WorkerResultEnvelope
  archived?: boolean
  workspacePath?: string
  currentRunId?: string
  runs?: WorkerRunRecord[]
  queuePosition?: number
  workerProcess?: WorkerProcessIdentity
  providerCapabilities?: WorkerProviderCapabilities
  handoffContext?: HandoffContext
  changeSets?: Record<string, WorkerChangeSet>
  submissionId?: string
  lastActivityAt?: string
  elapsedMs?: number
  cleanupOutcome?: string
}

export interface WorkerProviderStatus {
  id: string
  name: string
  description: string
  kind: 'built-in' | 'external'
  status: 'ready' | 'disabled' | 'unavailable' | 'planned'
  statusLabel: string
  modes: WorkerMode[]
  enabled: boolean
  loginCommand?: string
  manageCommand?: string
  capabilities?: WorkerProviderCapabilities
}

export type DashboardStackPreset = 'basic' | 'developer' | 'business' | 'custom'

export interface WorkerConfiguration {
  schemaVersion: 1
  stackPreset?: DashboardStackPreset
  enabledFeatures?: string[]
  providersEnabled: Record<string, boolean>
  showRulesEditor?: boolean
  defaultBounds: WorkerBounds
  subPi?: {
    model?: { provider: string; id: string }
    thinkingLevel?: string
  }
}

export interface WorkerRuleFile {
  id: string
  title: string
  fileName: string
  level: 1 | 2
  providerId?: string
  content: string
  updatedAt: string
}

export interface WorkerRunInput {
  taskId: string
  runId?: string
  providerId: string
  mode: WorkerMode
  prompt: string
  bounds: WorkerBounds
  model?: { provider: string; id: string }
  thinkingLevel?: string
  ruleContext?: string
  continuation?: {
    kind: 'native' | 'handoff'
    sessionId?: string
    handoff?: HandoffContext
  }
}

export interface WorkerRunHooks {
  onSession(sessionId: string): Promise<void> | void
  onProgress(progress: string, turns: number): Promise<void> | void
  onProcess?(identity: WorkerProcessIdentity): Promise<void> | void
}

export interface WorkerRunOutput {
  result: string
  resultTruncated: boolean
  changedFiles: WorkerChangedFile[]
  resultEnvelope?: WorkerResultEnvelope
  exitCode?: number | null
  signal?: NodeJS.Signals | null
}

export interface WorkerAdapter {
  readonly provider: WorkerProviderStatus
  run(input: WorkerRunInput, hooks: WorkerRunHooks): Promise<WorkerRunOutput>
  cancel(taskId: string): Promise<void>
}
