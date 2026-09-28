import { Check, RefreshCw } from 'lucide-react'
import type { WatchPartyParticipant } from '../../types/watch-party'

function participantRole(participant: WatchPartyParticipant) {
  if (participant.role === 'host') return 'Host'
  return participant.canControl ? 'Playback control' : participant.connectionStatus
}

export function ParticipantList({ participants, maxParticipants }: { participants: WatchPartyParticipant[]; maxParticipants: number }) {
  return (
    <aside className="rounded-3xl border border-white/8 bg-white/[0.025] p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-black">Participants</h2>
        <span className="text-xs text-zinc-500">{participants.length} / {maxParticipants}</span>
      </div>
      <ul className="mt-4 space-y-3">
        {participants.map((participant) => (
          <li key={participant.id} className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-full bg-white/10 text-sm font-bold">
              {participant.displayName.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{participant.displayName}</span>
              <span className="text-xs text-zinc-500">{participantRole(participant)}</span>
            </span>
            {participant.ready && <Check size={16} className="text-emerald-300" aria-label="Ready" />}
            {participant.buffering && <RefreshCw size={15} className="animate-spin text-amber-200" aria-label="Buffering" />}
          </li>
        ))}
      </ul>
    </aside>
  )
}
