import { Activity } from 'lucide-react'
import { formatDateTime } from '../../lib/format'
import type { AuditEvent } from '../../types/account'

export function AuditLog({ events }: { events: AuditEvent[] }) {
  return (
    <section aria-labelledby="audit-heading" className="mt-12">
      <div className="flex items-center gap-3">
        <Activity className="text-zinc-500" aria-hidden="true" />
        <div>
          <h2 id="audit-heading" className="text-2xl font-semibold">Recent admin activity</h2>
          <p className="text-sm text-zinc-500">The latest 100 security-relevant actions.</p>
        </div>
      </div>
      <div className="mt-5 overflow-hidden rounded-3xl border border-white/8 bg-white/[0.025]">
        {events.length ? (
          <ul className="divide-y divide-white/8">
            {events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-200">{event.action.replaceAll('.', ' · ')}</p>
                  <p className="truncate text-xs text-zinc-500">{event.targetUsername ?? 'Administrator session'}</p>
                </div>
                <time className="text-xs text-zinc-500" dateTime={new Date(event.createdAt).toISOString()}>{formatDateTime(event.createdAt)}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-6 text-sm text-zinc-500">No activity recorded yet.</p>
        )}
      </div>
    </section>
  )
}
