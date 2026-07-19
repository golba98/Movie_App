import type HlsType from 'hls.js'
import { Check, Copy, Film, Lock, MonitorSmartphone, Pause, Play, RefreshCw, Users, Wifi, WifiOff, X } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { getWatchPartyMedia, getWatchPartyRoom, getWatchPartyState, joinWatchParty, lookupWatchParty, mintWatchPartyExtensionToken } from '../api/watch-party'
import { readWatchPartyAccess, saveWatchPartyAccess } from '../components/watch-party/CreateWatchPartyDialog'
import { useWatchParty } from '../hooks/useWatchParty'
import type { WatchPartyClientRequest, WatchPartyState } from '../types/watch-party'
import { driftCorrection, expectedPlaybackPosition } from '../types/watch-party'
import { imageUrl } from '../utils/images'
import {
  extensionSocketUrl,
  isExtensionBridgeMessage,
  WATCH_SYNC_BRIDGE_VERSION,
  WATCH_SYNC_WEBSITE_SOURCE,
  type ExtensionBridgeMessage,
  type ExtensionBridgeStatus,
} from '../utils/watch-party-extension-bridge'

function formatTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function WatchPartyJoinPage() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const response = await lookupWatchParty(code)
      navigate(`/watch-party/${response.room.roomId}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That room is unavailable.')
    } finally {
      setLoading(false)
    }
  }
  return <main className="mx-auto grid min-h-dvh w-full max-w-xl place-items-center px-4 py-10"><section className="glass-panel w-full rounded-3xl p-6 sm:p-8"><span className="grid size-12 place-items-center rounded-2xl bg-white text-zinc-950"><Users aria-hidden="true" /></span><h1 className="mt-5 text-3xl font-black">Join Watch Party</h1><p className="mt-2 leading-6 text-zinc-400">Enter a room code, then watch in sync. Use Discord or another app if you want to talk.</p><form className="mt-7 space-y-4" onSubmit={submit}><label className="block text-sm font-semibold">Room code<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} className="form-input mt-2 tracking-[0.2em] uppercase" required maxLength={12} autoFocus /></label>{error && <p role="alert" className="rounded-xl bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}<button className="primary-button w-full justify-center" disabled={loading}>{loading ? 'Finding room…' : 'Continue'}</button></form></section></main>
}

function WatchPartyLobby({ roomId, inviteToken, onJoined }: { roomId: string; inviteToken: string | null; onJoined: (state: WatchPartyState, token: string, memberId: string) => void }) {
  const [room, setRoom] = useState<Awaited<ReturnType<typeof getWatchPartyRoom>>['room'] | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  useEffect(() => {
    void getWatchPartyRoom(roomId).then((response) => setRoom(response.room)).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'This room is unavailable.')).finally(() => setLoading(false))
  }, [roomId])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setJoining(true)
    setError(null)
    try {
      const joined = await joinWatchParty(roomId, { displayName, password: password || undefined, inviteToken: inviteToken ?? undefined })
      saveWatchPartyAccess(roomId, joined.accessToken, joined.memberId)
      onJoined(joined.state, joined.accessToken, joined.memberId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to join this room.')
    } finally {
      setJoining(false)
    }
  }
  if (loading) return <main className="grid min-h-dvh place-items-center text-zinc-300" role="status">Loading watch room…</main>
  if (!room) return <main className="grid min-h-dvh place-items-center px-4"><p role="alert" className="rounded-2xl bg-red-400/10 p-5 text-red-200">{error ?? 'This room is unavailable.'}</p></main>
  const poster = imageUrl(room.media.posterPath, 'w342')
  return <main className="mx-auto grid min-h-dvh max-w-3xl place-items-center px-4 py-8"><section className="glass-panel w-full overflow-hidden rounded-3xl"><div className="grid md:grid-cols-[180px_1fr]">{poster ? <img src={poster} alt="" className="aspect-[2/3] h-full w-full object-cover" /> : <div className="grid min-h-56 place-items-center bg-zinc-900"><Film aria-hidden="true" /></div>}<div className="p-6 sm:p-8"><p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">Watch party</p><h1 className="mt-2 text-3xl font-black">{room.roomName}</h1><p className="mt-3 text-lg font-semibold text-zinc-200">{room.media.title}</p><dl className="mt-5 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-zinc-500">Host</dt><dd>{room.hostName}</dd></div><div><dt className="text-zinc-500">People</dt><dd>{room.participantCount} / {room.maxParticipants}</dd></div><div><dt className="text-zinc-500">Privacy</dt><dd className="capitalize">{room.privacy.replace('_', ' ')}</dd></div><div><dt className="text-zinc-500">Room code</dt><dd className="font-mono tracking-widest">{room.roomCode}</dd></div></dl><form className="mt-7 space-y-4" onSubmit={submit}><label className="block text-sm font-semibold">Your display name<input className="form-input mt-2" value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={32} required /></label>{room.requiresPassword && <label className="block text-sm font-semibold">Room password<input className="form-input mt-2" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} required /></label>}<p className="text-xs leading-5 text-zinc-500">No microphone or camera is used. Communicate separately through Discord or another call platform.</p>{error && <p role="alert" className="rounded-xl bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}<button className="primary-button w-full justify-center" disabled={joining}>{joining ? 'Joining…' : 'Join room'}</button></form></div></div></section></main>
}

function SynchronizedPlayer({ state, playbackUrl, playbackKind, canControl, send }: { state: WatchPartyState; playbackUrl: string | null; playbackKind: 'video' | 'hls' | 'embed'; canControl: boolean; send: (event: WatchPartyClientRequest) => boolean }) {
  // 'video' and 'hls' load into this app-owned <video> element, so playback is
  // driven by shared room state (drift-corrected). 'embed' is an opaque
  // cross-origin iframe that the browser gives us no control over — it cannot be
  // synchronised, which the UI states plainly below.
  const isEmbed = playbackKind === 'embed'

  const videoRef = useRef<HTMLVideoElement>(null)
  const applyingRemote = useRef(false)
  const [ready, setReady] = useState(false)
  const [duration, setDuration] = useState(0)
  const [position, setPosition] = useState(0)

  // HLS streams need hls.js on browsers without native HLS (Chrome/Firefox);
  // Safari plays them directly. Direct mp4/webm use the plain src attribute.
  // hls.js is a large dependency, so it is loaded on demand only when an HLS
  // stream must actually play, keeping it out of the main app bundle.
  useEffect(() => {
    const video = videoRef.current
    if (!video || isEmbed || !playbackUrl) return
    if (playbackKind !== 'hls' || video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = playbackUrl
      return
    }
    let destroyed = false
    let hls: HlsType | null = null
    void import('hls.js').then(({ default: Hls }) => {
      if (destroyed || !videoRef.current) return
      if (!Hls.isSupported()) {
        videoRef.current.src = playbackUrl
        return
      }
      hls = new Hls({ enableWorker: true })
      hls.loadSource(playbackUrl)
      hls.attachMedia(videoRef.current)
    })
    return () => { destroyed = true; hls?.destroy() }
  }, [playbackUrl, playbackKind, isEmbed])

  const sync = useCallback(() => {
    if (isEmbed) return
    const video = videoRef.current
    if (!video || !ready) return
    const expected = expectedPlaybackPosition(state, Date.now())
    const drift = expected - video.currentTime * 1000
    const correction = driftCorrection(drift)
    applyingRemote.current = true
    video.playbackRate = state.playbackRate * correction.rate
    if (correction.kind === 'seek') video.currentTime = Math.max(0, expected / 1000)
    if (state.playbackState === 'playing' && video.paused) void video.play().catch(() => undefined)
    if (state.playbackState !== 'playing' && !video.paused) video.pause()
    window.setTimeout(() => { applyingRemote.current = false; if (video) video.playbackRate = state.playbackRate }, correction.kind === 'rate' ? 2_000 : 0)
  }, [ready, state, isEmbed])
  useEffect(() => { sync() }, [sync])

  if (isEmbed) {
    if (playbackUrl) {
      return (
        <div>
          <div className="relative aspect-video w-full overflow-hidden rounded-3xl bg-black shadow-2xl ring-1 ring-white/10">
            <iframe
              src={playbackUrl}
              className="block size-full border-0 bg-black object-contain"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="origin"
              sandbox="allow-scripts allow-same-origin allow-forms allow-presentation allow-popups allow-popups-to-escape-sandbox"
            />
          </div>
          <p className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-xs leading-5 text-amber-100">
            This source plays in an embedded third-party player, so play and pause can't be synchronised automatically. Count each other in over your call, or use a direct video source for full sync.
          </p>
        </div>
      )
    }
    return (
      <div className="grid aspect-video place-items-center rounded-3xl bg-black text-sm text-red-200" role="alert">
        The player could not be prepared. Reload the page to try again.
      </div>
    )
  }

  return <div className="relative overflow-hidden rounded-3xl bg-black shadow-2xl ring-1 ring-white/10"><video ref={videoRef} className="aspect-video w-full object-contain" playsInline preload="metadata" onLoadedMetadata={(event) => { setDuration(event.currentTarget.duration); setReady(true) }} onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)} onWaiting={() => { if (!applyingRemote.current) send({ type: 'playback:buffering', buffering: true }) }} onCanPlay={() => { if (!applyingRemote.current) send({ type: 'playback:buffering', buffering: false }) }} />{!ready && <div className="absolute inset-0 grid place-items-center bg-black/80 text-sm text-zinc-300" role="status">Synchronizing with room…</div>}<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent px-4 pb-4 pt-14"><div className="flex flex-wrap items-center gap-3"><button type="button" disabled={!canControl} onClick={() => send({ type: state.playbackState === 'playing' ? 'playback:pause-request' : 'playback:play-request' })} className="grid size-11 place-items-center rounded-full bg-white text-black disabled:opacity-45" aria-label={state.playbackState === 'playing' ? 'Pause for everyone' : 'Play for everyone'}>{state.playbackState === 'playing' ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button><span className="text-xs tabular-nums text-zinc-200">{formatTime(position * 1000)} / {formatTime(duration * 1000)}</span><input type="range" min="0" max={duration || 0} value={Math.min(position, duration || 0)} disabled={!canControl || !duration} onChange={(event) => setPosition(Number(event.target.value))} onMouseUp={(event) => send({ type: 'playback:seek-request', positionMs: Number((event.target as HTMLInputElement).value) * 1000 })} onTouchEnd={(event) => send({ type: 'playback:seek-request', positionMs: Number((event.target as HTMLInputElement).value) * 1000 })} className="min-w-24 flex-1 accent-white disabled:opacity-40" aria-label="Seek for everyone" /><select value={state.playbackRate} disabled={!canControl} onChange={(event) => send({ type: 'playback:rate-request', playbackRate: Number(event.target.value) })} className="rounded-xl bg-black/60 px-3 py-2 text-xs text-white disabled:opacity-45" aria-label="Playback speed">{[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}</select></div>{!canControl && <p className="mt-3 text-xs text-zinc-400">Only permitted participants can control playback.</p>}</div></div>
}

function WatchPartyRoom({ roomId, token, memberId, initialState }: { roomId: string; token: string; memberId: string; initialState: WatchPartyState }) {
  const navigate = useNavigate()
  const { state, connection, send } = useWatchParty(roomId, token, initialState)
  const [source, setSource] = useState<{ playbackUrl: string | null; playbackKind: 'video' | 'hls' | 'embed' } | null>(null)
  const [copied, setCopied] = useState(false)
  const [extensionHello, setExtensionHello] = useState<Extract<ExtensionBridgeMessage, { type: 'extension:hello' }> | null>(null)
  const [extensionStatus, setExtensionStatus] = useState<ExtensionBridgeStatus>('idle')
  const [extensionMessage, setExtensionMessage] = useState('Open the companion extension, then connect it to this room.')
  const [companionMode, setCompanionMode] = useState(false)
  useEffect(() => { void getWatchPartyMedia(roomId, token).then((response) => setSource({ playbackUrl: response.source.playbackUrl, playbackKind: response.source.playbackKind })).catch(() => setSource(null)) }, [roomId, token])

  const postExtensionToken = useCallback(async (
    type: 'website:connect' | 'website:token',
    nonce: string,
    clientSessionId: string,
  ) => {
    const minted = await mintWatchPartyExtensionToken(roomId, token, {
      nonce,
      clientSessionId,
      capabilityVersion: WATCH_SYNC_BRIDGE_VERSION,
    })
    window.postMessage({
      source: WATCH_SYNC_WEBSITE_SOURCE,
      type,
      protocolVersion: WATCH_SYNC_BRIDGE_VERSION,
      roomId,
      nonce,
      clientSessionId,
      extensionToken: minted.extensionToken,
      socketUrl: extensionSocketUrl(roomId),
    }, window.location.origin)
  }, [roomId, token])

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin || !isExtensionBridgeMessage(event.data)) return
      const message = event.data
      if (message.type === 'extension:hello') {
        setExtensionHello(message)
        setExtensionMessage('Companion extension detected and ready to connect.')
        return
      }
      if (extensionHello && message.clientSessionId !== extensionHello.clientSessionId) return
      if (message.type === 'extension:status') {
        setExtensionStatus(message.status)
        setExtensionMessage(message.message)
        if (message.status === 'connected') setCompanionMode(true)
        return
      }
      if (message.type === 'extension:token-request') {
        setExtensionStatus('reconnecting')
        setExtensionMessage('Refreshing the short-lived companion connection…')
        void postExtensionToken('website:token', message.nonce, message.clientSessionId).catch(() => {
          setExtensionStatus('error')
          setExtensionMessage('Could not refresh the extension token. Keep this room tab open and try again.')
        })
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [extensionHello, postExtensionToken])

  useEffect(() => {
    if (extensionHello) return
    const ping = () => {
      window.postMessage({
        source: WATCH_SYNC_WEBSITE_SOURCE,
        type: 'website:hello',
        protocolVersion: WATCH_SYNC_BRIDGE_VERSION,
      }, window.location.origin)
    }
    ping()
    const timer = window.setInterval(ping, 2_000)
    return () => window.clearInterval(timer)
  }, [extensionHello])

  const connectExtension = async () => {
    if (!extensionHello) {
      setExtensionStatus('error')
      setExtensionMessage('Companion extension not detected. Install or reload it, then reopen this room.')
      return
    }
    setExtensionStatus('connecting')
    setExtensionMessage('Connecting the companion extension…')
    try {
      await postExtensionToken('website:connect', extensionHello.nonce, extensionHello.clientSessionId)
    } catch (caught) {
      setExtensionStatus('error')
      setExtensionMessage(caught instanceof Error ? caught.message : 'Could not connect the companion extension.')
    }
  }

  const disconnectExtension = () => {
    if (extensionHello) {
      window.postMessage({
        source: WATCH_SYNC_WEBSITE_SOURCE,
        type: 'website:disconnect',
        protocolVersion: WATCH_SYNC_BRIDGE_VERSION,
        clientSessionId: extensionHello.clientSessionId,
      }, window.location.origin)
    }
    setCompanionMode(false)
    setExtensionStatus('disconnected')
    setExtensionMessage('Companion disconnected. The in-app player is active again.')
  }

  const leaveRoom = () => {
    disconnectExtension()
    navigate('/')
  }
  const member = state?.participants.find((participant) => participant.id === memberId)
  const canControl = Boolean(member && (member.id === state?.hostId || member.canControl || state?.settings.controlMode === 'everyone'))
  const copy = async () => { await navigator.clipboard.writeText(window.location.href); setCopied(true); window.setTimeout(() => setCopied(false), 1_500) }
  if (!state) return <main className="grid min-h-dvh place-items-center" role="status">Synchronizing with room…</main>
  return (
    <main className="min-h-dvh bg-[#070709] px-3 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">Watch party · {state.roomCode}</p>
            <h1 className="mt-1 text-xl font-black sm:text-2xl">{state.roomName}</h1>
            <p className="mt-1 text-sm text-zinc-400">{state.media.title}{state.media.seasonNumber ? ` · S${state.media.seasonNumber} E${state.media.episodeNumber}` : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-300">
              {connection === 'connected' ? <Wifi size={14} className="text-emerald-300" /> : <WifiOff size={14} className="text-amber-200" />}
              {connection === 'connected' ? 'In sync' : 'Reconnecting…'}
            </span>
            <button type="button" onClick={() => void copy()} className="secondary-button min-h-10"><Copy size={15} />{copied ? 'Copied' : 'Invite'}</button>
            <button type="button" onClick={leaveRoom} className="secondary-button min-h-10 text-red-200"><X size={15} />Leave</button>
          </div>
        </header>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <section>
            {companionMode ? (
              <div className="grid aspect-video place-items-center rounded-3xl border border-sky-300/20 bg-sky-300/[0.06] p-8 text-center">
                <div>
                  <MonitorSmartphone className="mx-auto text-sky-200" size={42} aria-hidden="true" />
                  <h2 className="mt-4 text-xl font-black">Companion playback is active</h2>
                  <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-zinc-300">The in-app player is unmounted. Playback commands now target the native video selected in your browser tab.</p>
                </div>
              </div>
            ) : source ? (
              <SynchronizedPlayer state={state} playbackUrl={source.playbackUrl} playbackKind={source.playbackKind} canControl={canControl} send={send} />
            ) : (
              <div className="grid aspect-video place-items-center rounded-3xl bg-black text-zinc-300" role="status">Loading authorised video…</div>
            )}
            <section className="mt-4 rounded-2xl border border-white/8 bg-white/[0.025] p-4" aria-label="Browser extension companion">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-bold"><MonitorSmartphone size={17} aria-hidden="true" />Browser extension companion</h2>
                  <p className="mt-1 text-xs leading-5 text-zinc-400" role="status">{extensionMessage}</p>
                  <p className="mt-1 text-[11px] uppercase tracking-wide text-zinc-600">Status: {extensionStatus}</p>
                </div>
                {companionMode ? (
                  <button type="button" onClick={disconnectExtension} className="secondary-button min-h-10">Use in-app player</button>
                ) : (
                  <button type="button" onClick={() => void connectExtension()} className="secondary-button min-h-10"><MonitorSmartphone size={15} />Connect browser extension</button>
                )}
              </div>
            </section>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => send({ type: 'room:ready', ready: !member?.ready })} className="secondary-button min-h-10"><Check size={15} />{member?.ready ? 'Ready' : 'Mark ready'}</button>
              {member?.id === state.hostId && <>
                <button type="button" onClick={() => send({ type: 'room:lock', locked: !state.settings.locked })} className="secondary-button min-h-10"><Lock size={15} />{state.settings.locked ? 'Unlock room' : 'Lock room'}</button>
                <button type="button" onClick={() => send({ type: 'room:end' })} className="secondary-button min-h-10 text-red-200">End room</button>
              </>}
            </div>
            <section className="mt-5 rounded-2xl border border-white/8 bg-white/[0.025] p-4" aria-label="Room activity">
              <h2 className="text-sm font-bold">Activity</h2>
              <div className="mt-3 space-y-2 text-sm text-zinc-400" aria-live="polite">{state.activity.slice(-5).reverse().map((activity) => <p key={activity.id}>{activity.message}</p>)}</div>
            </section>
          </section>
          <aside className="rounded-3xl border border-white/8 bg-white/[0.025] p-4">
            <div className="flex items-center justify-between"><h2 className="font-black">Participants</h2><span className="text-xs text-zinc-500">{state.participants.length} / {state.settings.maxParticipants}</span></div>
            <ul className="mt-4 space-y-3">{state.participants.map((participant) => <li key={participant.id} className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-full bg-white/10 text-sm font-bold">{participant.displayName.charAt(0).toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{participant.displayName}</span><span className="text-xs text-zinc-500">{participant.role === 'host' ? 'Host' : participant.canControl ? 'Playback control' : participant.connectionStatus}</span></span>{participant.ready && <Check size={16} className="text-emerald-300" aria-label="Ready" />}{participant.buffering && <RefreshCw size={15} className="animate-spin text-amber-200" aria-label="Buffering" />}</li>)}</ul>
          </aside>
        </div>
      </div>
    </main>
  )
}

export function WatchPartyRoomPage() {
  const { roomId = '' } = useParams()
  const [search] = useSearchParams()
  const existing = useMemo(() => readWatchPartyAccess(roomId), [roomId])
  const [access, setAccess] = useState(existing)
  const [initialState, setInitialState] = useState<WatchPartyState | null>(null)
  useEffect(() => { if (access) void getWatchPartyState(roomId, access.accessToken).then((response) => setInitialState(response.state)).catch(() => setAccess(null)) }, [access, roomId])
  if (access && !initialState) return <main className="grid min-h-dvh place-items-center text-zinc-300" role="status">Restoring your watch room…</main>
  if (!access) return <WatchPartyLobby roomId={roomId} inviteToken={search.get('invite')} onJoined={(state, accessToken, memberId) => { setAccess({ accessToken, memberId }); setInitialState(state) }} />
  if (!initialState) return null
  return <WatchPartyRoom roomId={roomId} token={access.accessToken} memberId={access.memberId} initialState={initialState} />
}
