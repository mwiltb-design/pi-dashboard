import type { WorkerBounds } from './worker-types.js'

export interface WorkerSupervisorConfig {
  schemaVersion: 1
  dataDir: string
  workspace: string
  storePath: string
  archivePath: string
  rulesRoot?: string
  sessionDir?: string
  pluginToolsExtension: string
  pluginStateRoot?: string
  pluginCodeRoot?: string
  authoringSkillPath?: string
  referenceSkillPath?: string
  enabled: boolean
  bounds: WorkerBounds
}

export interface SupervisorRequest {
  id: string
  token: string
  method: string
  params?: Record<string, unknown>
}

export interface SupervisorResponse {
  id: string
  result?: unknown
  error?: { message: string; status: number }
}
