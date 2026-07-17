import { Film, Plus, Save, Search, Trash2 } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import {
  createAdminMediaSource,
  deleteAdminMediaSource,
  getAdminMediaSources,
  updateAdminMediaSource,
  getAdminSearchProviders,
  createAdminSearchProvider,
  updateAdminSearchProvider,
  deleteAdminSearchProvider,
} from '../../api/media-sources'
import { ApiClientError } from '../../api/client'
import type { AdminMediaSource, MediaSourceInput, RightsBasis, SearchProvider } from '../../types/media-source'
import type { MediaType } from '../../types/tmdb'

interface SourceDraft {
  mediaType: MediaType
  tmdbId: string
  seasonNumber: string
  episodeNumber: string
  label: string
  sourceUrl: string
  mimeType: 'video/mp4' | 'video/webm'
  rightsBasis: RightsBasis
  rightsNote: string
  active: boolean
}

const EMPTY_DRAFT: SourceDraft = {
  mediaType: 'movie',
  tmdbId: '',
  seasonNumber: '',
  episodeNumber: '',
  label: '',
  sourceUrl: '',
  mimeType: 'video/mp4',
  rightsBasis: 'owned',
  rightsNote: '',
  active: true,
}

function draftFromSource(source: AdminMediaSource): SourceDraft {
  return {
    mediaType: source.mediaType,
    tmdbId: String(source.tmdbId),
    seasonNumber: source.seasonNumber === null ? '' : String(source.seasonNumber),
    episodeNumber: source.episodeNumber === null ? '' : String(source.episodeNumber),
    label: source.label,
    sourceUrl: source.sourceUrl,
    mimeType: source.mimeType,
    rightsBasis: source.rightsBasis,
    rightsNote: source.rightsNote,
    active: source.active,
  }
}

function inputFromDraft(draft: SourceDraft): MediaSourceInput {
  return {
    mediaType: draft.mediaType,
    tmdbId: Number(draft.tmdbId),
    seasonNumber: draft.mediaType === 'tv' ? Number(draft.seasonNumber) : null,
    episodeNumber: draft.mediaType === 'tv' ? Number(draft.episodeNumber) : null,
    label: draft.label,
    sourceUrl: draft.sourceUrl,
    mimeType: draft.mimeType,
    rightsBasis: draft.rightsBasis,
    rightsNote: draft.rightsNote,
    active: draft.active,
  }
}

function messageFor(error: unknown) {
  return error instanceof ApiClientError ? error.message : 'The media-source request could not be completed.'
}

function SourceFields({ draft, onChange }: { draft: SourceDraft; onChange: (draft: SourceDraft) => void }) {
  const update = <Key extends keyof SourceDraft>(key: Key, value: SourceDraft[Key]) => {
    onChange({ ...draft, [key]: value })
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <label className="text-sm text-zinc-300">Media type
        <select value={draft.mediaType} onChange={(event) => update('mediaType', event.target.value as MediaType)} className="form-input mt-2">
          <option value="movie">Movie</option>
          <option value="tv">TV episode</option>
        </select>
      </label>
      <label className="text-sm text-zinc-300">TMDB ID
        <input required type="number" min="1" value={draft.tmdbId} onChange={(event) => update('tmdbId', event.target.value)} className="form-input mt-2" />
      </label>
      <label className="text-sm text-zinc-300">Season
        <input required={draft.mediaType === 'tv'} disabled={draft.mediaType === 'movie'} type="number" min="1" value={draft.seasonNumber} onChange={(event) => update('seasonNumber', event.target.value)} className="form-input mt-2 disabled:opacity-40" />
      </label>
      <label className="text-sm text-zinc-300">Episode
        <input required={draft.mediaType === 'tv'} disabled={draft.mediaType === 'movie'} type="number" min="1" value={draft.episodeNumber} onChange={(event) => update('episodeNumber', event.target.value)} className="form-input mt-2 disabled:opacity-40" />
      </label>
      <label className="text-sm text-zinc-300 md:col-span-2">Display label
        <input required maxLength={160} value={draft.label} onChange={(event) => update('label', event.target.value)} className="form-input mt-2" placeholder="Owned presentation master" />
      </label>
      <label className="text-sm text-zinc-300 md:col-span-2">Direct media URL
        <input required maxLength={2000} value={draft.sourceUrl} onChange={(event) => update('sourceUrl', event.target.value)} className="form-input mt-2" placeholder="/media/example.mp4 or https://media.example/video.mp4" />
      </label>
      <label className="text-sm text-zinc-300">Media format
        <select value={draft.mimeType} onChange={(event) => update('mimeType', event.target.value as SourceDraft['mimeType'])} className="form-input mt-2">
          <option value="video/mp4">MP4</option>
          <option value="video/webm">WebM</option>
        </select>
      </label>
      <label className="inline-flex min-h-12 cursor-pointer items-center gap-3 text-sm font-medium md:col-span-3 xl:col-span-3">
        <input type="checkbox" checked={draft.active} onChange={(event) => update('active', event.target.checked)} className="size-5 accent-white" />
        Source is active and may be shown to signed-in viewers
      </label>
    </div>
  )
}

