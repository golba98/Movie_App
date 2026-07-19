import { Copy, Users, X } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { createWatchParty } from '../../api/watch-party'
import type { MediaSource } from '../../types/media-source'
import type { MediaType } from '../../types/tmdb'

const SESSION_PREFIX = 'fedora:watch-party:'

export function saveWatchPartyAccess(roomId: string, accessToken: string, memberId: string) {
  sessionStorage.setItem(`${SESSION_PREFIX}${roomId}`, JSON.stringify({ accessToken, memberId }))
}

export function readWatchPartyAccess(roomId: string) {
  try {
    const value = JSON.parse(sessionStorage.getItem(`${SESSION_PREFIX}${roomId}`) ?? 'null') as { accessToken?: string; memberId?: string } | null
    return value?.accessToken && value.memberId ? { accessToken: value.accessToken, memberId: value.memberId } : null
  } catch {
    return null
  }
}

export function CreateWatchPartyDialog({
  open,
  onClose,
  sources,
  mediaType,
  title,
  posterPath,
  backdropPath,
}: {
  open: boolean
  onClose: () => void
  sources: MediaSource[]
  mediaType: MediaType
  title: string
  posterPath: string | null
  backdropPath: string | null
}) {
  const navigate = useNavigate()
  const getSourceLabel = (source: MediaSource) => {
    const cleanLabel = source.label.replace(' Stream (Dynamic)', '')
    if (cleanLabel.toLowerCase().includes('flixbaba')) return 'Source 1'
    if (cleanLabel.toLowerCase().includes('soap2day')) return 'Source 2'
    return cleanLabel
  }
  const [roomName, setRoomName] = useState(`${title} with friends`)
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '')
  const [privacy, setPrivacy] = useState<'public' | 'private' | 'invite_only'>('public')
  const [password, setPassword] = useState('')
  const [maxParticipants, setMaxParticipants] = useState(8)
  const [controlMode, setControlMode] = useState<'host_only' | 'everyone' | 'approved' | 'request'>('host_only')
  const [allowLateJoin, setAllowLateJoin] = useState(true)
  const [readyUpEnabled, setReadyUpEnabled] = useState(false)
  const [pauseForBuffering, setPauseForBuffering] = useState(false)
  const [expiresInHours, setExpiresInHours] = useState<1 | 6 | 24 | null>(24)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.showModal()
    closeButtonRef.current?.focus()

    return () => {
      document.body.style.overflow = previousOverflow
      if (dialog.open) dialog.close()
      window.requestAnimationFrame(() => {
        if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus()
      })
    }
  }, [open])

  if (!open) return null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const response = await createWatchParty({
        roomName,
        sourceId,
        mediaTitle: title,
        posterPath,
        backdropPath,
        privacy,
        password: privacy === 'private' ? password : undefined,
        maxParticipants,
        controlMode,
        allowLateJoin,
        allowMediaChange: false,
        readyUpEnabled,
        startWhenEveryoneReady: false,
        pauseForBuffering,
        expiresInHours,
      })
      saveWatchPartyAccess(response.state.roomId, response.accessToken, response.memberId)
      navigate(`/watch-party/${response.state.roomId}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create the watch room.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="glass-panel m-auto flex max-h-[88dvh] w-[calc(100%-2rem)] max-w-2xl flex-col overflow-hidden rounded-3xl p-0 text-white backdrop:bg-black/80 backdrop:backdrop-blur-sm sm:w-[calc(100%-3rem)]"
      aria-labelledby="watch-party-create-title"
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/8 px-5 py-5 sm:px-7">
          <div className="flex items-center gap-3.5">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white text-zinc-950"><Users size={20} aria-hidden="true" /></span>
            <div>
              <h2 id="watch-party-create-title" className="text-xl font-black sm:text-2xl">Watch with friends</h2>
              <p className="mt-1 text-sm leading-5 text-zinc-400">Everyone plays their own authorised copy in sync. Use Discord or another app to talk.</p>
            </div>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} className="grid size-10 shrink-0 place-items-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white" aria-label="Close watch party setup"><X size={18} aria-hidden="true" /></button>
        </header>
        {sources.length === 0 ? (
          <div className="p-5 sm:p-7"><p role="alert" className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">Watch rooms need an administrator-configured source.</p></div>
        ) : (
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
            <div className="scrollbar-subtle min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-6 sm:px-7">
              <label className="block text-sm font-semibold text-zinc-200">Room name<input className="form-input mt-2" value={roomName} onChange={(event) => setRoomName(event.target.value)} maxLength={80} required /></label>
              <label className="block text-sm font-semibold text-zinc-200">Video to synchronize<select className="form-input mt-2" value={sourceId} onChange={(event) => setSourceId(event.target.value)}>{sources.map((source) => <option key={source.id} value={source.id}>{getSourceLabel(source)}{mediaType === 'tv' ? ` · S${source.seasonNumber} E${source.episodeNumber}` : ''}</option>)}</select></label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-semibold text-zinc-200">Privacy<select className="form-input mt-2" value={privacy} onChange={(event) => setPrivacy(event.target.value as typeof privacy)}><option value="public">Public</option><option value="private">Private with password</option><option value="invite_only">Invite only</option></select></label>
                <label className="block text-sm font-semibold text-zinc-200">Participant limit<select className="form-input mt-2" value={maxParticipants} onChange={(event) => setMaxParticipants(Number(event.target.value))}>{[2, 4, 6, 8, 12, 16, 25].map((count) => <option key={count} value={count}>{count} people</option>)}</select></label>
              </div>
              {privacy === 'private' && <label className="block text-sm font-semibold text-zinc-200">Room password<input className="form-input mt-2" value={password} onChange={(event) => setPassword(event.target.value)} type="password" minLength={12} maxLength={128} required /></label>}
              <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold text-zinc-200">Who controls playback<select className="form-input mt-2" value={controlMode} onChange={(event) => setControlMode(event.target.value as typeof controlMode)}><option value="host_only">Host only</option><option value="everyone">Everyone</option><option value="approved">Approved people</option><option value="request">Request control</option></select></label><label className="block text-sm font-semibold text-zinc-200">Automatic expiry<select className="form-input mt-2" value={expiresInHours ?? 'never'} onChange={(event) => setExpiresInHours(event.target.value === 'never' ? null : Number(event.target.value) as 1 | 6 | 24)}><option value="1">1 hour</option><option value="6">6 hours</option><option value="24">24 hours</option><option value="never">No scheduled expiry</option></select></label></div>
              <div className="space-y-3 rounded-2xl border border-white/8 bg-black/20 p-4 text-sm text-zinc-300">
                <label className="flex items-center gap-3"><input type="checkbox" checked={allowLateJoin} onChange={(event) => setAllowLateJoin(event.target.checked)} className="size-5 accent-white" />Allow new participants after playback starts</label>
                <label className="flex items-center gap-3"><input type="checkbox" checked={readyUpEnabled} onChange={(event) => setReadyUpEnabled(event.target.checked)} className="size-5 accent-white" />Enable ready-up before starting</label>
                <label className="flex items-center gap-3"><input type="checkbox" checked={pauseForBuffering} onChange={(event) => setPauseForBuffering(event.target.checked)} className="size-5 accent-white" />Pause for someone buffering</label>
              </div>
            </div>
            <footer className="shrink-0 space-y-3 border-t border-white/8 px-5 py-4 sm:px-7">
              {error && <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
              <button type="submit" disabled={submitting} className="primary-button w-full justify-center"><Copy size={17} aria-hidden="true" />{submitting ? 'Creating room…' : 'Create watch party'}</button>
            </footer>
          </form>
        )}
    </dialog>
  )
}
