import type { FormEvent, KeyboardEvent } from 'react'
import type { ConnectionStatus } from '../hooks/usePiChat'

export function ChatComposer({
  id,
  draft,
  onDraftChange,
  onSend,
  onStop,
  connection,
  busy,
  running,
  compact = false,
}: {
  id: string
  draft: string
  onDraftChange: (draft: string) => void
  onSend: (message: string) => boolean
  onStop: () => void
  connection: ConnectionStatus
  busy: boolean
  running: boolean
  compact?: boolean
}) {
  function sendDraft() {
    const message = draft.trim()
    if (!message || busy || connection !== 'connected') return
    onSend(message)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    sendDraft()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    sendDraft()
  }

  return (
    <form className={`composer${compact ? ' composer--compact' : ''}`} onSubmit={submit}>
      <label className="sr-only" htmlFor={id}>Message</label>
      <textarea
        id={id}
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={connection === 'connected' ? 'Ask Pi about this project...' : 'Waiting for the local backend...'}
        rows={compact ? 2 : 2}
        disabled={connection !== 'connected' || busy}
      />
      {running
        ? <button className="button button--stop" type="button" onClick={onStop}>Stop</button>
        : <button className="button button--primary" type="submit" disabled={busy || !draft.trim() || connection !== 'connected'}>Send</button>}
    </form>
  )
}