function SourceCard({
  source,
  busy,
  onSave,
  onDelete,
}: {
  source: AdminMediaSource
  busy: boolean
  onSave: (source: AdminMediaSource, draft: SourceDraft) => Promise<void>
  onDelete: (source: AdminMediaSource) => Promise<void>
}) {
  const [draft, setDraft] = useState(() => draftFromSource(source))

  useEffect(() => setDraft(draftFromSource(source)), [source])

  return (
    <article className="rounded-3xl border border-white/8 bg-white/[0.025] p-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{source.label}</h3>
          <p className="mt-1 text-xs text-zinc-500">
            {source.mediaType === 'movie' ? 'Movie' : `TV S${source.seasonNumber} E${source.episodeNumber}`} · TMDB {source.tmdbId}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${source.active ? 'bg-emerald-400/12 text-emerald-300' : 'bg-zinc-400/10 text-zinc-400'}`}>
          {source.active ? 'Active' : 'Inactive'}
        </span>
      </div>
      <SourceFields draft={draft} onChange={setDraft} />
      <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-white/8 pt-4">
        <button type="button" disabled={busy} onClick={() => void onDelete(source)} className="secondary-button text-red-200"><Trash2 size={16} aria-hidden="true" />Delete</button>
        <button type="button" disabled={busy} onClick={() => void onSave(source, draft)} className="primary-button"><Save size={16} aria-hidden="true" />Save source</button>
      </div>
    </article>
  )
}

export function AdminMediaSourceCatalog() {
  const [sources, setSources] = useState<AdminMediaSource[]>([])
  const [draft, setDraft] = useState<SourceDraft>(EMPTY_DRAFT)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadSources = useCallback(async (query = '') => {
    setLoading(true)
    setError(null)
    try {
      const response = await getAdminMediaSources(query)
      setSources(response.sources)
    } catch (caught) {
      setError(messageFor(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadSources() }, [loadSources])

  const create = async (event: FormEvent) => {
    event.preventDefault()
    setBusyId('create-media-source')
    setError(null)
    setNotice(null)
    try {
      const response = await createAdminMediaSource(inputFromDraft(draft))
      setDraft(EMPTY_DRAFT)
      setNotice(`Added ${response.source.label}. Only the direct media URL is sent to viewers.`)
      await loadSources(search)
    } catch (caught) {
      setError(messageFor(caught))
    } finally {
      setBusyId(null)
    }
  }

  const save = async (source: AdminMediaSource, updatedDraft: SourceDraft) => {
    setBusyId(source.id)
    setError(null)
    setNotice(null)
    try {
      const response = await updateAdminMediaSource(source.id, inputFromDraft(updatedDraft))
      setNotice(`Saved ${response.source.label}.`)
      await loadSources(search)
    } catch (caught) {
      setError(messageFor(caught))
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (source: AdminMediaSource) => {
    if (!window.confirm(`Delete the authorised source “${source.label}”?`)) return
    setBusyId(source.id)
    setError(null)
    setNotice(null)
    try {
      await deleteAdminMediaSource(source.id)
      setNotice(`Deleted ${source.label}.`)
      await loadSources(search)
    } catch (caught) {
      setError(messageFor(caught))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section aria-labelledby="media-sources-heading" className="glass-panel mt-8 rounded-[2rem] p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white text-zinc-950"><Film size={20} aria-hidden="true" /></span>
          <div>
            <h2 id="media-sources-heading" className="text-xl font-semibold">Authorised media catalog</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-500">Map movies and TV episodes to direct owned or licensed MP4/WebM files. Fedora Movies never proxies the file or embeds a streaming website.</p>
          </div>
        </div>
        <span className="rounded-full bg-white/6 px-3 py-1.5 text-xs text-zinc-400">{sources.length} shown</span>
      </div>

      {(error || notice) && <div className="mt-5" aria-live="polite">{error ? <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p> : <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">{notice}</p>}</div>}

      <form onSubmit={create} className="mt-6 rounded-3xl border border-white/8 bg-black/20 p-4 sm:p-5">
        <h3 className="mb-5 flex items-center gap-2 font-semibold"><Plus size={17} aria-hidden="true" />Add direct source</h3>
        <SourceFields draft={draft} onChange={setDraft} />
        <button type="submit" disabled={busyId === 'create-media-source'} className="primary-button mt-5 w-full justify-center"><Plus size={17} aria-hidden="true" />{busyId === 'create-media-source' ? 'Adding…' : 'Add authorised source'}</button>
      </form>

      <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
        <h3 className="text-lg font-semibold">Configured sources</h3>
        <form onSubmit={(event) => { event.preventDefault(); void loadSources(search) }} className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} aria-hidden="true" />
          <input type="search" aria-label="Search authorised media" placeholder="Search title or TMDB ID" value={search} onChange={(event) => setSearch(event.target.value)} className="form-input pl-11" />
        </form>
      </div>
      {loading ? <p role="status" className="mt-5 text-sm text-zinc-400">Loading authorised sources…</p> : sources.length ? <div className="mt-5 grid gap-4">{sources.map((source) => <SourceCard key={source.id} source={source} busy={busyId === source.id} onSave={save} onDelete={remove} />)}</div> : null}
    </section>
  )
}

interface ProviderDraft {
  label: string
  baseUrl: string
  movieUrlPattern: string
  tvUrlPattern: string
  active: boolean
}

const EMPTY_PROVIDER_DRAFT: ProviderDraft = {
  label: '',
  baseUrl: '',
  movieUrlPattern: '',
  tvUrlPattern: '',
  active: true,
}

function ProviderFields({ draft, onChange }: { draft: ProviderDraft; onChange: (draft: ProviderDraft) => void }) {
  const update = <Key extends keyof ProviderDraft>(key: Key, value: ProviderDraft[Key]) => {
    onChange({ ...draft, [key]: value })
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <label className="text-sm text-zinc-300">Provider label
        <input required maxLength={160} value={draft.label} onChange={(event) => update('label', event.target.value)} className="form-input mt-2" placeholder="Flixbaba" />
      </label>
      <label className="text-sm text-zinc-300">Base URL
        <input required maxLength={500} value={draft.baseUrl} onChange={(event) => update('baseUrl', event.target.value)} className="form-input mt-2" placeholder="https://flixbaba.mov" />
      </label>
      <label className="text-sm text-zinc-300">Movie URL pattern
        <input maxLength={500} value={draft.movieUrlPattern} onChange={(event) => update('movieUrlPattern', event.target.value)} className="form-input mt-2" placeholder="{baseUrl}/movie/{tmdbId}/{slug}/watch" />
      </label>
      <label className="text-sm text-zinc-300">TV URL pattern
        <input maxLength={500} value={draft.tvUrlPattern} onChange={(event) => update('tvUrlPattern', event.target.value)} className="form-input mt-2" placeholder="{baseUrl}/tv/{tmdbId}/{slug}" />
      </label>
      <label className="inline-flex min-h-12 cursor-pointer items-center gap-3 text-sm font-medium md:col-span-2 xl:col-span-4">
        <input type="checkbox" checked={draft.active} onChange={(event) => update('active', event.target.checked)} className="size-5 accent-white" />
        Provider is active and used for video searches
      </label>
    </div>
  )
}

function ProviderCard({
  provider,
  busy,
  onSave,
  onDelete,
}: {
  provider: SearchProvider
  busy: boolean
  onSave: (provider: SearchProvider, draft: ProviderDraft) => Promise<void>
  onDelete: (provider: SearchProvider) => Promise<void>
}) {
  const [draft, setDraft] = useState<ProviderDraft>(() => ({
    label: provider.label,
    baseUrl: provider.baseUrl,
    movieUrlPattern: provider.movieUrlPattern,
    tvUrlPattern: provider.tvUrlPattern,
    active: provider.active,
  }))

  useEffect(() => {
    setDraft({
      label: provider.label,
      baseUrl: provider.baseUrl,
      movieUrlPattern: provider.movieUrlPattern,
      tvUrlPattern: provider.tvUrlPattern,
      active: provider.active,
    })
  }, [provider])

  return (
    <article className="rounded-3xl border border-white/8 bg-white/[0.025] p-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{provider.label}</h3>
          <p className="mt-1 text-xs text-zinc-500">{provider.baseUrl}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${provider.active ? 'bg-emerald-400/12 text-emerald-300' : 'bg-zinc-400/10 text-zinc-400'}`}>
          {provider.active ? 'Active' : 'Inactive'}
        </span>
      </div>
      <ProviderFields draft={draft} onChange={setDraft} />
      <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-white/8 pt-4">
        <button type="button" disabled={busy} onClick={() => void onDelete(provider)} className="secondary-button text-red-200"><Trash2 size={16} aria-hidden="true" />Delete</button>
        <button type="button" disabled={busy} onClick={() => void onSave(provider, draft)} className="primary-button"><Save size={16} aria-hidden="true" />Save provider</button>
      </div>
    </article>
  )
}

