import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { PiChatController } from '../hooks/usePiChat'
import { ChatComposer } from './ChatComposer'
import { ChatTimeline } from './ChatTimeline'

export interface FileChatContext {
  path: string
  cursor?: { line: number; column: number }
  selection?: {
    text: string
    fromLine: number
    toLine: number
    truncated: boolean
  }
}

export interface FilesChatPosition {
  x: number
  y: number
}

function contextualPrompt(message: string, context?: FileChatContext): string {
  if (!context) return message
  const details = [`Path: ${context.path}`]
  if (context.cursor) details.push(`Cursor: line ${context.cursor.line}, column ${context.cursor.column}`)
  if (context.selection) {
    details.push(`Selected lines: ${context.selection.fromLine}-${context.selection.toLine}${context.selection.truncated ? ' (truncated to 12,000 characters)' : ''}`)
    details.push('--- selected text ---', context.selection.text, '--- end selected text ---')
  }
  return `[File context]\n${details.join('\n')}\n[/File context]\n\n${message}`
}

export function FilesChatPanel({
  chat,
  context,
  open,
  onOpenChange,
  position,
  onPositionChange,
  scopeRef,
}: {
  chat: PiChatController
  context?: FileChatContext
  open: boolean
  onOpenChange: (open: boolean) => void
  position: FilesChatPosition | null
  onPositionChange: (position: FilesChatPosition | null) => void
  scopeRef: RefObject<HTMLDivElement>
}) {
  const [draft, setDraft] = useState('')
  const [includeContext, setIncludeContext] = useState(true)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const dragRef = useRef<{ offsetX: number; offsetY: number } | null>(null)
  const previousPath = useRef<string | undefined>(context?.path)
  const previousSession = useRef<string | undefined>(chat.state.sessionId)
  const busy = chat.running || chat.pendingCommand

  function clampPosition(x: number, y: number): FilesChatPosition {
    const scope = scopeRef.current?.getBoundingClientRect()
    const panel = panelRef.current?.getBoundingClientRect()
    const width = panel?.width ?? Math.min(380, window.innerWidth - 16)
    const height = panel?.height ?? Math.min(520, window.innerHeight - 16)
    const left = Math.max(8, scope?.left ?? 8)
    const right = Math.min(window.innerWidth - 8, scope?.right ?? window.innerWidth - 8)
    const preferredTop = Math.max(8, scope?.top ?? 8)
    const bottomInset = window.innerWidth <= 720 ? 82 : 8
    const maxY = Math.max(8, window.innerHeight - bottomInset - height)
    const top = Math.min(preferredTop, maxY)
    return {
      x: Math.max(left, Math.min(x, Math.max(left, right - width))),
      y: Math.max(top, Math.min(y, maxY)),
    }
  }

  useEffect(() => {
    if (previousPath.current !== context?.path) {
      previousPath.current = context?.path
      setIncludeContext(true)
    }
  }, [context?.path])

  useEffect(() => {
    const sessionId = chat.state.sessionId
    if (previousSession.current !== undefined && previousSession.current !== sessionId) {
      setDraft('')
      setIncludeContext(true)
    }
    previousSession.current = sessionId
  }, [chat.state.sessionId])

  useEffect(() => {
    if (!open) return
    const handleResize = () => {
      if (position) onPositionChange(clampPosition(position.x, position.y))
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') minimize()
    }
    window.addEventListener('resize', handleResize)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('resize', handleResize)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, position, onPositionChange])

  function minimize() {
    onOpenChange(false)
    window.requestAnimationFrame(() => launcherRef.current?.focus())
  }

  function send(message: string): boolean {
    const snapshot = includeContext ? context : undefined
    const sent = chat.prompt(contextualPrompt(message, snapshot))
    if (sent) {
      setDraft('')
      setIncludeContext(true)
    }
    return sent
  }

  function startDrag(event: ReactPointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest('button')) return
    const panel = panelRef.current?.getBoundingClientRect()
    if (!panel) return
    dragRef.current = { offsetX: event.clientX - panel.left, offsetY: event.clientY - panel.top }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!dragRef.current) return
    onPositionChange(clampPosition(event.clientX - dragRef.current.offsetX, event.clientY - dragRef.current.offsetY))
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  if (!open) {
    return <button ref={launcherRef} className="files-chat-launcher button button--primary" type="button" aria-label="Open Pi chat" onClick={() => onOpenChange(true)}>Chat</button>
  }

  const panelStyle = position ? { left: position.x, top: position.y } : undefined
  return (
    <section ref={panelRef} className={`files-chat-panel${position ? ' files-chat-panel--positioned' : ''}`} style={panelStyle} role="dialog" aria-label="Pi chat for Files" aria-modal="false">
      <header className="files-chat-panel__header" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <div><span className="eyebrow">Active session</span><strong>Pi chat</strong></div>
        <div>
          <button type="button" aria-label="Reset chat panel position" title="Reset position" onClick={() => onPositionChange(null)}>↺</button>
          <button type="button" aria-label="Minimize chat panel" title="Minimize" onClick={minimize}>−</button>
        </div>
      </header>
      {chat.connectionError && <div className="connection-banner">{chat.connectionError}</div>}
      <ChatTimeline items={chat.items} running={chat.running} />
      <div className="files-chat-context" aria-label="File context">
        {context && includeContext ? (
          <div className="files-chat-context__chip">
            <span title={context.path}><b>File context</b> {context.path}</span>
            <button type="button" aria-label={`Remove file context ${context.path}`} onClick={() => setIncludeContext(false)}>×</button>
            {(context.cursor || context.selection) && <small>
              {[
                context.selection ? `Lines ${context.selection.fromLine}-${context.selection.toLine}${context.selection.truncated ? ' · selection truncated to 12,000 characters' : ''}` : '',
                context.cursor ? `Cursor ${context.cursor.line}:${context.cursor.column}` : '',
              ].filter(Boolean).join(' · ')}
            </small>}
          </div>
        ) : <span>{context ? 'File context removed for this draft' : 'No file context'}</span>}
      </div>
      <ChatComposer id="files-chat-message" draft={draft} onDraftChange={setDraft} onSend={send} onStop={chat.abort} connection={chat.connection} busy={busy} running={chat.running} compact />
    </section>
  )
}
