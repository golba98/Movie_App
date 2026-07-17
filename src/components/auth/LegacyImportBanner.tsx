import { CloudUpload, X } from 'lucide-react'
import { useFavourites } from '../../hooks/useFavourites'

export function LegacyImportBanner() {
  const { legacyCount, importing, importLegacy, dismissLegacy } = useFavourites()
  if (!legacyCount) return null

  return (
    <aside className="border-b border-sky-300/15 bg-sky-300/8 px-4 py-3 text-sm text-sky-100" aria-label="Import saved favourites">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 sm:px-2 lg:px-4">
        <CloudUpload size={19} className="shrink-0 text-sky-300" aria-hidden="true" />
        <p className="min-w-[190px] flex-1">We found {legacyCount} favourite{legacyCount === 1 ? '' : 's'} saved on this device. Import them into your account?</p>
        <button type="button" disabled={importing} onClick={() => void importLegacy()} className="min-h-11 rounded-xl bg-sky-100 px-4 font-semibold text-sky-950 disabled:opacity-60">{importing ? 'Importing…' : 'Import favourites'}</button>
        <button type="button" onClick={dismissLegacy} aria-label="Dismiss import offer" className="grid size-11 place-items-center rounded-xl text-sky-200 hover:bg-white/10"><X size={18} aria-hidden="true" /></button>
      </div>
    </aside>
  )
}