export function AdminSearchProvidersCatalog() {
  const [providers, setProviders] = useState<SearchProvider[]>([])
  const [draft, setDraft] = useState<ProviderDraft>(EMPTY_PROVIDER_DRAFT)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadProviders = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await getAdminSearchProviders()
      setProviders(response.providers)
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Failed to load search providers.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadProviders() }, [loadProviders])

  const create = async (event: FormEvent) => {
    event.preventDefault()
    setBusyId('create-provider')
    setError(null)
    setNotice(null)
    try {
      const response = await createAdminSearchProvider(draft)
      setDraft(EMPTY_PROVIDER_DRAFT)
      setNotice(`Added ${response.provider.label}.`)
      await loadProviders()
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Failed to create provider.')
    } finally {
      setBusyId(null)
    }
  }

  const save = async (provider: SearchProvider, updatedDraft: ProviderDraft) => {
    setBusyId(provider.id)
    setError(null)
    setNotice(null)
    try {
      const response = await updateAdminSearchProvider(provider.id, updatedDraft)
      setNotice(`Saved ${response.provider.label}.`)
      await loadProviders()
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Failed to update provider.')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (provider: SearchProvider) => {
    if (!window.confirm(`Delete the search provider “${provider.label}”?`)) return
    setBusyId(provider.id)
    setError(null)
    setNotice(null)
    try {
      await deleteAdminSearchProvider(provider.id)
      setNotice(`Deleted ${provider.label}.`)
      await loadProviders()
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Failed to delete provider.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section aria-labelledby="search-providers-heading" className="glass-panel mt-8 rounded-[2rem] p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white text-zinc-950"><Film size={20} aria-hidden="true" /></span>
          <div>
            <h2 id="search-providers-heading" className="text-xl font-semibold">Dynamic search providers</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-500">Configure websites where Fedora Movies will dynamically look up streams based on TMDB metadata.</p>
          </div>
        </div>
      </div>

      {(error || notice) && <div className="mt-5" aria-live="polite">{error ? <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p> : <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">{notice}</p>}</div>}

      <form onSubmit={create} className="mt-6 rounded-3xl border border-white/8 bg-black/20 p-4 sm:p-5">
        <h3 className="mb-5 flex items-center gap-2 font-semibold"><Plus size={17} aria-hidden="true" />Add search provider</h3>
        <ProviderFields draft={draft} onChange={setDraft} />
        <button type="submit" disabled={busyId === 'create-provider'} className="primary-button mt-5 w-full justify-center"><Plus size={17} aria-hidden="true" />{busyId === 'create-provider' ? 'Adding…' : 'Add search provider'}</button>
      </form>

      <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
        <h3 className="text-lg font-semibold">Configured search providers</h3>
      </div>
      {loading ? <p role="status" className="mt-5 text-sm text-zinc-400">Loading search providers…</p> : providers.length ? <div className="mt-5 grid gap-4">{providers.map((provider) => <ProviderCard key={provider.id} provider={provider} busy={busyId === provider.id} onSave={save} onDelete={remove} />)}</div> : null}
    </section>
  )
}
