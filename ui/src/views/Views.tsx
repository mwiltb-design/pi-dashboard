import { useEffect, useRef, useState } from 'react'
import { AppPreviewer } from '../components/AppPreviewer'
import { ChatComposer } from '../components/ChatComposer'
import { ChatTimeline } from '../components/ChatTimeline'
import { FileBrowser } from '../components/FileBrowser'
import { FilesChatPanel, type FileChatContext, type FilesChatPosition } from '../components/FilesChatPanel'
import { Chip, Panel } from '../components/Panel'
import { SessionBrowser } from '../components/SessionBrowser'
import { SkillsToolsView } from '../components/SkillsToolsView'
import { SystemBrowser } from '../components/SystemBrowser'
import { WorkersBrowser } from '../components/WorkersBrowser'
import type { PiChatController } from '../hooks/usePiChat'
import type { PluginSummary } from '../types'

function PreviewButton({ children }: { children: string }) {
  return <button className="button button--quiet" type="button" disabled title="Available in a later phase">{children}</button>
}

export function ChatView({ chat }: { chat: PiChatController }) {
  const [draft, setDraft] = useState('')
  const busy = chat.running || chat.pendingCommand
  const model = chat.state.model
  const connectionLabel = chat.connection === 'connected' ? 'Pi connected' : chat.connection

  useEffect(() => {
    if (!chat.composerPrefill) return
    setDraft(chat.composerPrefill)
    chat.clearComposerPrefill()
  }, [chat.composerPrefill, chat.clearComposerPrefill])

  function sendDraft(message: string): boolean {
    const sent = chat.prompt(message)
    if (sent) setDraft('')
    return sent
  }

  const context = chat.state.contextUsage
  const contextLabel = context?.percent == null
    ? 'Context usage unavailable'
    : `${context.percent.toFixed(1)}% context${context.tokens != null && context.contextWindow ? ` - ${context.tokens.toLocaleString()} / ${context.contextWindow.toLocaleString()} tokens` : ''}`

  function startNewSession() {
    if (busy || !window.confirm('Start a new Pi session? The current session will remain saved.')) return
    chat.newSession()
  }

  return (
    <>
      <Panel
        eyebrow="Conversation"
        title={!chat.state.sessionName || chat.state.sessionName === 'Pi Dashboard' ? 'Foci Dashboard' : chat.state.sessionName}
        action={<Chip tone={chat.connection === 'connected' ? 'accent' : 'warning'}>{connectionLabel}</Chip>}
        className="chat-panel"
      >
        {chat.connectionError && <div className="connection-banner">{chat.connectionError}</div>}
        <ChatTimeline items={chat.items} running={chat.running} />
        <ChatComposer id="chat-message" draft={draft} onDraftChange={setDraft} onSend={sendDraft} onStop={chat.abort} connection={chat.connection} busy={busy} running={chat.running} />
      </Panel>

      <Panel eyebrow="Session context" title="Current session" action={<Chip>{chat.state.messageCount ?? 0} messages</Chip>}>
        <div className="panel__body">
          <div className="list">
            <div className="list__item"><strong>Model</strong><span>{model ? `${model.provider} / ${model.id}` : 'Loading...'}</span></div>
            <div className="list__item"><strong>Thinking level</strong><span>{chat.state.thinkingLevel ?? 'Loading...'}</span></div>
            <div className="list__item"><strong>Agent state</strong><span className={chat.running ? 'text-warning' : 'text-accent'}>{chat.running ? 'Working' : 'Ready'}</span></div>
            <div className="list__item"><strong>Context</strong><span>{contextLabel}</span></div>
            <div className="list__item"><strong>Session ID</strong><span className="truncate">{chat.state.sessionId ?? 'Loading...'}</span></div>
          </div>
          <span className="eyebrow section-label">Quick actions</span>
          <div className="action-stack">
            <button className="button button--quiet" type="button" onClick={startNewSession} disabled={busy || chat.connection !== 'connected'}>+ New session</button>
            <PreviewButton>Fork this session</PreviewButton>
            <PreviewButton>Compact context</PreviewButton>
          </div>
        </div>
      </Panel>
    </>
  )
}

export function FilesView({ workspaceRevision, editable, chat, chatOpen, onChatOpenChange, chatPosition, onChatPositionChange, fileContext, onFileContextChange }: {
  workspaceRevision: number
  editable: boolean
  chat: PiChatController
  chatOpen: boolean
  onChatOpenChange: (open: boolean) => void
  chatPosition: FilesChatPosition | null
  onChatPositionChange: (position: FilesChatPosition | null) => void
  fileContext?: FileChatContext
  onFileContextChange: (context?: FileChatContext) => void
}) {
  const scopeRef = useRef<HTMLDivElement>(null)
  return <div className="files-workspace" ref={scopeRef}>
    <FileBrowser workspaceRevision={workspaceRevision} editable={editable} onChatContextChange={onFileContextChange} />
    <FilesChatPanel chat={chat} context={fileContext} open={chatOpen} onOpenChange={onChatOpenChange} position={chatPosition} onPositionChange={onChatPositionChange} scopeRef={scopeRef} />
  </div>
}

export function SessionsView({ chat, onOpenChat }: { chat: PiChatController; onOpenChat: () => void }) {
  return <SessionBrowser chat={chat} onOpenChat={onOpenChat} />
}

export function SkillsView({ revision, plugins, onCreateWithPi }: {
  revision: number
  plugins: PluginSummary[]
  onCreateWithPi: (prompt: string) => boolean
}) {
  return <SkillsToolsView revision={revision} plugins={plugins} onCreateWithPi={onCreateWithPi} />
}

export function WorkersView({ onOpenSession }: { onOpenSession: (sessionId: string) => void }) {
  return <WorkersBrowser onOpenSession={sessionId => onOpenSession(sessionId)} />
}

export function PreviewerView() {
  return <AppPreviewer />
}

export function SettingsView({ revision }: { revision: string }) {
  return <SystemBrowser revision={revision} />
}
