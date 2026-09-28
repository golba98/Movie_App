import { Film } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { errorMessage } from '../../lib/errors'
import { imageUrl } from '../../lib/images'
import type { WatchPartyRoomSummary, WatchPartyState } from '../../types/watch-party'
import { saveWatchPartyAccess } from './access'
import { getWatchPartyRoom, joinWatchParty } from './api'

interface WatchPartyLobbyProps {
  roomId: string
  inviteToken: string | null
  onJoined: (state: WatchPartyState, accessToken: string, memberId: string) => void
}

/** The room preview and join form shown before a visitor becomes a member. */
export function WatchPartyLobby({ roomId, inviteToken, onJoined }: WatchPartyLobbyProps) {
  const [room, setRoom] = useState<WatchPartyRoomSummary | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    getWatchPartyRoom(roomId)
      .then((response) => setRoom(response.room))
      .catch((caught: unknown) => setError(errorMessage(caught, 'This room is unavailable.')))
      .finally(() => setLoading(false))
  }, [roomId])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setJoining(true)
    setError(null)
    try {
      const joined = await joinWatchParty(roomId, {
        displayName,
        password: password || undefined,
        inviteToken: inviteToken ?? undefined,
      })
      saveWatchPartyAccess(roomId, joined.accessToken, joined.memberId)
      onJoined(joined.state, joined.accessToken, joined.memberId)
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to join this room.'))
    } finally {
      setJoining(false)
    }
  }

  if (loading) return <main className="grid min-h-dvh place-items-center text-zinc-300" role="status">Loading watch room…</main>
  if (!room) {
    return (
      <main className="grid min-h-dvh place-items-center px-4">
        <p role="alert" className="rounded-2xl bg-red-400/10 p-5 text-red-200">{error ?? 'This room is unavailable.'}</p>
      </main>
    )
  }

  const poster = imageUrl(room.media.posterPath, 'w342')
  return (
    <main className="mx-auto grid min-h-dvh max-w-3xl place-items-center px-4 py-8">
      <section className="glass-panel w-full overflow-hidden rounded-3xl">
        <div className="grid md:grid-cols-[180px_1fr]">
          {poster
            ? <img src={poster} alt="" className="aspect-[2/3] h-full w-full object-cover" />
            : <div className="grid min-h-56 place-items-center bg-zinc-900"><Film aria-hidden="true" /></div>}
          <div className="p-6 sm:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">Watch party</p>
            <h1 className="mt-2 text-3xl font-black">{room.roomName}</h1>
            <p className="mt-3 text-lg font-semibold text-zinc-200">{room.media.title}</p>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-zinc-500">Host</dt><dd>{room.hostName}</dd></div>
              <div><dt className="text-zinc-500">People</dt><dd>{room.participantCount} / {room.maxParticipants}</dd></div>
              <div><dt className="text-zinc-500">Privacy</dt><dd className="capitalize">{room.privacy.replace('_', ' ')}</dd></div>
              <div><dt className="text-zinc-500">Room code</dt><dd className="font-mono tracking-widest">{room.roomCode}</dd></div>
            </dl>
            <form className="mt-7 space-y-4" onSubmit={submit}>
              <label className="block text-sm font-semibold">Your display name
                <input className="form-input mt-2" value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={32} required />
              </label>
              {room.requiresPassword && (
                <label className="block text-sm font-semibold">Room password
                  <input className="form-input mt-2" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} required />
                </label>
              )}
              <p className="text-xs leading-5 text-zinc-500">
                No microphone or camera is used. Communicate separately through Discord or another call platform.
              </p>
              {error && <p role="alert" className="rounded-xl bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
              <button className="primary-button w-full justify-center" disabled={joining}>{joining ? 'Joining…' : 'Join room'}</button>
            </form>
          </div>
        </div>
      </section>
    </main>
  )
}
