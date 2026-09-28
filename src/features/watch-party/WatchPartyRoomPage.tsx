import { Check, Copy, Lock, Wifi, WifiOff, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard'
import type { WatchPartyState } from '../../types/watch-party'
import { readWatchPartyAccess } from './access'
import { getWatchPartyMedia, getWatchPartyState, type WatchPartyMediaSource } from './api'
import { CompanionActiveNotice, ExtensionCompanionPanel } from './ExtensionCompanionPanel'
import { ParticipantList } from './ParticipantList'
import { SynchronizedPlayer } from './SynchronizedPlayer'
import { useExtensionCompanion } from './useExtensionCompanion'
import { useWatchParty } from './useWatchParty'
import { WatchPartyLobby } from './WatchPartyLobby'

const RECENT_ACTIVITY = 5

type RoomSource = Pick<WatchPartyMediaSource, 'playbackUrl' | 'playbackKind'>

interface WatchPartyRoomProps {
  roomId: string
  token: string
  memberId: string
  initialState: WatchPartyState
}

function WatchPartyRoom({ roomId, token, memberId, initialState }: WatchPartyRoomProps) {
  const navigate = useNavigate()
  const { state, connection, send } = useWatchParty(roomId, token, initialState)
  const companion = useExtensionCompanion(roomId, token)
  const { copied, copy } = useCopyToClipboard()
  const [source, setSource] = useState<RoomSource | null>(null)

  useEffect(() => {
    getWatchPartyMedia(roomId, token)
      .then(({ source }) => setSource({ playbackUrl: source.playbackUrl, playbackKind: source.playbackKind }))
      .catch(() => setSource(null))
  }, [roomId, token])

  if (!state) return <main className="grid min-h-dvh place-items-center" role="status">Synchronizing with room…</main>

  const member = state.participants.find((participant) => participant.id === memberId)
  const isHost = member?.id === state.hostId
  const canControl = Boolean(member && (isHost || member.canControl || state.settings.controlMode === 'everyone'))
  const episode = state.media.seasonNumber ? ` · S${state.media.seasonNumber} E${state.media.episodeNumber}` : ''

  const leaveRoom = () => {
    companion.disconnect()
    navigate('/')
  }

  return (
    <main className="min-h-dvh bg-canvas px-3 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">Watch party · {state.roomCode}</p>
            <h1 className="mt-1 text-xl font-black sm:text-2xl">{state.roomName}</h1>
            <p className="mt-1 text-sm text-zinc-400">{state.media.title}{episode}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-300">
              {connection === 'connected' ? <Wifi size={14} className="text-emerald-300" /> : <WifiOff size={14} className="text-amber-200" />}
              {connection === 'connected' ? 'In sync' : 'Reconnecting…'}
            </span>
            <button type="button" onClick={() => void copy(window.location.href)} className="secondary-button min-h-10">
              <Copy size={15} />{copied ? 'Copied' : 'Invite'}
            </button>
            <button type="button" onClick={leaveRoom} className="secondary-button min-h-10 text-red-200"><X size={15} />Leave</button>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <section>
            {companion.companionMode ? (
              <CompanionActiveNotice />
            ) : source ? (
              <SynchronizedPlayer state={state} playbackUrl={source.playbackUrl} playbackKind={source.playbackKind} canControl={canControl} send={send} />
            ) : (
              <div className="grid aspect-video place-items-center rounded-3xl bg-black text-zinc-300" role="status">Loading authorised video…</div>
            )}
            <ExtensionCompanionPanel
              status={companion.status}
              message={companion.message}
              companionMode={companion.companionMode}
              onConnect={() => void companion.connect()}
              onDisconnect={companion.disconnect}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => send({ type: 'room:ready', ready: !member?.ready })} className="secondary-button min-h-10">
                <Check size={15} />{member?.ready ? 'Ready' : 'Mark ready'}
              </button>
              {isHost && (
                <>
                  <button type="button" onClick={() => send({ type: 'room:lock', locked: !state.settings.locked })} className="secondary-button min-h-10">
                    <Lock size={15} />{state.settings.locked ? 'Unlock room' : 'Lock room'}
                  </button>
                  <button type="button" onClick={() => send({ type: 'room:end' })} className="secondary-button min-h-10 text-red-200">End room</button>
                </>
              )}
            </div>
            <section className="mt-5 rounded-2xl border border-white/8 bg-white/[0.025] p-4" aria-label="Room activity">
              <h2 className="text-sm font-bold">Activity</h2>
              <div className="mt-3 space-y-2 text-sm text-zinc-400" aria-live="polite">
                {state.activity.slice(-RECENT_ACTIVITY).reverse().map((activity) => <p key={activity.id}>{activity.message}</p>)}
              </div>
            </section>
          </section>
          <ParticipantList participants={state.participants} maxParticipants={state.settings.maxParticipants} />
        </div>
      </div>
    </main>
  )
}

export function WatchPartyRoomPage() {
  const { roomId = '' } = useParams()
  const [search] = useSearchParams()
  const savedAccess = useMemo(() => readWatchPartyAccess(roomId), [roomId])
  const [access, setAccess] = useState(savedAccess)
  const [initialState, setInitialState] = useState<WatchPartyState | null>(null)

  // Rejoin silently with access saved earlier in this tab; if it has expired, show the lobby.
  useEffect(() => {
    if (!access) return
    getWatchPartyState(roomId, access.accessToken)
      .then((response) => setInitialState(response.state))
      .catch(() => setAccess(null))
  }, [access, roomId])

  if (!access) {
    return (
      <WatchPartyLobby
        roomId={roomId}
        inviteToken={search.get('invite')}
        onJoined={(state, accessToken, memberId) => {
          setAccess({ accessToken, memberId })
          setInitialState(state)
        }}
      />
    )
  }
  if (!initialState) return <main className="grid min-h-dvh place-items-center text-zinc-300" role="status">Restoring your watch room…</main>
  return <WatchPartyRoom roomId={roomId} token={access.accessToken} memberId={access.memberId} initialState={initialState} />
}
