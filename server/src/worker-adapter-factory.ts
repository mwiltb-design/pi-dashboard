import { AntigravityWorkerAdapter } from './antigravity-worker.js'
import { ClaudeWorkerAdapter } from './claude-worker.js'
import { CodexWorkerAdapter } from './codex-worker.js'
import { GitService } from './git-service.js'
import { SubPiWorkerAdapter } from './sub-pi-worker.js'
import type { WorkerAdapter } from './worker-types.js'
import type { WorkerSupervisorConfig } from './worker-supervisor-types.js'

export function createWorkerAdapters(config: WorkerSupervisorConfig): WorkerAdapter[] {
  const git = new GitService(config.workspace)
  return [
    new SubPiWorkerAdapter({
      workspace: config.workspace,
      sessionDir: config.sessionDir,
      pluginToolsExtension: config.pluginToolsExtension,
      pluginStateRoot: config.pluginStateRoot,
      pluginCodeRoot: config.pluginCodeRoot,
      authoringSkillPath: config.authoringSkillPath,
      referenceSkillPath: config.referenceSkillPath,
      git,
      enabled: config.enabled,
    }),
    new AntigravityWorkerAdapter({ workspace: config.workspace, git, enabled: config.enabled }),
    new CodexWorkerAdapter({ workspace: config.workspace, git, enabled: config.enabled }),
    new ClaudeWorkerAdapter({ workspace: config.workspace, git, enabled: config.enabled }),
  ]
}
