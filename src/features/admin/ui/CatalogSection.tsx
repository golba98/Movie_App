import { Film, Plus } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'

interface CatalogSectionProps {
  id: string
  title: string
  description: string
  count?: number
  error: string | null
  notice: string | null
  addTitle: string
  addLabel: string
  adding: boolean
  onAdd: (event: FormEvent) => void
  addFields: ReactNode
  listTitle: string
  listActions?: ReactNode
  children: ReactNode
}

/** An admin catalog: heading, status message, an "add" form, then the configured items. */
export function CatalogSection({
  id,
  title,
  description,
  count,
  error,
  notice,
  addTitle,
  addLabel,
  adding,
  onAdd,
  addFields,
  listTitle,
  listActions,
  children,
}: CatalogSectionProps) {
  return (
    <section aria-labelledby={id} className="glass-panel mt-8 rounded-[2rem] p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white text-zinc-950"><Film size={20} aria-hidden="true" /></span>
          <div>
            <h2 id={id} className="text-xl font-semibold">{title}</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-500">{description}</p>
          </div>
        </div>
        {count !== undefined && <span className="rounded-full bg-white/6 px-3 py-1.5 text-xs text-zinc-400">{count} shown</span>}
      </div>

      {(error || notice) && (
        <div className="mt-5" aria-live="polite">
          {error
            ? <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>
            : <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">{notice}</p>}
        </div>
      )}

      <form onSubmit={onAdd} className="mt-6 rounded-3xl border border-white/8 bg-black/20 p-4 sm:p-5">
        <h3 className="mb-5 flex items-center gap-2 font-semibold"><Plus size={17} aria-hidden="true" />{addTitle}</h3>
        {addFields}
        <button type="submit" disabled={adding} className="primary-button mt-5 w-full justify-center">
          <Plus size={17} aria-hidden="true" />{adding ? 'Adding…' : addLabel}
        </button>
      </form>

      <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
        <h3 className="text-lg font-semibold">{listTitle}</h3>
        {listActions}
      </div>
      {children}
    </section>
  )
}
