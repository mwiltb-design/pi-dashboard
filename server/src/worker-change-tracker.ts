import { readFile, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { atomicWriteFile } from './durable-file.js'
import { GitService, type GitStatusEntry } from './git-service.js'
import type { WorkerChangeSet, WorkerFileDiff } from './worker-types.js'

const MAX_FILE_BYTES = 256 * 1024
const MAX_TOTAL_BYTES = 2 * 1024 * 1024
const EXCLUDED_SEGMENTS = new Set(['node_modules', '.git', 'dist', 'build', '.cache', 'coverage'])
const SENSITIVE_NAMES = /(^|\/)(\.env(?:\.|$)|auth\.json$|credentials?|secrets?|.*\.(?:pem|key|p12|pfx)$)/i

interface BaselineFile {
  path: string
  state: string
  content?: string
  omitted?: string
}

interface Baseline {
  schemaVersion: 1
  runId: string
  gitAvailable: boolean
  files: BaselineFile[]
}

function excluded(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  return SENSITIVE_NAMES.test(normalized) || normalized.split('/').some((segment) => EXCLUDED_SEGMENTS.has(segment))
}

function key(entry: GitStatusEntry): string {
  return `${entry.index}${entry.workingTree}:${entry.state}`
}

async function textAt(workspace: string, path: string): Promise<{ content?: string; omitted?: string }> {
  if (excluded(path)) return { omitted: 'Sensitive or generated path excluded from change tracking.' }
  const absolute = resolve(workspace, path)
  const rel = relative(resolve(workspace), absolute)
  if (rel.startsWith('..') || isAbsolute(rel)) return { omitted: 'Path escaped the workspace.' }
  try {
    const info = await stat(absolute)
    if (!info.isFile()) return { omitted: 'Not a regular file.' }
    if (info.size > MAX_FILE_BYTES) return { omitted: 'File exceeds the 256 KB baseline cap.' }
    const content = await readFile(absolute)
    if (content.includes(0)) return { omitted: 'Binary file excluded.' }
    return { content: content.toString('utf8') }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { content: '' }
    return { omitted: 'Unable to read file baseline.' }
  }
}

function boundedDiff(path: string, before: string, after: string): WorkerFileDiff {
  const body = `--- a/${path} (before worker run)\n+++ b/${path} (after worker run)\n@@ full captured file @@\n-${before.replaceAll('\n', '\n-')}\n+${after.replaceAll('\n', '\n+')}`
  const bytes = Buffer.from(body)
  const truncated = bytes.length > MAX_FILE_BYTES
  return {
    path,
    state: before ? after ? 'modified' : 'deleted' : 'created',
    diff: truncated ? `${bytes.subarray(0, MAX_FILE_BYTES).toString('utf8')}\n[Diff truncated: file exceeds size cap; inspect directly]` : body,
    truncated,
    ...(truncated ? { warning: '[Diff truncated: file exceeds size cap; inspect directly]' } : {}),
  }
}

export class WorkerChangeTracker {
  private readonly git: GitService

  constructor(private readonly workspace: string, private readonly storePath: string) {
    this.git = new GitService(workspace)
  }

  private baselinePath(runId: string): string {
    return resolve(dirname(this.storePath), 'worker-change-baselines', `${runId}.json`)
  }

  async captureBaseline(runId: string): Promise<void> {
    const status = await this.git.status()
    const files: BaselineFile[] = []
    let retained = 0
    for (const entry of status.entries) {
      const captured = await textAt(this.workspace, entry.path)
      const size = Buffer.byteLength(captured.content ?? '')
      if (retained + size > MAX_TOTAL_BYTES) files.push({ path: entry.path, state: key(entry), omitted: 'Total baseline cap reached.' })
      else {
        retained += size
        files.push({ path: entry.path, state: key(entry), ...captured })
      }
    }
    const baseline: Baseline = { schemaVersion: 1, runId, gitAvailable: status.available, files }
    await atomicWriteFile(this.baselinePath(runId), `${JSON.stringify(baseline)}\n`)
  }

  async captureChanges(runId: string): Promise<WorkerChangeSet> {
    let baseline: Baseline = { schemaVersion: 1, runId, gitAvailable: false, files: [] }
    try { baseline = JSON.parse(await readFile(this.baselinePath(runId), 'utf8')) as Baseline } catch {}
    const afterStatus = await this.git.status()
    if (!baseline.gitAvailable || !afterStatus.available) {
      await rm(this.baselinePath(runId), { force: true }).catch(() => undefined)
      return {
        runId,
        files: [],
        incomplete: true,
        warning: 'Per-run change tracking requires a Git workspace; inspect this workspace directly.',
      }
    }
    const before = new Map(baseline.files.map((file) => [file.path, file]))
    const after = new Map(afterStatus.entries.map((entry) => [entry.path, entry]))
    const candidates = new Set([...before.keys(), ...after.keys()])
    const files: WorkerFileDiff[] = []
    let total = 0
    let incomplete = false

    for (const path of [...candidates].sort()) {
      const old = before.get(path)
      const currentEntry = after.get(path)
      const current = await textAt(this.workspace, path)
      const contentChanged = old?.content !== undefined && current.content !== undefined && old.content !== current.content
      const statusChanged = old ? old.state !== (currentEntry ? key(currentEntry) : '') : Boolean(currentEntry)
      if (!contentChanged && !statusChanged) continue
      let diff: WorkerFileDiff
      if (old?.content !== undefined && current.content !== undefined) diff = boundedDiff(path, old.content, current.content)
      else if (!old && afterStatus.available && !excluded(path)) {
        try {
          const gitDiff = await this.git.diff(path)
          diff = { path, state: currentEntry?.state ?? 'modified', diff: gitDiff.diff, truncated: gitDiff.truncated, ...(gitDiff.truncated ? { warning: '[Diff truncated: file exceeds size cap; inspect directly]' } : {}) }
        } catch {
          diff = { path, state: currentEntry?.state ?? 'modified', diff: '', truncated: false, warning: 'Change detected, but a text diff could not be generated.' }
          incomplete = true
        }
      } else {
        diff = { path, state: currentEntry?.state ?? (old ? 'deleted' : 'modified'), diff: '', truncated: false, warning: old?.omitted ?? current.omitted ?? 'Change tracking was incomplete for this file.' }
        incomplete = true
      }
      const size = Buffer.byteLength(diff.diff)
      if (total + size > MAX_TOTAL_BYTES) {
        const remaining = Math.max(0, MAX_TOTAL_BYTES - total)
        diff.diff = `${Buffer.from(diff.diff).subarray(0, remaining).toString('utf8')}\n[Diff truncated: total change payload exceeds 2 MB; inspect directly]`
        diff.truncated = true
        diff.warning = '[Diff truncated: total change payload exceeds 2 MB; inspect directly]'
        incomplete = true
      }
      total += Buffer.byteLength(diff.diff)
      files.push(diff)
      if (total >= MAX_TOTAL_BYTES) break
    }
    await rm(this.baselinePath(runId), { force: true }).catch(() => undefined)
    return { runId, files, incomplete, ...(incomplete ? { warning: 'Some changes could not be captured completely; inspect the workspace directly.' } : {}) }
  }
}
