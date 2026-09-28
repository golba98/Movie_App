import { Save, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { StatusPill } from './StatusPill'

interface CatalogCardProps {
  title: string
  subtitle: ReactNode
  active: boolean
  busy: boolean
  saveLabel: string
  onSave: () => void
  onDelete: () => void
  children: ReactNode
}

/** One editable catalog entry with its status and Save/Delete actions. */
export function CatalogCard({ title, subtitle, active, busy, saveLabel, onSave, onDelete, children }: CatalogCardProps) {
  return (
    <article className="rounded-3xl border border-white/8 bg-white/[0.025] p-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>
        </div>
        <StatusPill active={active} activeLabel="Active" inactiveLabel="Inactive" inactiveClassName="bg-zinc-400/10 text-zinc-400" />
      </div>
      {children}
      <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-white/8 pt-4">
        <button type="button" disabled={busy} onClick={onDelete} className="secondary-button text-red-200">
          <Trash2 size={16} aria-hidden="true" />Delete
        </button>
        <button type="button" disabled={busy} onClick={onSave} className="primary-button">
          <Save size={16} aria-hidden="true" />{saveLabel}
        </button>
      </div>
    </article>
  )
}
